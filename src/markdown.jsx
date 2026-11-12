import { copyText } from './mobile/runtime';
import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import { api } from './api';
import { URL_PATTERN, maskSpoilers, spoilerRanges } from '../shared/preview.js';

// 消息格式：完整 Markdown（GFM 表格、待办、删除线等），中文加粗规则按 remark-cjk-friendly 放宽。
// 只生成 React 元素、不执行 HTML；链接只放行 http/https/mailto，外部图片不加载、只显示成链接。
// 网址遇到汉字或全角标点就结束：「看这个https://a.com，然后」只链接到 https://a.com。
const urlAt = text => text.match(new RegExp(`^(?:${URL_PATTERN.source})`, 'u'))?.[0];
const SAFE_URL = /^(https?:|mailto:)/i;

function openLink(event, href) {
  if (!window.desktop?.openUrl) return;
  event.preventDefault();
  window.desktop.openUrl(href).catch(() => {});
}
// 站内消息链接：任意 http(s) 地址后面跟 #msg=会话/消息。局域网里每个人连主机用的地址可能不同，所以只看 # 后面的部分。
export function messageLink(href) {
  const match = /^https?:\/\/[^#\s]*#msg=([^/\s#]+)\/([^/\s#]+)$/i.exec(href || '');
  try { return match ? { roomId: decodeURIComponent(match[1]), id: decodeURIComponent(match[2]) } : null; } catch { return null; }
}
// 群邀请链接：#join-group=群/令牌，同样只看 # 后面的部分。
export function groupInviteLink(href) {
  const match = /^https?:\/\/[^#\s]*#join-group=([^/\s#.]+)\.([\w-]+)$/i.exec(href || '');
  try { return match ? { roomId: decodeURIComponent(match[1]), token: match[2] } : null; } catch { return null; }
}
const openMessage = (event, target) => { event.preventDefault(); event.stopPropagation(); window.dispatchEvent(new CustomEvent('linliao:open-message', { detail: target })); };
function Link({ href, children }) {
  if (!href) return children;
  const invite = groupInviteLink(href);
  if (invite) return <a href={href} className="message-link" title="加入这个群聊" onClick={event => { event.preventDefault(); event.stopPropagation(); window.dispatchEvent(new CustomEvent('linliao:join-group', { detail: invite })); }}>👥 群聊邀请</a>;
  const target = messageLink(href);
  if (!target) return <a href={href} target="_blank" rel="noopener noreferrer" onClick={event => openLink(event, href)}>{children}</a>;
  const label = React.Children.toArray(children);
  return <a href={href} className="message-link" title="跳到这条消息" onClick={event => openMessage(event, target)}>{label.length === 1 && label[0] === href ? '🔗 消息链接' : children}</a>;
}

// 文字节点里补上 GFM 认不出的网址（紧贴汉字的网址），并把 @提及标成高亮。
const mentionNode = token => ({ type: 'mention', data: { hName: 'span', hProperties: { className: token.self ? ['mention', 'self'] : ['mention'] } }, children: [{ type: 'text', value: token.label }] });
function mentionNodes(value, tokens) {
  const nodes = [];
  for (let start = 0; start < value.length;) {
    let found = null;
    for (const token of tokens) { const index = value.indexOf(token.label, start); if (index >= 0 && (!found || index < found.index)) found = { ...token, index }; }
    if (!found) { nodes.push({ type: 'text', value: value.slice(start) }); break; }
    if (found.index > start) nodes.push({ type: 'text', value: value.slice(start, found.index) });
    nodes.push(mentionNode(found));
    start = found.index + found.label.length;
  }
  return nodes;
}
// 聊天里单个换行就是换行（Markdown 默认会把它当成空格）。
function textNodes(value, tokens) {
  return value.split('\n').flatMap((line, index) => index ? [{ type: 'break' }, ...lineNodes(line, tokens)] : lineNodes(line, tokens));
}
function lineNodes(value, tokens) {
  const nodes = [];
  let last = 0;
  for (const match of value.matchAll(URL_PATTERN)) {
    if (match.index > last) nodes.push(...mentionNodes(value.slice(last, match.index), tokens));
    nodes.push({ type: 'link', url: match[0], children: [{ type: 'text', value: match[0] }] });
    last = match.index + match[0].length;
  }
  if (last < value.length) nodes.push(...mentionNodes(value.slice(last), tokens));
  return nodes;
}
const SKIP = new Set(['link', 'linkReference', 'inlineCode', 'code', 'html', 'definition']);
// GFM 自动识别的网址会把后面紧跟的中文也算进去，按上面的规则截断，多出来的部分还原成文字。
function literalLink(link, tokens) {
  const text = link.children.length === 1 && link.children[0].type === 'text' ? link.children[0].value : null;
  const url = text && link.url === text && urlAt(text);
  if (!url || url === text) return [link];
  return [{ ...link, url, children: [{ type: 'text', value: url }] }, ...textNodes(text.slice(url.length), tokens)];
}
function walk(node, tokens) {
  if (!node.children || SKIP.has(node.type)) return;
  node.children = node.children.flatMap(child => child.type === 'text' ? textNodes(child.value, tokens)
    : child.type === 'link' ? literalLink(child, tokens) : (walk(child, tokens), [child]));
}
// 剧透：范围由 shared/preview.js 按原文算出（和纯文字预览同一份），这里按节点在原文里的位置把范围内的内容包进 spoiler 节点、
// 去掉两头的 ||。必须在拆分网址和 @提及之前做，那之后新生成的节点没有位置信息。
// data-range 记下范围在原文里的起点：复制消息时据此知道哪几段还没揭开。
const spoilerNode = range => ({ type: 'spoiler', range, data: { hName: 'span', hProperties: { className: ['spoiler'], dataRange: range.start } }, children: [] });
// 文字节点的每个字符对应原文的哪个位置：通常原样对应；有反斜杠转义、字符实体或续行缩进时逐字对齐，对不上返回 null。
function sourceOffsets(node, source) {
  const { value } = node, start = node.position.start.offset, end = node.position.end.offset;
  if (source.slice(start, end) === value) return Array.from({ length: value.length }, (_, index) => start + index);
  const offsets = [];
  let j = start;
  for (let i = 0; i < value.length; i++) {
    while (j < end && source[j] !== value[i]) {
      if (source[j] === '&') { const semi = source.indexOf(';', j); if (semi > j && semi < end && semi - j <= 32) { offsets.push(j); j = semi + 1; break; } }
      j++;
    }
    if (offsets.length === i + 1) continue;
    if (j >= end) return null;
    offsets.push(j++);
  }
  return offsets.length === value.length ? offsets : null;
}
const isMarker = (at, range) => at < range.start + 2 || at >= range.end - 2;
const BLOCKS = new Set(['root', 'paragraph', 'heading', 'blockquote', 'list', 'listItem', 'table', 'tableRow', 'tableCell', 'code', 'thematicBreak', 'html', 'definition', 'footnoteDefinition']);
// 整个落在剧透范围里、但碰到两头 || 的节点（比如 GFM 把结尾的 || 也算进了网址）：去掉里面的 ||，网址跟着改。
const bareLink = node => node.type === 'link' && node.children.length === 1 && node.children[0].type === 'text' && node.children[0].value === node.url;
const visibleText = node => node.type === 'text' ? node.value : node.type === 'spoiler' ? '' : (node.children || []).map(visibleText).join('');
function stripMarkers(node, range, source) {
  if (node.type === 'text') {
    const offsets = node.position && sourceOffsets(node, source);
    if (!offsets) { node.value = node.value.replaceAll('||', ''); return; }
    let value = '';
    for (let index = 0; index < node.value.length; index++) if (!(offsets[index] >= range.start && offsets[index] < range.end && isMarker(offsets[index], range))) value += node.value[index];
    node.value = value;
    return;
  }
  if (!node.children) return;
  const literal = bareLink(node);
  for (const child of node.children) stripMarkers(child, range, source);
  if (literal) node.url = visibleText(node);
}
function coverSpoilers(node, ranges, source) {
  if (!node.children) return;
  const overlaps = item => ranges.some(range => range.start < item.position.end.offset && range.end > item.position.start.offset);
  const children = [];
  let open = null;
  const put = (range, child) => {
    if (!range) { open = null; children.push(child); return; }
    if (open?.range !== range) { open = spoilerNode(range); children.push(open); }
    open.children.push(child);
  };
  for (const child of node.children) {
    if (!child.position || !overlaps(child)) { put(null, child); continue; }
    if (child.type === 'text') {
      const offsets = sourceOffsets(child, source);
      // 对不上位置（极少见）：整段按所在的范围遮住，宁可多遮。
      if (!offsets) { put(ranges.find(range => range.start < child.position.end.offset && range.end > child.position.start.offset), { type: 'text', value: child.value.replaceAll('||', '') }); continue; }
      let piece = '', pieceRange;
      const flush = () => { if (piece) put(pieceRange, { type: 'text', value: piece }); piece = ''; };
      offsets.forEach((at, index) => {
        const range = ranges.find(item => at >= item.start && at < item.end);
        if (range && isMarker(at, range)) return;
        if (range !== pieceRange) { flush(); pieceRange = range; }
        piece += child.value[index];
      });
      flush();
      continue;
    }
    // 段落、表格单元格这些块级节点即使整个落在范围里也不包（span 里不能放块），往里找行内的内容。
    const inside = !BLOCKS.has(child.type) && ranges.find(range => child.position.start.offset >= range.start && child.position.end.offset <= range.end);
    if (inside) {
      if (child.position.start.offset < inside.start + 2 || child.position.end.offset > inside.end - 2) stripMarkers(child, inside, source);
      put(inside, child);
      continue;
    }
    const literal = bareLink(child);
    coverSpoilers(child, ranges, source);
    // 网址的一部分在剧透里：链接地址只留没遮住的部分，免得悬停时露出来。
    if (literal) child.url = visibleText(child);
    put(null, child);
  }
  node.children = children;
}

// 气泡里的时间要跟在最后一行文字后面：在末尾放一个占位，渲染时换成时间。
const tailNode = () => ({ type: 'tail', data: { hName: 'span', hProperties: { className: ['tail-slot'] } } });
function remarkChat({ tokens, tail, source }) {
  return tree => {
    const ranges = spoilerRanges(source);
    if (ranges.length) coverSpoilers(tree, ranges, source);
    walk(tree, tokens);
    if (!tail) return;
    const last = tree.children.at(-1);
    if (last?.type === 'paragraph') last.children.push(tailNode());
    else tree.children.push({ type: 'paragraph', children: [tailNode()] });
  };
}

// 代码块：带语言名和复制按钮；高亮库按需加载，没写语言时自动识别。
let highlighter;
const loadHighlighter = () => highlighter ||= import('highlight.js/lib/common').then(module => module.default);
export function CodeBlock({ language, text }) {
  const [highlighted, setHighlighted] = React.useState(null);
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    setHighlighted(null);
    if (text.length > 20000) return;
    loadHighlighter().then(hljs => {
      if (!alive) return;
      const result = language && hljs.getLanguage(language) ? hljs.highlight(text, { language, ignoreIllegals: true })
        : !language && text.length < 4000 ? hljs.highlightAuto(text) : null;
      if (result && (language || result.relevance >= 5)) setHighlighted({ html: result.value, language: language || result.language });
    }).catch(() => {});
    return () => { alive = false; };
  }, [language, text]);
  const copy = async event => {
    event.stopPropagation();
    try { await (window.desktop?.copy ? window.desktop.copy(text) : copyText(text)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return <div className="code-block">
    <div className="code-head"><span>{language || highlighted?.language || '代码'}</span><button type="button" onClick={copy}>{copied ? '已复制' : '复制'}</button></div>
    {/* highlight.js 的输出已对代码做过转义 */}
    <pre>{highlighted ? <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted.html }} /> : <code>{text}</code>}</pre>
  </div>;
}

// 遮住的剧透：整块是一个按钮（可聚焦，回车或空格揭开），里面的内容 visibility: hidden，读屏不念、不能选中复制、里面的链接也点不到。
// 揭开状态只在这条消息这次显示时有效，不保存；揭开后不再遮回去。
// 揭开前后是同一个元素（揭开后 tabIndex=-1），用键盘揭开时焦点留在原处，不会掉到页面上。
function Spoiler({ children, ...props }) {
  const [shown, setShown] = React.useState(false);
  const reveal = event => { if (shown) return; event.preventDefault(); event.stopPropagation(); setShown(true); };
  return <span {...props} className={shown ? 'spoiler revealed' : 'spoiler'} role={shown ? undefined : 'button'} tabIndex={shown ? -1 : 0} aria-label={shown ? undefined : '剧透，按下显示'} title={shown ? undefined : '点击显示剧透'}
    onClick={reveal} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') reveal(event); }}><span className="spoiler-content" aria-hidden={shown ? undefined : 'true'}>{children}</span></span>;
}

// 组件表每个 FormattedText 只建一次：每次渲染都换新函数的话，React 会把整段重新挂载，揭开的剧透又被遮回去。时间从 ref 里取最新的。
function components(tailRef) {
  return {
    a: ({ href, children }) => <Link href={href}>{children}</Link>,
    img: ({ src, alt }) => <Link href={src}>{alt ? `[图片] ${alt}` : '[图片]'}</Link>,
    pre: ({ children }) => {
      const code = React.Children.toArray(children)[0]?.props || {};
      const language = /language-([\w+#-]+)/.exec(code.className || '')?.[1]?.toLowerCase();
      return <CodeBlock language={language} text={String(code.children ?? '').replace(/\n$/, '')} />;
    },
    table: ({ node, ...props }) => <div className="table-scroll"><table {...props} /></div>,
    span: ({ node, className, ...props }) => className === 'tail-slot' ? tailRef.current : className === 'spoiler' ? <Spoiler {...props} /> : <span className={className} {...props} />,
  };
}
const urlTransform = url => SAFE_URL.test(url) ? url : '';

export function FormattedText({ text, mentions = [], nameOf, viewerId, tail = null }) {
  const tokens = mentions.map(id => ({ id, self: id === viewerId || id === '*', label: `@${id === '*' ? '所有人' : nameOf?.(id) || ''}` }))
    .filter(token => token.label.length > 1).sort((a, b) => b.label.length - a.label.length);
  const tailRef = React.useRef(tail);
  tailRef.current = tail;
  const parts = React.useMemo(() => components(tailRef), []);
  return <div className="message-text markdown">
    <Markdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkCjkFriendly, [remarkChat, { tokens, tail: Boolean(tail), source: text }]]}
      components={parts} urlTransform={urlTransform}>{text}</Markdown>
  </div>;
}

// 正文里第一个网页链接（代码里和剧透里的不算），用来显示链接预览。
export const firstLink = text => [...maskSpoilers(text, ' ').replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]+`/g, '')
  .matchAll(URL_PATTERN)].map(match => match[0]).find(url => !messageLink(url) && !groupInviteLink(url)) || null;

const previews = new Map();
export function LinkPreview({ url }) {
  const [preview, setPreview] = React.useState(() => previews.get(url)?.value);
  React.useEffect(() => {
    let alive = true;
    if (!previews.has(url)) previews.set(url, { promise: api(`link-preview?url=${encodeURIComponent(url)}`).then(result => result.preview, () => null) });
    const entry = previews.get(url);
    entry.promise.then(value => { entry.value = value; if (alive) setPreview(value); });
    return () => { alive = false; };
  }, [url]);
  if (!preview) return null;
  return <a className="link-preview" href={preview.url} target="_blank" rel="noopener noreferrer" onClick={event => openLink(event, preview.url)}>
    <small>{preview.site}</small><b>{preview.title}</b>{preview.description && <span>{preview.description}</span>}
  </a>;
}

// 侧栏预览、通知、搜索里只要纯文字：服务端推送也要用，放在 shared/。
export { plainText } from '../shared/preview.js';

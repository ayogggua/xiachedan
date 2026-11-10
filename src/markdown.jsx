import { copyText } from './mobile/runtime';
import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly/parseOnly';
import { api } from './api';

// 消息格式：完整 Markdown（GFM 表格、待办、删除线等），中文加粗规则按 remark-cjk-friendly 放宽。
// 只生成 React 元素、不执行 HTML；链接只放行 http/https/mailto，外部图片不加载、只显示成链接。
// 网址遇到汉字或全角标点就结束：「看这个https://a.com，然后」只链接到 https://a.com。
const URL_PATTERN = /https?:\/\/[^\s<>\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]*[^\s<>.,!?;:'")\]\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/gu;
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
// 气泡里的时间要跟在最后一行文字后面：在末尾放一个占位，渲染时换成时间。
const tailNode = () => ({ type: 'tail', data: { hName: 'span', hProperties: { className: ['tail-slot'] } } });
function remarkChat({ tokens, tail }) {
  return tree => {
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

function components(tail) {
  return {
    a: ({ href, children }) => <Link href={href}>{children}</Link>,
    img: ({ src, alt }) => <Link href={src}>{alt ? `[图片] ${alt}` : '[图片]'}</Link>,
    pre: ({ children }) => {
      const code = React.Children.toArray(children)[0]?.props || {};
      const language = /language-([\w+#-]+)/.exec(code.className || '')?.[1]?.toLowerCase();
      return <CodeBlock language={language} text={String(code.children ?? '').replace(/\n$/, '')} />;
    },
    table: ({ node, ...props }) => <div className="table-scroll"><table {...props} /></div>,
    span: ({ node, className, ...props }) => className === 'tail-slot' ? tail : <span className={className} {...props} />,
  };
}
const urlTransform = url => SAFE_URL.test(url) ? url : '';

export function FormattedText({ text, mentions = [], nameOf, viewerId, tail = null }) {
  const tokens = mentions.map(id => ({ id, self: id === viewerId || id === '*', label: `@${id === '*' ? '所有人' : nameOf?.(id) || ''}` }))
    .filter(token => token.label.length > 1).sort((a, b) => b.label.length - a.label.length);
  return <div className="message-text markdown">
    <Markdown remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkCjkFriendly, [remarkChat, { tokens, tail: Boolean(tail) }]]}
      components={components(tail)} urlTransform={urlTransform}>{text}</Markdown>
  </div>;
}

// 正文里第一个网页链接（代码里的不算），用来显示链接预览。
export const firstLink = text => [...text.replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]+`/g, '')
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

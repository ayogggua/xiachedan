import React from 'react';
import { api } from './api';

// 消息里的简单格式（Markdown 子集）：**粗体**、*斜体*、~~删除线~~、`代码`、```代码块```、> 引用、- 列表、1. 列表、[文字](链接) 和自动识别的网址。
// 只生成 React 元素、不拼 HTML，链接只放行 http/https。
const INLINE = /(`[^`\n]+`)|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]*[^\s<>.,!?;:'")\]，。！？；：）】」])|\*\*([^*\n]+?)\*\*|~~([^~\n]+?)~~|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])|(?<![\p{L}\p{N}_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\p{L}\p{N}_])/gu;

function openLink(event, href) {
  if (!window.desktop?.openUrl) return;
  event.preventDefault();
  window.desktop.openUrl(href).catch(() => {});
}
const Link = ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" onClick={event => openLink(event, href)}>{children}</a>;

// 纯文字里的 @提及高亮。
function mentionParts(text, tokens, key) {
  if (!tokens.length) return [text];
  const parts = [];
  for (let start = 0; start < text.length;) {
    let found = null;
    for (const token of tokens) { const index = text.indexOf(token.label, start); if (index >= 0 && (!found || index < found.index)) found = { ...token, index }; }
    if (!found) { parts.push(text.slice(start)); break; }
    parts.push(text.slice(start, found.index), <span key={`${key}-m${found.index}`} className={`mention ${found.self ? 'self' : ''}`}>{found.label}</span>);
    start = found.index + found.label.length;
  }
  return parts;
}

function inline(text, tokens, key = 'i') {
  const parts = [];
  let last = 0, index = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push(...mentionParts(text.slice(last, match.index), tokens, `${key}-${index}`));
    const k = `${key}-${index++}`;
    const [whole, code, label, href, url, bold, strike, star, underscore] = match;
    if (code) parts.push(<code key={k}>{code.slice(1, -1)}</code>);
    else if (label) parts.push(<Link key={k} href={href}>{inline(label, tokens, k)}</Link>);
    else if (url) parts.push(<Link key={k} href={url}>{url}</Link>);
    else if (bold) parts.push(<strong key={k}>{inline(bold, tokens, k)}</strong>);
    else if (strike) parts.push(<del key={k}>{inline(strike, tokens, k)}</del>);
    else parts.push(<em key={k}>{inline(star || underscore, tokens, k)}</em>);
    last = match.index + whole.length;
  }
  if (last < text.length) parts.push(...mentionParts(text.slice(last), tokens, `${key}-end`));
  return parts;
}

// 按行切成段落、代码块、引用和列表；连续的普通行合成一段并保留换行。
function blocks(text) {
  const lines = text.split('\n');
  const result = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const body = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      result.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    const group = (pattern, type) => {
      const items = [];
      while (i < lines.length && pattern.test(lines[i])) items.push(lines[i++].replace(pattern, ''));
      result.push({ type, items });
    };
    if (/^>\s?/.test(line)) { group(/^>\s?/, 'quote'); continue; }
    if (/^\s*[-*•]\s+/.test(line)) { group(/^\s*[-*•]\s+/, 'ul'); continue; }
    if (/^\s*\d+[.)]\s+/.test(line)) { group(/^\s*\d+[.)]\s+/, 'ol'); continue; }
    const body = [];
    while (i < lines.length && !/^(```|>\s?|\s*[-*•]\s+|\s*\d+[.)]\s+)/.test(lines[i])) body.push(lines[i++]);
    result.push({ type: 'p', text: body.join('\n') });
  }
  return result;
}

export function FormattedText({ text, mentions = [], nameOf, viewerId, tail = null }) {
  const tokens = mentions.map(id => ({ id, self: id === viewerId || id === '*', label: `@${id === '*' ? '所有人' : nameOf?.(id) || ''}` }))
    .filter(token => token.label.length > 1).sort((a, b) => b.label.length - a.label.length);
  const list = blocks(text);
  const lastIndex = list.length - 1;
  return <div className="message-text">{list.map((block, index) => {
    const end = index === lastIndex && block.type === 'p' ? tail : null;
    if (block.type === 'code') return <pre key={index}><code>{block.text}</code></pre>;
    if (block.type === 'quote') return <blockquote key={index}>{block.items.map((item, line) => <React.Fragment key={line}>{line > 0 && '\n'}{inline(item, tokens, `${index}-${line}`)}</React.Fragment>)}</blockquote>;
    if (block.type === 'ul' || block.type === 'ol') { const List = block.type; return <List key={index}>{block.items.map((item, line) => <li key={line}>{inline(item, tokens, `${index}-${line}`)}</li>)}</List>; }
    return <p key={index}>{inline(block.text, tokens, `${index}`)}{end}</p>;
  })}{list.at(-1)?.type !== 'p' && tail}</div>;
}

// 正文里第一个网页链接（代码里的不算），用来显示链接预览。
export const firstLink = text => text.replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]+`/g, '')
  .match(/https?:\/\/[^\s<>]*[^\s<>.,!?;:'")\]，。！？；：）】」]/)?.[0] || null;

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

// 侧栏预览、通知里只要纯文字：去掉格式符号。
export const plainText = text => text
  .replace(/```[^\n]*\n?/g, '').replace(/`([^`\n]+)`/g, '$1').replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
  .replace(/\*\*([^*\n]+?)\*\*/g, '$1').replace(/~~([^~\n]+?)~~/g, '$1').replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, '$1').replace(/^>\s?/gm, '').replace(/^\s*[-*•]\s+/gm, '· ');

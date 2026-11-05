// 把从网页、文档里复制的富文本（HTML）转成聊天里的 Markdown，只处理常见格式，不加依赖。
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR', 'LI', 'TR']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'IMG', 'SVG', 'VIDEO', 'AUDIO', 'IFRAME', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

const wrap = (mark, text) => { const inner = text.trim(); return inner ? `${text.match(/^\s*/)[0]}${mark}${inner}${mark}${text.match(/\s*$/)[0]}` : text; };
const cellText = cell => inline(cell).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();

function inline(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) { out += child.textContent.replace(/\s+/g, ' '); continue; }
    if (child.nodeType !== 1 || SKIP.has(child.tagName)) continue;
    if (BLOCK.has(child.tagName)) { out += `\n${block(child).trim()}\n`; continue; }
    const style = child.getAttribute('style') || '';
    const text = inline(child);
    const tag = child.tagName;
    // Google 文档等用样式表示粗体、斜体；外层的 <b style="font-weight:normal"> 不算粗体。
    const bold = ((tag === 'B' || tag === 'STRONG') && !/font-weight:\s*(normal|[1-5]00)\b/.test(style)) || /font-weight:\s*(bold|[6-9]00)\b/.test(style);
    const italic = tag === 'I' || tag === 'EM' || /font-style:\s*italic/.test(style);
    const strike = tag === 'S' || tag === 'DEL' || tag === 'STRIKE' || /line-through/.test(style);
    if (tag === 'BR') out += '\n';
    else if (tag === 'CODE') out += child.textContent.includes('`') ? text : `\`${child.textContent}\``;
    else if (tag === 'A') { const href = child.getAttribute('href') || ''; out += /^https?:\/\//i.test(href) && text.trim() ? (text.trim() === href ? href : `[${text.trim()}](${href})`) : text; }
    else { let value = text; if (strike) value = wrap('~~', value); if (italic) value = wrap('*', value); if (bold) value = wrap('**', value); out += value; }
  }
  return out;
}

function list(node, depth) {
  const ordered = node.tagName === 'OL';
  return [...node.children].filter(item => item.tagName === 'LI').map((item, index) => {
    const nested = [...item.children].filter(child => child.tagName === 'UL' || child.tagName === 'OL');
    const clone = item.cloneNode(true);
    clone.querySelectorAll(':scope > ul, :scope > ol').forEach(child => child.remove());
    const marker = ordered ? `${index + 1}.` : '-';
    const head = `${'  '.repeat(depth)}${marker} ${inline(clone).replace(/\n+/g, ' ').trim()}`;
    return [head, ...nested.map(child => list(child, depth + 1))].join('\n');
  }).join('\n');
}

function table(node) {
  const rows = [...node.querySelectorAll('tr')].map(row => [...row.children].map(cellText));
  if (!rows.length) return '';
  const width = Math.max(...rows.map(row => row.length));
  const line = row => `| ${Array.from({ length: width }, (_, index) => row[index] || '').join(' | ')} |`;
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n');
}

function block(node) {
  const tag = node.tagName;
  if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inline(node).replace(/\n+/g, ' ').trim()}`;
  if (tag === 'UL' || tag === 'OL') return list(node, 0);
  if (tag === 'TABLE') return table(node);
  if (tag === 'HR') return '---';
  if (tag === 'PRE') {
    const code = node.querySelector('code');
    const language = /language-([\w+#-]+)/.exec(code?.className || node.className || '')?.[1] || '';
    return `\`\`\`${language}\n${node.textContent.replace(/\n$/, '')}\n\`\`\``;
  }
  if (tag === 'BLOCKQUOTE') return blocks(node).split('\n').map(line => `> ${line}`).join('\n');
  return blocks(node);
}

function blocks(node) {
  const parts = [];
  let run = '';
  const flush = () => { if (run.trim()) parts.push(run.replace(/[ \t]+\n/g, '\n').trim()); run = ''; };
  for (const child of node.childNodes) {
    if (child.nodeType === 1 && BLOCK.has(child.tagName) && !SKIP.has(child.tagName)) { flush(); const value = block(child).trim(); if (value) parts.push(value); }
    else if (child.nodeType === 3) run += child.textContent.replace(/\s+/g, ' ');
    else if (child.nodeType === 1 && !SKIP.has(child.tagName)) { const wrapper = document.createElement('span'); wrapper.append(child.cloneNode(true)); run += inline(wrapper); }
  }
  flush();
  return parts.join('\n\n');
}

// 只有 HTML 里确实带格式时才转换；返回 null 表示按纯文本粘贴。
export function htmlToMarkdown(html) {
  if (!/<(b|strong|i|em|s|del|a|code|pre|h[1-6]|ul|ol|table|blockquote|span[^>]+font-(weight|style))\b/i.test(html)) return null;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const markdown = blocks(body).replace(/\n{3,}/g, '\n\n').trim();
  return markdown || null;
}

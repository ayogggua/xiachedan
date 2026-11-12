// 剧透：||文字|| 遮住，点了才显示。只在同一行里按出现顺序两两配对，代码块和行内代码里的不算，转义的 \| 不算；
// 两个 || 之间要有非空白内容，否则原样显示。消息渲染（src/markdown.jsx）和下面的纯文字预览用的是同一份范围，
// 所以预览里遮住的不会比聊天里遮住的少。返回 [{ start, end }]：start 是开头 || 的位置，end 是结尾 || 之后的位置。
export function spoilerRanges(text) {
  const ranges = [];
  if (typeof text !== 'string' || !text.includes('||')) return ranges;
  let fence = null, offset = 0;
  for (const line of text.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length && !line.slice(opener[0].length).trim()) fence = null; continue; }
    if (opener) { fence = opener[1]; continue; }
    const markers = [];
    for (let i = 0; i < line.length;) {
      if (line[i] === '\\') { i += 2; continue; }
      if (line[i] === '`') {
        // 行内代码：同样长度的一串反引号才闭合；没闭合的反引号按普通字符。
        const run = /^`+/.exec(line.slice(i))[0];
        let close = -1;
        for (let j = line.indexOf(run, i + run.length); j >= 0; j = line.indexOf(run, j + 1)) {
          const end = j + run.length;
          if (line[j - 1] !== '`' && line[end] !== '`') { close = end; break; }
        }
        i = close >= 0 ? close : i + run.length;
        continue;
      }
      if (line[i] === '|' && line[i + 1] === '|') { markers.push(i); i += 2; continue; }
      i++;
    }
    for (let k = 0; k + 1 < markers.length; k += 2) {
      if (line.slice(markers[k] + 2, markers[k + 1]).trim()) ranges.push({ start: lineStart + markers[k], end: lineStart + markers[k + 1] + 2 });
    }
  }
  return ranges;
}
// 正文里的网址：消息渲染成链接、链接预览取第一个网址、阅后即焚销毁时清理链接预览缓存，都用这一个规则，认出的网址才一致。
// 中文、全角标点不算在网址里；结尾的英文标点也不算。
export const URL_PATTERN = /https?:\/\/[^\s<>\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]*[^\s<>.,!?;:'")\]\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/gu;
// 剧透的部分换成「[剧透]」：预览、通知、推送、引用、搜索结果都不露出内容。
export const SPOILER_LABEL = '[剧透]';
// label 可换：找网址时换成空格（网址到剧透前就结束），校验引用时换成引用里不会出现的字符。
export const maskSpoilers = (text, label = SPOILER_LABEL) => spoilerRanges(text).reduceRight((result, range) => result.slice(0, range.start) + label + result.slice(range.end), text);
// 截取已遮好的文字：不在 [剧透] 中间截断，截到一半的那个占位整个去掉（长度不超过 max）。
export const cutMasked = (text, max) => {
  const part = text.slice(0, max), open = part.lastIndexOf('[');
  return open >= 0 && part.length - open < SPOILER_LABEL.length && text.startsWith(SPOILER_LABEL, open) ? part.slice(0, open) : part;
};
// 比较引用片段和原文时忽略格式符号和空白：原文是 Markdown，用户选中的是渲染后的文字。
export const looseText = text => text.replace(/[*_~`#>|\\[\]()!-]/g, '').replace(/\s+/g, '').toLowerCase();
// 部分引用只能引用没遮住的文字：剧透的范围换成一个引用里不会有的字符，选中的一段碰到剧透就对不上。
export const quotable = (text, quote) => { const part = looseText(quote || ''); return Boolean(part) && looseText(maskSpoilers(text || '', '\u0000')).includes(part); };

// 纯文字预览：侧栏、通知、搜索，以及服务端推送共用（客户端和服务端都能引用）。
export const plainText = text => maskSpoilers(text)
  .replace(/```[^\n]*\n?/g, '').replace(/^#{1,6}[ \t]+/gm, '').replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')
  .replace(/^[ \t]*\|?([ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*$/gm, '').replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row) => row.split('|').map(cell => cell.trim()).join('  '))
  .replace(/!\[([^\]\n]*)\]\([^)\s]+\)/g, (_, alt) => alt ? `[图片] ${alt}` : '[图片]')
  .replace(/`([^`\n]+)`/g, '$1').replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
  .replace(/\*\*([^*\n]+?)\*\*/g, '$1').replace(/__([^_\n]+?)__/g, '$1').replace(/~~([^~\n]+?)~~/g, '$1').replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, '$1')
  .replace(/^>[ \t]?/gm, '').replace(/^[ \t]*[-*+•][ \t]+\[[ xX]\][ \t]+/gm, '· ').replace(/^[ \t]*[-*+•][ \t]+/gm, '· ').replace(/\n{3,}/g, '\n\n').trim();
// 发送时标成剧透的图片和视频只说类型，不带文件名。
const spoilerMedia = files => files.some(file => file.spoiler && /^(image|video)\//.test(file.mime));
export const attachmentLabel = files => files.some(file => file.sticker) ? '[表情]' : files.some(file => file.mime.startsWith('video/')) ? spoilerMedia(files) ? '[剧透视频]' : '[视频]' : files.some(file => file.mime.startsWith('image/')) ? spoilerMedia(files) ? '[剧透图片]' : '[图片]' : `[文件] ${files[0]?.name || ''}`;
// 阅后即焚消息在所有预览里（会话列表、通知、推送、引用、置顶、搜索、标题）只说「[阅后即焚消息]」，发送人自己看也一样。
export const BURN_LABEL = '[阅后即焚消息]';
export const previewText = message => message ? message.recalledAt ? message.removedBy ? '消息已被管理员删除' : '消息已撤回' : message.burn ? BURN_LABEL : (message.nudge ? '[拍一拍]' : message.card ? '[名片]' : message.bundle ? `[聊天记录] ${message.text}` : message.poll ? `[投票] ${message.text}` : message.chain ? `[接龙] ${message.text}` : message.text && plainText(message.text)) || attachmentLabel(message.attachments) : '还没有消息，来打个招呼吧';

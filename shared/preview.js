// 纯文字预览：侧栏、通知、搜索，以及服务端推送共用（客户端和服务端都能引用）。
export const plainText = text => text
  .replace(/```[^\n]*\n?/g, '').replace(/^#{1,6}[ \t]+/gm, '').replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '')
  .replace(/^[ \t]*\|?([ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*$/gm, '').replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row) => row.split('|').map(cell => cell.trim()).join('  '))
  .replace(/!\[([^\]\n]*)\]\([^)\s]+\)/g, (_, alt) => alt ? `[图片] ${alt}` : '[图片]')
  .replace(/`([^`\n]+)`/g, '$1').replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
  .replace(/\*\*([^*\n]+?)\*\*/g, '$1').replace(/__([^_\n]+?)__/g, '$1').replace(/~~([^~\n]+?)~~/g, '$1').replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, '$1')
  .replace(/^>[ \t]?/gm, '').replace(/^[ \t]*[-*+•][ \t]+\[[ xX]\][ \t]+/gm, '· ').replace(/^[ \t]*[-*+•][ \t]+/gm, '· ').replace(/\n{3,}/g, '\n\n').trim();
export const attachmentLabel = files => files.some(file => file.sticker) ? '[表情]' : files.some(file => file.mime.startsWith('video/')) ? '[视频]' : files.some(file => file.mime.startsWith('image/')) ? '[图片]' : `[文件] ${files[0]?.name || ''}`;
export const previewText = message => message ? message.recalledAt ? message.removedBy ? '消息已被管理员删除' : '消息已撤回' : (message.nudge ? '[拍一拍]' : message.card ? '[名片]' : message.bundle ? `[聊天记录] ${message.text}` : message.poll ? `[投票] ${message.text}` : message.text && plainText(message.text)) || attachmentLabel(message.attachments) : '还没有消息，来打个招呼吧';

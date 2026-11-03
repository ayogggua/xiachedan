import { plainText } from './markdown';
// 引用里的原消息在本地被撤回或清空后，同样只保留标识。
const sanitizeReply = (reply, history) => !reply || reply.missing || reply.recalled ? reply :
  reply.seq <= history.throughSeq ? { id: reply.id, missing: true } : history.recalls.has(reply.id) ? { id: reply.id, seq: reply.seq, senderId: reply.senderId, recalled: true } : reply;
export const sanitizeMessage = (message, history) => !message || message.seq <= history.throughSeq ? null :
  (message.recalledAt || history.recalls.has(message.id)) ? (message.recalledAt && !message.text && !message.attachments.length && !message.readBy?.length && message.replyTo === null ? message
    : { ...message, recalledAt: message.recalledAt || history.recalls.get(message.id), text: '', attachments: [], readBy: [], replyTo: null })
  : message.replyTo && sanitizeReply(message.replyTo, history) !== message.replyTo ? { ...message, replyTo: sanitizeReply(message.replyTo, history) } : message;
export const sanitizeState = (state, history) => ({ ...state, rooms: state.rooms.map(room => ({ ...room, lastMessage: sanitizeMessage(room.lastMessage, history) })) });
export const merge = (a, b, history) => {
  const messages = new Map(a.map(message => [message.id, message]));
  for (const message of b) {
    const previous = messages.get(message.id);
    messages.set(message.id, { ...previous, ...message, recalledAt: previous?.recalledAt || message.recalledAt,
      ...(previous?.readBy || message.readBy ? { readBy: [...new Set([...(previous?.readBy || []), ...(message.readBy || [])])] } : {}) });
  }
  return [...messages.values()].map(message => sanitizeMessage(message, history)).filter(Boolean).sort((a, b) => a.seq - b.seq);
};
export const readStorage = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const attachmentLabel = files => files.some(file => file.mime.startsWith('video/')) ? '[视频]' : files.some(file => file.mime.startsWith('image/')) ? '[图片]' : `[文件] ${files[0]?.name || ''}`;
export const previewText = message => message ? message.recalledAt ? message.removedBy ? '消息已被管理员删除' : '消息已撤回' : (message.bundle ? `[聊天记录] ${message.text}` : message.poll ? `[投票] ${message.text}` : message.text && plainText(message.text)) || attachmentLabel(message.attachments) : '还没有消息，来打个招呼吧';

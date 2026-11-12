// 引用里的原消息在本地被撤回或清空后，同样只保留标识。
const sanitizeReply = (reply, history) => !reply || reply.missing || reply.recalled ? reply :
  reply.seq <= history.throughSeq ? { id: reply.id, missing: true } : history.recalls.has(reply.id) ? { id: reply.id, seq: reply.seq, senderId: reply.senderId, recalled: true } : reply;
// 只对自己删除的消息、清空过的会话里更早的消息：本地一律当作不存在。
const hiddenLocally = (message, history) => history.hidden?.has(message.id) || message.seq <= (history.cleared?.[message.roomId] || 0);
export const sanitizeMessage = (message, history) => !message || message.seq <= history.throughSeq || hiddenLocally(message, history) ? null :
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
// 阅后即焚的销毁时刻换算成本机时间：服务器给出 expiresAt 和它自己的 now，差值加到收到时的本机时间上，不依赖两边时钟一致。
// 同一份 burn 只换算一次（合并消息时 burn 对象原样保留），倒计时不会因为重新渲染而漂移。
const deadlines = new WeakMap();
export const burnDeadline = burn => {
  if (!burn?.expiresAt) return null;
  if (!deadlines.has(burn)) deadlines.set(burn, Date.now() + burn.expiresAt - (burn.now ?? burn.expiresAt));
  return deadlines.get(burn);
};
export const readStorage = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
export { previewText } from '../shared/preview.js';

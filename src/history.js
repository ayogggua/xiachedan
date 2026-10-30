export const sanitizeMessage = (message, history) => !message || message.seq <= history.throughSeq ? null :
  (message.recalledAt || history.recalls.has(message.id)) ? { ...message, recalledAt: message.recalledAt || history.recalls.get(message.id), text: '', attachments: [], readBy: [] } : message;
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
export const previewText = message => message ? message.recalledAt ? '消息已撤回' : message.text || (message.attachments.some(file => file.mime.startsWith('video/')) ? '[视频]' : '[图片]') : '还没有消息，来打个招呼吧';

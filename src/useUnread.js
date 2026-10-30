import { useEffect, useState } from 'react';
import { api } from './api';

const cursor = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

export default function useUnread(state, messages, lastRead, connected, historyVersion) {
  const [snapshot, setSnapshot] = useState({});
  const userId = state?.me.id;
  const roomVersions = JSON.stringify(state?.rooms.map(room => [room.id, room.lastMessage?.seq || 0]) || []);
  const cursors = JSON.stringify(Object.fromEntries((state?.rooms || []).map(room => [room.id, cursor(lastRead[room.id])])));

  useEffect(() => {
    if (!userId || !connected) return;
    const controller = new AbortController();
    let retry, attempts = 0;
    async function synchronize() {
      try {
        const result = await api('unread-counts', { cursors: JSON.parse(cursors) }, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        });
        if (!controller.signal.aborted) setSnapshot({ userId, historyVersion, rooms: Object.fromEntries(result.rooms.map(room => [room.id, room])) });
      } catch (error) {
        // Older hosts still show a new-message badge; reconnecting to an updated host restores exact counts.
        if (!controller.signal.aborted && error.status !== 404 && ++attempts < 3) retry = setTimeout(synchronize, attempts * 2000);
      }
    }
    synchronize();
    return () => { controller.abort(); clearTimeout(retry); };
  }, [userId, roomVersions, cursors, connected, historyVersion]);

  return Object.fromEntries((state?.rooms || []).map(room => {
    const afterSeq = cursor(lastRead[room.id]);
    const saved = snapshot.userId === userId ? snapshot.rooms?.[room.id] : null;
    const exact = snapshot.historyVersion === historyVersion && saved?.afterSeq === afterSeq;
    const throughSeq = Math.max(afterSeq, exact ? saved.throughSeq : 0);
    // Socket events beyond the server snapshot are counted once, even if a response arrives later.
    const counted = (messages[room.id] || []).filter(message => !message.recalledAt && message.senderId !== userId);
    const liveCount = counted.filter(message => message.seq > throughSeq && !message.readBy?.includes(userId)).length;
    // 隐私模式下可以先看后面的消息，游标却停在更早的未读处；已回执过的消息不再计入未读。
    const seenAhead = exact ? counted.filter(message => message.seq > afterSeq && message.seq <= throughSeq && message.readBy?.includes(userId)).length : 0;
    const count = (exact ? saved.unreadCount - seenAhead : 0) + liveCount;
    const hasUnread = count > 0 || (!exact && !room.lastMessage?.recalledAt && room.lastMessage?.senderId !== userId && room.lastMessage?.seq > afterSeq);
    return [room.id, { count, exact, hasUnread }];
  }));
}

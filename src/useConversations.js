import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readStorage } from './history';

function readPreferences(key) {
  const saved = key ? readStorage(key, {}) : {};
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}

// 会话列表偏好只属于本机的当前空间、当前账号，不改变成员关系或聊天记录。
export default function useConversations({ state, spaceId, selected, onSelect, notify }) {
  const scope = state?.me.id ? JSON.stringify([spaceId || location.origin, state.me.id]) : null;
  const key = scope && `linliao.conversations:${scope}`;
  const [saved, setSaved] = useState({ key: null, preferences: {} });
  const preferences = useMemo(() => saved.key === key ? saved.preferences : readPreferences(key), [key, saved]);
  const rooms = (state?.rooms || []).map(room => {
    const preference = preferences[room.id];
    const removed = Number.isSafeInteger(preference?.removedThroughSeq) && preference.removedThroughSeq >= 0;
    return { ...room, pinned: preference?.pinned === true,
      hidden: removed && (room.lastMessage?.seq || 0) <= preference.removedThroughSeq };
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastMessage?.seq || 0) - (a.lastMessage?.seq || 0));
  const current = useRef();
  current.current = { key, scope, preferences, rooms, selected, onSelect, notify };

  const save = useCallback(preferences => {
    const context = current.current;
    if (!context.key) return false;
    try { localStorage.setItem(context.key, JSON.stringify(preferences)); }
    catch { context.notify('无法保存会话设置，请检查本机存储空间'); return false; }
    current.current = { ...context, preferences };
    setSaved({ key: context.key, preferences });
    return true;
  }, []);
  const restore = useCallback(id => {
    const preferences = current.current.preferences;
    if (preferences[id]?.removedThroughSeq === undefined) return true;
    const { removedThroughSeq, ...preference } = preferences[id];
    return save({ ...preferences, [id]: preference });
  }, [save]);
  const act = useCallback((action, id, expectedScope) => {
    const context = current.current;
    if (!context.scope || context.scope !== expectedScope) return;
    const room = context.rooms.find(room => room.id === id);
    if (!room) return;
    const preference = { ...context.preferences[id] };
    if (action === 'pin' || action === 'unpin') {
      preference.pinned = action === 'pin';
      delete preference.removedThroughSeq;
    } else if (action === 'remove') {
      preference.pinned = false;
      preference.removedThroughSeq = room.lastMessage?.seq || 0;
    } else return;
    if (!save({ ...context.preferences, [id]: preference })) return;
    if (action === 'remove' && context.selected === id) {
      context.onSelect(context.rooms.find(room => room.id !== id && !room.hidden)?.id || null);
    }
  }, [save]);

  // 收到新消息或重连发现新消息时恢复会话；恢复后清空标记，撤回/清空记录也不会再次隐藏它。
  const revived = JSON.stringify(rooms.filter(room => !room.hidden && preferences[room.id]?.removedThroughSeq !== undefined).map(room => room.id));
  useEffect(() => {
    const ids = JSON.parse(revived);
    if (!ids.length) return;
    const next = { ...current.current.preferences };
    for (const id of ids) { next[id] = { ...next[id] }; delete next[id].removedThroughSeq; }
    save(next);
  }, [key, revived, save]);
  const visibleIds = JSON.stringify(rooms.filter(room => !room.hidden).map(room => room.id));
  useEffect(() => {
    if (!scope || selected === null) return;
    const ids = JSON.parse(visibleIds);
    if (!ids.includes(selected)) onSelect(ids[0] || null);
  }, [scope, selected, visibleIds, onSelect]);

  return { rooms, scope, restore, act };
}

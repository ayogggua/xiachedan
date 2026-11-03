import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { readStorage } from './history';

// 发件箱：发出的消息先排队，显示在会话底部；断网或服务暂时不可用时留在队列里，连上后按顺序自动重发。
// 每条消息的 clientId 不变，服务端按它去重，响应丢失后重发也不会出现两条。队列存在本机，重启后继续。
const temporary = error => !error.status || error.status >= 500 || error.status === 429;

export default function useOutbox({ storageKey, connected, onSent }) {
  const [items, setItems] = useState([]);
  const context = useRef({ key: null, items: [], running: false, connected, onSent });
  context.current.connected = connected;
  context.current.onSent = onSent;

  const commit = useCallback(next => {
    context.current.items = next;
    setItems(next);
    if (!context.current.key) return;
    try { localStorage.setItem(context.current.key, JSON.stringify(next.map(({ status, error, ...item }) => item))); } catch {}
  }, []);
  const patch = useCallback((clientId, change) => commit(context.current.items.map(item => item.clientId === clientId ? { ...item, ...change } : item)), [commit]);

  const flush = useCallback(async () => {
    if (context.current.running) return;
    context.current.running = true;
    try {
      while (context.current.connected) {
        const item = context.current.items.find(entry => entry.status === 'waiting');
        if (!item) break;
        patch(item.clientId, { status: 'sending', error: '' });
        try {
          const { message } = await api('messages', item.payload);
          commit(context.current.items.filter(entry => entry.clientId !== item.clientId));
          context.current.onSent(message);
        } catch (error) {
          if (temporary(error)) { patch(item.clientId, { status: 'waiting', error: '网络不稳定，连接恢复后自动重发' }); break; }
          patch(item.clientId, { status: 'failed', error: error.message });
        }
      }
    } finally { context.current.running = false; }
  }, [commit, patch]);

  useEffect(() => {
    context.current.key = storageKey;
    const saved = storageKey ? readStorage(storageKey, []) : [];
    commit(Array.isArray(saved) ? saved.filter(item => item?.clientId && item.payload).map(item => ({ ...item, status: 'waiting' })) : []);
  }, [storageKey, commit]);
  useEffect(() => { if (connected) flush(); }, [connected, flush, storageKey]);

  const send = useCallback((payload, preview) => {
    commit([...context.current.items, { clientId: payload.clientId, roomId: payload.roomId, payload, preview, createdAt: Date.now(), status: 'waiting' }]);
    flush();
  }, [commit, flush]);
  const retry = useCallback(clientId => { patch(clientId, { status: 'waiting', error: '' }); flush(); }, [patch, flush]);
  const discard = useCallback(clientId => commit(context.current.items.filter(item => item.clientId !== clientId)), [commit]);
  return { items, send, retry, discard };
}

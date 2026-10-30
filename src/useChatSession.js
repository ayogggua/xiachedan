import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { merge, previewText, sanitizeMessage, sanitizeState } from './history';
import useMessageReads from './useMessageReads';

// 空间会话的数据层：启动、状态同步、WebSocket、分页消息、撤回与清空记录、已读回执。
export default function useChatSession({ selected, notify, privacyRef, onHistoryChanged }) {
  const [bootstrap, setBootstrap] = useState(null);
  const [state, setState] = useState(null);
  const [startupError, setStartupError] = useState('');
  const [messages, setMessages] = useState({});
  const [hasMore, setHasMore] = useState({});
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const historyRef = useRef({ throughSeq: 0, recalls: new Map() });
  const reconnect = useRef();
  const activeRoom = useRef(selected);
  const stateRef = useRef(state);
  const messagesRef = useRef(messages);
  const historyChanged = useRef(onHistoryChanged);
  activeRoom.current = selected;
  stateRef.current = state;
  messagesRef.current = messages;
  historyChanged.current = onHistoryChanged;
  const syncHistory = useCallback((recalls = [], throughSeq = 0) => {
    const history = historyRef.current;
    const cleared = throughSeq > history.throughSeq;
    if (cleared) { history.throughSeq = throughSeq; setHasMore({}); }
    let changed = cleared;
    for (const item of recalls) {
      if (history.recalls.has(item.id)) continue;
      history.recalls.set(item.id, item.recalledAt); changed = true;
      window.desktop?.recalled?.({ id: item.id, roomId: item.roomId }).catch(() => {});
    }
    if (!changed) return;
    historyChanged.current?.({ cleared });
    setMessages(previous => Object.fromEntries(Object.entries(previous).map(([id, items]) => [id, merge(items, [], history)])));
    setState(previous => previous ? sanitizeState(previous, history) : previous);
    setHistoryVersion(value => value + 1);
    if (cleared) window.desktop?.historyCleared?.().catch(() => {});
  }, []);
  const refresh = useCallback(async () => {
    try { const next = await api('state'); syncHistory(next.recalls, next.clearedThroughSeq); setState(sanitizeState(next, historyRef.current)); return next; }
    catch (error) { if (error.status === 401) location.reload(); throw error; }
  }, [syncHistory]);
  const applyReceipt = useCallback(receipt => {
    const ids = new Set(receipt.messageIds);
    setMessages(previous => {
      const roomMessages = previous[receipt.roomId];
      if (!roomMessages) return previous;
      return { ...previous, [receipt.roomId]: roomMessages.map(message => ids.has(message.id) ?
        { ...message, readBy: [...new Set([...(message.readBy || []), receipt.userId])] } : message) };
    });
  }, []);
  const reportRead = useMessageReads(state?.me.id, connected, applyReceipt);
  const meId = state?.me.id;
  // 先在本地记为已读，未读角标立即更新；回执在后台上报。
  const markMessageRead = useCallback((roomId, messageId) => {
    applyReceipt({ roomId, userId: meId, messageIds: [messageId] });
    reportRead(roomId, messageId);
  }, [applyReceipt, reportRead, meId]);
  const start = useCallback(async () => {
    setStartupError('');
    try { const result = await api('bootstrap'); setBootstrap(result); if (result.me) { syncHistory(result.recalls, result.clearedThroughSeq); setState(sanitizeState(result, historyRef.current)); } }
    catch { setStartupError('暂时无法连接到聊天空间，请确认创建空间的 Mac 正在运行虾扯蛋。'); }
  }, [syncHistory]);
  useEffect(() => { start(); }, [start]);
  const receive = useCallback(message => {
    if (message.recalledAt) syncHistory([message]);
    message = sanitizeMessage(message, historyRef.current);
    if (!message) return;
    setMessages(previous => ({ ...previous, [message.roomId]: merge(previous[message.roomId] || [], [message], historyRef.current) }));
    setState(previous => previous ? { ...previous, rooms: previous.rooms.map(room => room.id === message.roomId && (!room.lastMessage || room.lastMessage.seq < message.seq) ? { ...room, lastMessage: message } : room) } : previous);
    const current = stateRef.current;
    if (!message.recalledAt && window.desktop?.message && current && message.senderId !== current.me.id) {
      const sender = current.users.find(user => user.id === message.senderId);
      const target = current.rooms.find(room => room.id === message.roomId);
      const hidden = privacyRef.current;
      const title = hidden ? '虾扯蛋 · 新消息' : `${sender?.name || '新消息'}${target && target.kind !== 'direct' ? ` · ${target.name}` : ''}`;
      window.desktop.message({ id: message.id, roomId: message.roomId, privateMode: hidden,
        title: title.slice(0, 120), body: hidden ? '****' : previewText(message).slice(0, 240),
      }).catch(error => notify(error.message));
    }
  }, [notify, syncHistory, privacyRef]);
  useEffect(() => {
    if (!state?.me.id) return;
    let cancelled = false, socket, delay = 700;
    async function synchronize() {
      try {
        await refresh();
        const roomId = activeRoom.current;
        const result = await api(`messages?roomId=${encodeURIComponent(roomId)}`);
        if (!cancelled) {
          setMessages(previous => ({ ...previous, [roomId]: merge(previous[roomId] || [], result.messages, historyRef.current) }));
          setHasMore(previous => ({ ...previous, [roomId]: result.hasMore }));
        }
      } catch (error) { if (!cancelled) notify(error.message); }
    }
    function connect() {
      if (cancelled) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`);
      socket.onopen = () => { if (cancelled) return socket.close(); setConnected(true); delay = 700; synchronize(); };
      socket.onmessage = event => {
        let data; try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'message') receive(data.message);
        if (data.type === 'message-recalled') syncHistory([data.message]);
        if (data.type === 'history-cleared') { syncHistory([], data.throughSeq); refresh().catch(error => notify(error.message)); }
        if (data.type === 'message-reads') applyReceipt(data);
        if (data.type === 'users') setState(previous => ({ ...previous, users: data.users, me: data.users.find(user => user.id === previous.me.id) || previous.me }));
        if (data.type === 'rooms') refresh().catch(error => notify(error.message));
      };
      socket.onclose = event => { if (cancelled) return; if (event.code === 4003 || event.code === 4001) { location.reload(); return; } setConnected(false); reconnect.current = setTimeout(connect, delay); delay = Math.min(delay * 1.7, 10000); };
      socket.onerror = () => socket.close();
    }
    connect();
    return () => { cancelled = true; clearTimeout(reconnect.current); socket?.close(); };
  }, [state?.me.id, refresh, receive, notify, applyReceipt, syncHistory]);
  useEffect(() => {
    if (!state?.me.id) return;
    let cancelled = false;
    setLoading(true);
    api(`messages?roomId=${encodeURIComponent(selected)}`).then(result => {
      if (cancelled) return;
      setMessages(previous => ({ ...previous, [selected]: merge(previous[selected] || [], result.messages, historyRef.current) }));
      setHasMore(previous => ({ ...previous, [selected]: result.hasMore }));
    }).catch(error => { if (!cancelled) notify(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, state?.me.id, notify]);
  async function loadOlder() {
    const current = messages[selected] || [];
    if (loading || !current.length) return false;
    setLoading(true);
    try {
      const result = await api(`messages?roomId=${encodeURIComponent(selected)}&before=${current[0].seq}`);
      setMessages(previous => ({ ...previous, [selected]: merge(result.messages, previous[selected] || [], historyRef.current) }));
      setHasMore(previous => ({ ...previous, [selected]: result.hasMore }));
      return true;
    } catch (error) { notify(error.message); return false; } finally { setLoading(false); }
  }
  // 向前补齐历史直到包含指定消息，供聊天记录搜索跳转。
  const loadThrough = useCallback(async (roomId, seq) => {
    let oldest = (messagesRef.current[roomId] || [])[0]?.seq ?? Number.MAX_SAFE_INTEGER;
    const pages = [];
    let more = true;
    while (oldest > seq && more) {
      const result = await api(`messages?roomId=${encodeURIComponent(roomId)}&before=${oldest}`);
      if (!result.messages.length) { more = false; break; }
      pages.push(...result.messages);
      more = result.hasMore;
      oldest = result.messages[0].seq;
    }
    if (!pages.length) return;
    setMessages(previous => ({ ...previous, [roomId]: merge(pages, previous[roomId] || [], historyRef.current) }));
    setHasMore(previous => ({ ...previous, [roomId]: more }));
  }, []);
  function updateMe(me) { setState(previous => ({ ...previous, me, users: previous.users.map(user => user.id === me.id ? { ...user, ...me } : user) })); }
  return { bootstrap, state, startupError, start, refresh, messages, hasMore, loading, connected, historyVersion,
    syncHistory, receive, markMessageRead, loadOlder, loadThrough, updateMe };
}

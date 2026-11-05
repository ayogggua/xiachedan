import { useCallback, useEffect, useRef, useState } from 'react';
import { api, socketUrl } from './api';
import { chatPref } from './chatPrefs';
import { playMessageSound } from './sound';
import { merge, previewText, sanitizeMessage, sanitizeState } from './history';
import { plainText } from './markdown';
import useMessageReads from './useMessageReads';
import { isQuiet } from './quiet';

// 空间会话的数据层：启动、状态同步、WebSocket、分页消息、撤回与清空记录、已读回执。
export default function useChatSession({ selected, notify, privacyRef, mutedRef, onHistoryChanged }) {
  const [bootstrap, setBootstrap] = useState(null);
  const [state, setState] = useState(null);
  const [startupError, setStartupError] = useState('');
  const [messages, setMessages] = useState({});
  const [hasMore, setHasMore] = useState({});
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutPending = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  // 会话置顶消息变化的计数：界面据此重新读取置顶列表。
  const [pinsVersion, setPinsVersion] = useState(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [threadTick, setThreadTick] = useState({ rootId: null, n: 0 });
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
    try { const next = await api('state'); if (!logoutPending.current) { syncHistory(next.recalls, next.clearedThroughSeq); setState(sanitizeState(next, historyRef.current)); } return next; }
    catch (error) { if (error.status === 401 && !logoutPending.current) location.reload(); throw error; }
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
  // 正在输入：{ roomId: { userId: 截止时间 } }，5 秒内没有新的输入事件就消失。
  const [typing, setTyping] = useState({});
  const socketRef = useRef();
  const sendTyping = useCallback(roomId => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'typing', roomId }));
  }, []);
  const stopTyping = useCallback((roomId, userId) => setTyping(previous => {
    if (!previous[roomId]?.[userId]) return previous;
    const { [userId]: _, ...rest } = previous[roomId];
    return { ...previous, [roomId]: rest };
  }), []);
  useEffect(() => {
    if (!Object.values(typing).some(users => Object.keys(users).length)) return;
    const timer = setInterval(() => setTyping(previous => Object.fromEntries(Object.entries(previous)
      .map(([roomId, users]) => [roomId, Object.fromEntries(Object.entries(users).filter(([, until]) => until > Date.now()))]))), 1000);
    return () => clearInterval(timer);
  }, [typing]);
  const applyReactions = useCallback(({ roomId, messageId, reactions }) => {
    setMessages(previous => previous[roomId] ? { ...previous, [roomId]: previous[roomId].map(message => message.id === messageId ? { ...message, reactions } : message) } : previous);
  }, []);
  const applyPoll = useCallback(({ roomId, messageId, poll }) => {
    setMessages(previous => previous[roomId] ? { ...previous, [roomId]: previous[roomId].map(message => message.id === messageId ? { ...message, poll } : message) } : previous);
  }, []);
  // 编辑后的消息只替换正文等字段，不当作新消息提醒；侧栏预览也跟着更新。
  const applyEdit = useCallback(message => {
    setMessages(previous => previous[message.roomId] ? { ...previous, [message.roomId]: merge(previous[message.roomId], [message], historyRef.current) } : previous);
    setState(previous => previous ? { ...previous, rooms: previous.rooms.map(room => room.lastMessage?.id === message.id ? { ...room, lastMessage: { ...room.lastMessage, ...message } } : room) } : previous);
  }, []);
  const reportRead = useMessageReads(state?.me.id, connected, applyReceipt);
  const meId = state?.me.id;
  // 先在本地记为已读，未读角标立即更新；回执在后台上报。
  const markMessageRead = useCallback((roomId, messageId) => {
    if (logoutPending.current) return;
    applyReceipt({ roomId, userId: meId, messageIds: [messageId] });
    reportRead(roomId, messageId);
  }, [applyReceipt, reportRead, meId]);
  const start = useCallback(async () => {
    setStartupError('');
    let result;
    try { result = await api('bootstrap'); }
    catch { return setStartupError('暂时无法连接到聊天空间，请检查网络后重试。'); }
    if (logoutPending.current) return;
    // 桌面端注入脚本代为加入同事空间失败时，把原因留给页面提示。
    const joinError = sessionStorage.getItem('linliao.joinError');
    if (joinError) { sessionStorage.removeItem('linliao.joinError'); notify(joinError); }
    setBootstrap(result);
    if (result.me) { syncHistory(result.recalls, result.clearedThroughSeq); setState(sanitizeState(result, historyRef.current)); }
    else { setState(null); setMessages({}); setHasMore({}); setConnected(false); }
  }, [syncHistory, notify]);
  useEffect(() => { start(); }, [start]);
  const logout = useCallback(async () => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setLoggingOut(true);
    try {
      await api(bootstrap?.mode === 'cloud' ? 'auth/logout' : 'logout', {});
    } catch (error) {
      logoutPending.current = false;
      setLoggingOut(false);
      notify(error.status ? error.message : '退出失败，请检查网络后重试');
      return;
    }
    setState(null); setMessages({}); setHasMore({}); setConnected(false);
    setBootstrap(previous => ({ ...previous, me: null, account: null }));
    // 完整重载清理草稿、弹窗和消息缓存；服务端已撤销当前登录及局域网设备绑定。
    // 同时清空桌面未读角标，避免登录页继续显示上一账号的新消息数量。
    try { await window.desktop?.activity?.({ currentRoomId: null, unreadRooms: [] }); } catch {}
    location.reload();
  }, [bootstrap?.mode, notify]);
  const receive = useCallback(message => {
    if (logoutPending.current) return;
    if (message.recalledAt) syncHistory([message]);
    message = sanitizeMessage(message, historyRef.current);
    if (!message) return;
    // 话题里的回复不进主时间线，只通知打开着的话题面板刷新。
    if (message.threadOf) setThreadTick(tick => ({ rootId: message.threadOf, n: tick.n + 1 }));
    else {
      setMessages(previous => ({ ...previous, [message.roomId]: merge(previous[message.roomId] || [], [message], historyRef.current) }));
      setState(previous => previous ? { ...previous, rooms: previous.rooms.map(room => room.id === message.roomId && (!room.lastMessage || room.lastMessage.seq < message.seq) ? { ...room, lastMessage: message } : room) } : previous);
    }
    const current = stateRef.current;
    const target = current?.rooms.find(room => room.id === message.roomId);
    const mentionsMe = message.mentions?.some(id => id === current?.me.id || id === '*');
    // 关键词提醒和被 @ 一样：免打扰的会话也提醒。
    const words = current?.keywords || [];
    const keywordHit = Boolean(words.length && message.text && (text => words.some(word => text.includes(word.toLowerCase())))(plainText(message.text).toLowerCase()));
    const important = mentionsMe || keywordHit;
    // 免打扰的会话只在被 @ 时提醒。
    if (message.recalledAt || !current || message.senderId === current.me.id || (mutedRef?.current.has(message.roomId) && !important) || isQuiet(important)) return;
    // 拍一拍只提醒被拍的人。
    if (message.nudge && message.nudge.targetId !== current.me.id) return;
    // 提示音：正在看这个会话时不响；Windows 的系统通知自带声音，弹出时不重复响。
    const watching = activeRoom.current === message.roomId && document.hasFocus() && !document.hidden;
    const ring = () => { if (!watching && chatPref('sound')) playMessageSound(); };
    if (!window.desktop?.message) { ring(); return; }
    const sender = current.users.find(user => user.id === message.senderId);
    const hidden = privacyRef.current;
    const title = hidden ? '虾扯蛋 · 新消息' : `${mentionsMe ? '[有人@你] ' : keywordHit ? '[关键词] ' : ''}${sender?.name || message.bot || '新消息'}${target && target.kind !== 'direct' ? ` · ${target.name}` : ''}`;
    window.desktop.message({ id: message.id, roomId: message.roomId, privateMode: hidden,
      title: title.slice(0, 120), body: hidden ? '****' : message.nudge ? '拍了拍你' : previewText(message).slice(0, 240),
    }).then(shown => { if (!(shown && window.desktop.platform === 'windows')) ring(); }).catch(error => notify(error.message));
  }, [notify, syncHistory, privacyRef]);
  const applyKeywords = useCallback(keywords => setState(previous => previous ? { ...previous, keywords } : previous), []);
  // 会话文件夹（跨设备同步）。
  const applyFolders = useCallback(folders => setState(previous => previous ? { ...previous, folders } : previous), []);
  // 自己写的成员备注（只有自己看得到）：空字符串表示删除。
  const applyNote = useCallback(({ userId, note }) => setState(previous => {
    if (!previous) return previous;
    const notes = { ...previous.notes };
    if (note) notes[userId] = note; else delete notes[userId];
    return { ...previous, notes };
  }), []);
  useEffect(() => {
    if (!state?.me.id || loggingOut) { setConnected(false); return; }
    let cancelled = false, socket, delay = 700;
    async function synchronize() {
      try {
        await refresh();
        const roomId = activeRoom.current;
        // 其他会话的缓存可能缺了断线期间的消息，丢掉后切过去时重新加载，避免中间出现空洞。
        setMessages(previous => roomId && previous[roomId] ? { [roomId]: previous[roomId] } : {});
        setHasMore(previous => roomId && roomId in previous ? { [roomId]: previous[roomId] } : {});
        if (!roomId) return;
        // 当前会话从本地最后一条往后补齐；断开太久（超过 1000 条）就直接换成最新一页。
        let after = messagesRef.current[roomId]?.at(-1)?.seq, missed = [], complete = after !== undefined;
        for (let page = 0; complete && page < 5; page++) {
          const result = await api(`messages?roomId=${encodeURIComponent(roomId)}&after=${after}`);
          missed.push(...result.messages);
          if (!result.hasNewer) break;
          after = result.messages.at(-1).seq;
          if (page === 4) complete = false;
        }
        const latest = await api(`messages?roomId=${encodeURIComponent(roomId)}`);
        if (cancelled) return;
        setMessages(previous => ({ ...previous, [roomId]: complete ? merge(merge(previous[roomId] || [], missed, historyRef.current), latest.messages, historyRef.current) : merge([], latest.messages, historyRef.current) }));
        setHasMore(previous => ({ ...previous, [roomId]: complete && roomId in previous ? previous[roomId] : latest.hasMore }));
      } catch (error) { if (!cancelled) notify(error.message); }
    }
    function connect() {
      if (cancelled || logoutPending.current) return;
      socket = socketRef.current = new WebSocket(socketUrl());
      socket.onopen = () => { if (cancelled || logoutPending.current) return socket.close(); setConnected(true); delay = 700; synchronize(); };
      socket.onmessage = event => {
        if (cancelled || logoutPending.current) return;
        let data; try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'message') { receive(data.message); stopTyping(data.message.roomId, data.message.senderId); }
        if (data.type === 'typing') setTyping(previous => ({ ...previous, [data.roomId]: { ...previous[data.roomId], [data.userId]: Date.now() + 5000 } }));
        if (data.type === 'message-recalled') { syncHistory([data.message]); applyEdit(data.message); }
        if (data.type === 'history-cleared') { syncHistory([], data.throughSeq); refresh().catch(error => notify(error.message)); }
        if (data.type === 'message-reads') applyReceipt(data);
        if (data.type === 'message-reactions') applyReactions(data);
        if (data.type === 'message-edited') applyEdit(data.message);
        // 到期自动删除（或保留期限清理）的消息：从本地去掉，再刷新侧栏的最后一条。
        if (data.type === 'messages-deleted') {
          const ids = new Set(data.ids);
          setMessages(previous => previous[data.roomId] ? { ...previous, [data.roomId]: previous[data.roomId].filter(message => !ids.has(message.id)) } : previous);
          refresh().catch(() => {});
        }
        if (data.type === 'users') setState(previous => previous ? ({ ...previous, users: data.users, me: { ...previous.me, ...data.users.find(user => user.id === previous.me.id) } }) : previous);
        if (data.type === 'rooms') refresh().catch(error => notify(error.message));
        if (data.type === 'room-pins') setPinsVersion(version => version + 1);
        if (data.type === 'saved') setSavedVersion(version => version + 1);
        if (data.type === 'user-note') applyNote(data);
        if (data.type === 'folders') applyFolders(data.folders);
        if (data.type === 'keywords') applyKeywords(data.keywords);
        if (data.type === 'message-poll') applyPoll(data);
        if (data.type === 'message-thread') {
          setMessages(previous => previous[data.roomId] ? { ...previous, [data.roomId]: previous[data.roomId].map(message => message.id === data.rootId ? { ...message, thread: data.thread } : message) } : previous);
          setThreadTick(tick => ({ rootId: data.rootId, n: tick.n + 1 }));
        }
        if (data.type === 'reminder') {
          const current = stateRef.current, sender = current?.users.find(user => user.id === data.message.senderId);
          notify(`提醒：${privacyRef.current ? '你设置的消息提醒到了' : previewText(data.message).slice(0, 60)}`);
          window.desktop?.message?.({ id: `reminder-${data.message.id}`, roomId: data.message.roomId, privateMode: privacyRef.current,
            title: privacyRef.current ? '虾扯蛋 · 提醒' : `提醒 · ${sender?.name || data.message.bot || '消息'}`, body: privacyRef.current ? '****' : previewText(data.message).slice(0, 240) }).catch(() => {});
        }
      };
      socket.onclose = event => { if (cancelled || logoutPending.current) return; if (event.code === 4003 || event.code === 4001) { location.reload(); return; } setConnected(false); reconnect.current = setTimeout(connect, delay); delay = Math.min(delay * 1.7, 10000); };
      socket.onerror = () => socket.close();
    }
    connect();
    return () => { cancelled = true; clearTimeout(reconnect.current); socket?.close(); };
  }, [state?.me.id, loggingOut, refresh, receive, notify, applyReceipt, applyReactions, applyEdit, applyPoll, applyNote, applyFolders, applyKeywords, syncHistory, stopTyping]);
  useEffect(() => {
    if (!state?.me.id || !selected || loggingOut) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api(`messages?roomId=${encodeURIComponent(selected)}`).then(result => {
      if (cancelled) return;
      setMessages(previous => ({ ...previous, [selected]: merge(previous[selected] || [], result.messages, historyRef.current) }));
      setHasMore(previous => ({ ...previous, [selected]: result.hasMore }));
    }).catch(error => { if (!cancelled) notify(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, state?.me.id, loggingOut, notify]);
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
  function updateMe(me) { setState(previous => ({ ...previous, me: { ...previous.me, ...me }, users: previous.users.map(user => user.id === me.id ? { ...user, ...me } : user) })); }
  return { bootstrap, state, startupError, start, refresh, logout, loggingOut, messages, hasMore, loading, connected, historyVersion,
    syncHistory, receive, markMessageRead, loadOlder, loadThrough, updateMe, applyReactions, applyEdit, typing, sendTyping, pinsVersion, savedVersion, applyPoll, threadTick, applyNote, applyFolders, applyKeywords };
}

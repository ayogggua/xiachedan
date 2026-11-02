import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, MessagesSquare, Users, Settings2, Search, Plus, Hash, Eye, EyeOff, WifiOff, UserPlus, ChevronLeft, ChevronRight, ArrowDown, ArrowUp, X, Check, LoaderCircle, RefreshCw, ShieldCheck, Pin, BellOff, Megaphone, PencilLine, LogOut, Crown } from 'lucide-react';
import { api, formatTime, mediaUrl, nativeTitlebar } from './api';
import { Avatar, IconButton, Logo, Message, Modal, PrivatePreview, ContextMenu, ReadDetail, longPressHandlers, consumeLongPress, pressEvent } from './components';
import Onboarding from './Onboarding';
import Account, { AdminDialog, PasswordForm } from './Account';
import Composer from './Composer';
import { ProfileDialog, InviteDialog, GroupDialog, ConnectionDialog, RemoveMemberDialog, RecallDialog, ForwardDialog, ConfirmDialog, GroupEditDialog } from './dialogs';
import useUnread from './useUnread';
import useChatSession from './useChatSession';
import useConversations from './useConversations';
import useDesktopBridge from './useDesktopBridge';
import useTheme from './useTheme';
import ImageViewer from './ImageViewer';
import QuickSwitcher from './QuickSwitcher';
import HistorySearch, { SearchResult, SearchStatus, useMessageSearch } from './HistorySearch';
import { previewText, readStorage } from './history';

export default function App() {
  const [selected, setSelected] = useState('lobby');
  const [lastRead, setLastRead] = useState(() => readStorage('linliao.read', {}));
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [replying, setReplying] = useState(null);
  const [reactingTo, setReactingTo] = useState(null);
  const [selection, setSelection] = useState(null);
  const [forwarding, setForwarding] = useState(null);
  const [groupAction, setGroupAction] = useState(null);
  const [switcher, setSwitcher] = useState(false);
  // 侧栏宽度可拖动调整并记住；拖到很窄时收成只显示头像的窄栏。
  const [sidebarWidth, setSidebarWidth] = useState(() => { const value = readStorage('linliao.sidebarWidth', 300); return value === 76 || (value >= 220 && value <= 440) ? value : 300; });
  const resizing = useRef(null);
  const [dismissedNotices, setDismissedNotices] = useState(() => readStorage('linliao.announcements', {}));
  const [readDetail, setReadDetail] = useState(null);
  const [recalling, setRecalling] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [showMembers, setShowMembers] = useState(false);
  const [panelView, setPanelView] = useState('members');
  const [preview, setPreview] = useState(null);
  const [toast, setToast] = useState('');
  const [scrolledUp, setScrolledUp] = useState(false);
  const [awaySeq, setAwaySeq] = useState(null);
  const [unreadAnchor, setUnreadAnchor] = useState(null);
  const [mobileChat, setMobileChat] = useState(false);
  const [theme, setTheme] = useTheme();
  const [update, setUpdate] = useState(null);
  const toastTimer = useRef();
  const messageList = useRef();
  const messageContent = useRef();
  const sticky = useRef(true);
  const firstLoad = useRef(true);
  const longPress = useRef({ timer: 0, fired: false });
  const notify = useCallback(text => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3500); }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const { privateMode, privacyRef, changePrivacy, windowActive } = useDesktopBridge({ notify, onPendingRoom: openRoom,
    onOpenRoom: roomId => { openRoom(roomId); setModal(null); setSearch(''); } });
  const closeReadDetail = useCallback(() => setReadDetail(null), []);
  const onHistoryChanged = useCallback(({ cleared }) => {
    if (cleared) { setScrolledUp(false); sticky.current = true; }
    setPreview(null); setContextMenu(null); setRecalling(null); setReadDetail(null);
  }, []);
  // 免打扰只在本机生效，与置顶一样保存在会话偏好里；不弹通知，也不计入菜单栏和托盘的未读数。
  const mutedRooms = useRef(new Set());
  const { bootstrap, state, startupError, start, refresh, logout, loggingOut, messages, hasMore, loading, connected, historyVersion,
    syncHistory, receive, markMessageRead, loadOlder: fetchOlder, loadThrough, updateMe, applyReactions, typing, sendTyping } = useChatSession({ selected, notify, privacyRef, mutedRef: mutedRooms, onHistoryChanged });
  const { rooms: conversations, scope: conversationScope, restore: restoreConversation, act: conversationAction } =
    useConversations({ state, spaceId: bootstrap?.spaceId, selected, onSelect: setSelected, notify });
  mutedRooms.current = new Set(conversations.filter(room => room.muted).map(room => room.id));
  const messageContext = useRef();
  messageContext.current = { scope: conversationScope, messages, privateMode };
  useEffect(() => {
    if (!state?.me.id) return;
    firstLoad.current = true; sticky.current = true; setScrolledUp(false);
    setContextMenu(null); setReadDetail(null); setPreview(null);
    // 切换会话时消息区淡入；系统要求减少动效时不做。
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) messageContent.current?.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }, [selected, state?.me.id]);
  const currentMessages = messages[selected] || [];
  // 正在回复的消息以最新状态为准：被撤回或清空后自动取消。
  const replyTarget = replying?.roomId === selected ? currentMessages.find(message => message.id === replying.id && !message.recalledAt) || null : null;
  const lastSeq = currentMessages.at(-1)?.seq;
  // 隐私模式下游标只推进到第一条还没看过的他人消息之前，未读角标与已读回执一致。
  // 悬停显示本身说明用户在看，因此隐私模式不再要求窗口处于激活状态。
  const unseen = privateMode && currentMessages.find(message => message.senderId !== state?.me.id && !message.recalledAt && Array.isArray(message.readBy) && !message.readBy.includes(state?.me.id));
  const readUpTo = unseen ? unseen.seq - 1 : lastSeq;
  const unread = useUnread(state, messages, lastRead, connected, historyVersion);
  // 往上翻看时记下当时最新的一条，之后别人发来的消息计入「N 条新消息」。
  useEffect(() => { setAwaySeq(scrolledUp ? lastSeq ?? 0 : null); }, [scrolledUp]); // eslint-disable-line react-hooks/exhaustive-deps
  const arrivedWhileAway = awaySeq === null ? 0 : currentMessages.filter(message => message.seq > awaySeq && message.senderId !== state?.me.id && !message.recalledAt).length;
  // 进入会话时记下已读位置：打开后列表会滚到底并推进已读位置，所以必须在那之前记住第一条未读在哪里。
  useEffect(() => {
    const status = unread[selected];
    setUnreadAnchor(status?.hasUnread ? { roomId: selected, afterSeq: lastRead[selected] || 0, count: status.exact ? status.count : 0 } : null);
  }, [selected, state?.me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 第一条未读已经出现在可视区域（或在它下面）就不再提示。
  const checkUnreadAnchor = useCallback(() => {
    const list = messageList.current;
    if (!unreadAnchor || unreadAnchor.roomId !== selected || !list) return;
    const first = [...list.querySelectorAll('[data-seq]')].find(node => Number(node.dataset.seq) > unreadAnchor.afterSeq);
    const top = Math.max(list.getBoundingClientRect().top, document.querySelector('.chat-toolbar')?.getBoundingClientRect().bottom || 0);
    if (first && first.getBoundingClientRect().top >= top) setUnreadAnchor(null);
  }, [unreadAnchor, selected]);
  useEffect(() => { requestAnimationFrame(checkUnreadAnchor); }, [checkUnreadAnchor, lastSeq, loading]);
  const searchTerm = search.trim();
  const globalSearch = useMessageSearch(searchTerm, null, historyVersion, Boolean(state?.me));
  useEffect(() => {
    if (!messageList.current || loading) return;
    if (firstLoad.current || sticky.current) { messageList.current.scrollTop = messageList.current.scrollHeight; firstLoad.current = false; }
    if (readUpTo && (windowActive || privateMode) && !scrolledUp && !modal && !preview) setLastRead(previous => readUpTo > (previous[selected] || 0) ? { ...previous, [selected]: readUpTo } : previous);
  }, [selected, lastSeq, readUpTo, loading, privateMode, windowActive, scrolledUp, modal, preview]);
  // 图片加载、已读回执等让内容变高时，仍停在最新消息处。
  useEffect(() => {
    const list = messageList.current, content = messageContent.current;
    if (!list || !content) return;
    const observer = new ResizeObserver(() => { if (sticky.current) list.scrollTop = list.scrollHeight; });
    observer.observe(content);
    return () => observer.disconnect();
  }, [state?.me.id, state?.rooms.length]);
  // 免打扰的会话不计入菜单栏与托盘的未读数，被 @ 时除外。
  const unreadRooms = JSON.stringify(loggingOut ? [] : conversations.filter(room => !room.hidden && (!room.muted || unread[room.id]?.mentioned) && unread[room.id]?.hasUnread).map(room => room.id));
  useEffect(() => {
    window.desktop?.activity?.({ currentRoomId: state?.me.id && !loggingOut ? selected : null, unreadRooms: JSON.parse(unreadRooms) }).catch(error => notify(error.message));
  }, [unreadRooms, selected, state?.me.id, loggingOut, notify]);
  useEffect(() => { localStorage.setItem('linliao.read', JSON.stringify(lastRead)); }, [lastRead]);
  useEffect(() => { localStorage.setItem('linliao.sidebarWidth', JSON.stringify(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('linliao.announcements', JSON.stringify(dismissedNotices)); }, [dismissedNotices]);
  useEffect(() => { if (privateMode) setPreview(null); }, [privateMode]);
  // ⌘K 打开快速切换，⌘1–9 切到侧栏第 N 个会话（Windows 与网页端非 Mac 用 Ctrl）；有其他弹窗时不响应。
  const orderedRef = useRef([]);
  useEffect(() => {
    const onKey = event => {
      const mac = window.desktop ? window.desktop.platform === 'macos' : /Mac/i.test(navigator.platform);
      if (!(mac ? event.metaKey : event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (document.querySelector('dialog[open]:not(.quick-switcher)')) return;
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); setSwitcher(value => !value); return; }
      const target = /^[1-9]$/.test(event.key) && orderedRef.current[Number(event.key) - 1];
      if (target) { event.preventDefault(); setSwitcher(false); setSelected(target.id); setMobileChat(true); setReadDetail(null); setPanelView('members'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setSelection(null); setReactingTo(null); }, [selected]);
  useEffect(() => {
    if (!selection) return;
    const onKey = event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setSelection(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection]);
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  async function loadOlder() {
    const previousHeight = messageList.current.scrollHeight;
    if (await fetchOlder()) requestAnimationFrame(() => { if (messageList.current) messageList.current.scrollTop += messageList.current.scrollHeight - previousHeight; });
  }
  // 桌面端启动后在后台检查一次更新，发现新版本只提示，不打断使用。
  useEffect(() => {
    if (!state?.me.id || !window.desktop?.updates) return;
    window.desktop.updates.check().then(info => {
      setUpdate(info);
      if (info.available) notify(`发现新版本 ${info.version}，可在设置中更新`);
    }).catch(() => {});
  }, [state?.me.id, notify]);
  async function jumpToFirstUnread() {
    const anchor = unreadAnchor;
    setUnreadAnchor(null);
    try { await loadThrough(anchor.roomId, anchor.afterSeq + 1); } catch (error) { return notify(error.message); }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const row = [...(messageList.current?.querySelectorAll('[data-seq]') || [])].find(node => Number(node.dataset.seq) > anchor.afterSeq);
    if (!row) return;
    sticky.current = false; firstLoad.current = false;
    // 跨度通常很大，直接跳过去，不做长距离滚动动画。
    row.scrollIntoView({ block: 'start' });
  }
  async function jumpToMessage(target) {
    if (target.roomId !== selected) { setSelected(target.roomId); setMobileChat(true); setReadDetail(null); }
    try { await loadThrough(target.roomId, target.seq); } catch (error) { return notify(error.message); }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const row = messageList.current?.querySelector(`[data-message-id="${CSS.escape(target.id)}"]`);
    if (!row) return notify('这条消息已不在聊天记录中');
    // 切换会话时的"首次加载滚到底部"不能覆盖这次定位。
    sticky.current = false; firstLoad.current = false;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    if (matchMedia('(max-width: 760px)').matches) setShowMembers(false);
  }
  async function forwardTo(target) {
    const result = await api('forward', { roomId: target.id, messageIds: forwarding });
    setSelection(null);
    if (target.id === selected) for (const message of result.messages) receive(message);
    notify(`已转发到「${target.name}」`);
    await refresh();
  }
  async function toggleReaction(message, emoji) {
    try { applyReactions(await api('reactions', { messageId: message.id, emoji })); }
    catch (error) { notify(error.message); }
  }
  async function directMessage(user) {
    if (user.id === state.me.id) return setModal('profile');
    try { const result = await api('rooms', { userId: user.id }); await refresh(); openRoom(result.id); setModal(null); }
    catch (error) { notify(error.message); }
  }
  function openRoom(id) {
    if (!restoreConversation(id)) return;
    setSelected(id); setMobileChat(true); setReadDetail(null); setContextMenu(null); setPanelView('members');
  }
  function showContextMenu(event, options, items, label) {
    event.preventDefault(); event.stopPropagation();
    setContextMenu(null); setReadDetail(null);
    if (!items.length) return;
    if (window.desktop?.contextMenu) {
      window.desktop.contextMenu(options, action => items.find(item => item.id === action)?.action()).catch(error => notify(error.message));
    } else {
      setContextMenu({ x: event.clientX, y: event.clientY, items, label });
    }
  }
  function conversationMenu(event, target) {
    const pin = target.pinned ? 'unpin' : 'pin';
    const mute = target.muted ? 'unmute' : 'mute';
    showContextMenu(event, { kind: 'conversation', pinned: target.pinned, muted: target.muted }, [
      { id: pin, label: target.pinned ? '取消置顶' : '置顶对话', action: () => conversationAction(pin, target.id, conversationScope) },
      { id: mute, label: target.muted ? '取消免打扰' : '消息免打扰', action: () => conversationAction(mute, target.id, conversationScope) },
      { id: 'remove', label: '移除对话', action: () => conversationAction('remove', target.id, conversationScope) },
    ], '对话操作');
  }
  function messageMenu(event, message) {
    const canCopy = Boolean(message.text) && !privateMode;
    const canRecall = message.senderId === state.me.id && !message.recalledAt;
    const canReply = !message.recalledAt;
    const canReact = canReply && Boolean(state.reactions?.length);
    const act = action => {
      const current = messageContext.current;
      if (current.scope !== conversationScope) return;
      const latest = current.messages[message.roomId]?.find(item => item.id === message.id);
      if (!latest || latest.recalledAt) return;
      if (action === 'recall') setRecalling(latest);
      if (action === 'reply') setReplying({ roomId: latest.roomId, id: latest.id });
      if (action === 'react') setReactingTo(latest.id);
      if (action === 'forward') setForwarding([latest.id]);
      if (action === 'select') setSelection([latest.id]);
      if (action === 'copy' && !current.privateMode) {
        const copy = window.desktop?.copy ? window.desktop.copy(latest.text) : navigator.clipboard.writeText(latest.text);
        return copy.catch(error => notify(error.message));
      }
    };
    showContextMenu(event, { kind: 'message', canReply, canReact, canForward: canReply, canCopy, canRecall }, [
      ...(canReply ? [{ id: 'reply', label: '回复', action: () => act('reply') }] : []),
      ...(canReact ? [{ id: 'react', label: '回应', action: () => act('react') }] : []),
      ...(canReply ? [{ id: 'forward', label: '转发', action: () => act('forward') }, { id: 'select', label: '多选', action: () => act('select') }] : []),
      ...(canCopy ? [{ id: 'copy', label: '复制', action: () => act('copy') }] : []),
      ...(canRecall ? [{ id: 'recall', label: '撤回消息', action: () => act('recall') }] : []),
    ], '消息操作');
  }
  const toastElement = toast && <div className="toast" role="status"><Check size={15} />{toast}</div>;
  if (startupError) return <div className="startup-state"><Logo /><h2>稍等，连接有点慢</h2><p>{startupError}</p><div className="startup-actions"><button className="primary-button" onClick={start}><RefreshCw size={15} />重新连接</button>{window.desktop && <button className="secondary-button" onClick={() => window.desktop.home()}>返回本机空间</button>}</div></div>;
  if (!bootstrap) return <div className="startup-state"><Logo /><p>正在连接虾扯蛋…</p><LoaderCircle className="spin" size={18} /></div>;
  if (!state?.me) return <>{bootstrap.mode === 'cloud' ? <Account bootstrap={bootstrap} onChanged={start} onLogout={logout} loggingOut={loggingOut} /> : <Onboarding bootstrap={bootstrap} onJoined={start} notify={notify} />}{toastElement}</>;
  const userMap = Object.fromEntries(state.users.map(user => [user.id, user]));
  const peerOf = room => userMap[room.members.find(id => id !== state.me.id)];
  const roomName = room => room.kind === 'direct' ? peerOf(room)?.name || '私聊' : room.name;
  const rooms = conversations.map(room => ({ ...room, name: roomName(room) }));
  const room = rooms.find(room => room.id === selected && !room.hidden);
  const groupMembers = !room ? [] : room.kind === 'public' ? state.users.filter(user => !user.removed) : state.users.filter(user => !user.removed && room.members.includes(user.id));
  const online = state.users.filter(user => !user.removed && user.online);
  const query = search.trim().toLowerCase();
  const filtered = rooms.filter(room => (!room.hidden || query) && room.name.toLowerCase().includes(query));
  const peer = room?.kind === 'direct' ? peerOf(room) : null;
  // 与侧栏顺序一致：置顶、群聊、私聊（已移除的对话不在内）；⌘1–9 按这个顺序切换。
  const visible = rooms.filter(target => !target.hidden);
  const ordered = [...visible.filter(target => target.pinned), ...visible.filter(target => !target.pinned && target.kind !== 'direct'), ...visible.filter(target => !target.pinned && target.kind === 'direct')];
  orderedRef.current = ordered;
  const switchKey = (window.desktop ? window.desktop.platform === 'macos' : /Mac/i.test(navigator.platform)) ? '⌘K' : 'Ctrl K';
  const isOwner = state.workspace.ownerId === state.me.id;
  const cloud = state.workspace.mode === 'cloud';
  const isAdmin = ['admin', 'super_admin'].includes(state.me.role);
  // 正在输入的人（不含自己）；私聊只说「对方」。
  const typingLabel = target => {
    const names = Object.keys(typing[target.id] || {}).filter(id => id !== state.me.id).map(id => userMap[id]?.name).filter(Boolean);
    if (!names.length) return '';
    return target.kind === 'direct' ? '对方正在输入…' : `${names.slice(0, 2).join('、')}${names.length > 2 ? ` 等 ${names.length} 人` : ''} 正在输入…`;
  };
  const roomIcon = (target, size = 32) => target.kind === 'direct' ? <Avatar user={peerOf(target)} size={size} online={peerOf(target)?.online} /> : <span className="room-avatar">{target.kind === 'public' ? <Hash size={16} /> : <Users size={16} />}</span>;
  const fitSidebar = raw => raw < 160 ? 76 : Math.min(440, Math.max(220, Math.round(raw)));
  const compact = sidebarWidth === 76;
  const resizer = <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" tabIndex={0}
    aria-valuemin={76} aria-valuemax={440} aria-valuenow={sidebarWidth} title="拖动调整宽度，双击恢复默认"
    onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); resizing.current = { x: event.clientX, width: sidebarWidth }; }}
    onPointerMove={event => { if (resizing.current) setSidebarWidth(fitSidebar(resizing.current.width + event.clientX - resizing.current.x)); }}
    onPointerUp={() => { resizing.current = null; }} onPointerCancel={() => { resizing.current = null; }}
    onDoubleClick={() => setSidebarWidth(300)}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setSidebarWidth(width => event.key === 'ArrowRight' ? (width === 76 ? 220 : fitSidebar(width + 20)) : (width <= 220 ? 76 : fitSidebar(width - 20)));
    }} />;
  const roomButton = target => {
    const status = unread[target.id];
    const label = status?.exact ? `${status.count} 条未读消息` : '有新消息';
    return <button className={`conversation ${selected === target.id ? 'active' : ''} ${status?.hasUnread ? 'has-unread' : ''} ${target.muted ? 'muted' : ''} ${status?.mentioned ? 'mentioned' : ''}`} key={target.id} data-room-id={target.id} aria-current={selected === target.id ? 'page' : undefined} aria-haspopup="menu"
      onClick={() => { if (!consumeLongPress(longPress)) openRoom(target.id); }} {...longPressHandlers(longPress, (x, y) => conversationMenu(pressEvent(x, y), target))}
      onContextMenu={event => { if (longPress.current.fired) event.preventDefault(); else conversationMenu(event, target); }}
      onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { const rect = event.currentTarget.getBoundingClientRect(); conversationMenu(Object.assign(pressEvent(rect.left + 24, rect.bottom), { preventDefault: () => event.preventDefault() }), target); } }}>
      <span className="conversation-icon" title={compact ? target.name : undefined}>{roomIcon(target, 44)}{compact && status?.hasUnread && <i className="compact-dot" aria-hidden="true" />}</span><span className="conversation-copy"><span className="conversation-title"><span className="conversation-name">{target.name}</span>{target.pinned && <Pin className="conversation-pin" size={11} aria-label="已置顶" />}{target.muted && <BellOff className="conversation-pin" size={11} aria-label="免打扰" />}<time>{target.lastMessage ? formatTime(target.lastMessage.createdAt) : ''}</time></span>
        <span className="conversation-preview">{status?.mentioned && <span className="mention-flag">[有人@我]</span>}{typingLabel(target) ? <span className="typing-text">{typingLabel(target)}</span> : <PrivatePreview privateMode={privateMode && Boolean(target.lastMessage)}>{previewText(target.lastMessage)}</PrivatePreview>}{status?.hasUnread && <span className="unread-badge" aria-label={label} title={label}>{status.exact ? status.count > 99 ? '99+' : status.count : '新'}</span>}</span>
      </span>
    </button>;
  };
  const groupOwner = room?.kind === 'group' ? room.ownerId : null;
  const memberRow = (user, size, inGroup = false) => <div className="managed-member" key={user.id}><button className="member-row" onClick={() => directMessage(user)}><Avatar user={user} size={size} online={user.online} /><span className="member-name">{user.name}{user.id === state.me.id && <small className="me-tag">我</small>}{inGroup && user.id === groupOwner && <small className="owner-tag"><Crown size={10} />群主</small>}</span><small>{user.online ? '在线' : '离线'}</small><ChevronRight size={14} /></button>{!inGroup && isOwner && !cloud && user.id !== state.me.id && <button className="remove-member" onClick={() => setRemoving(user)} aria-label={`从空间移除${user.name}`}>移除</button>}
    {inGroup && groupOwner === state.me.id && user.id !== state.me.id && <button className="remove-member" onClick={() => setGroupAction({ type: 'transfer', user })} aria-label={`把群主转让给${user.name}`}>转让</button>}</div>;
  const subtitle = room?.kind === 'direct' ? peer?.online ? '在线' : '离线 · 上线后送达' : `${groupMembers.length} 位成员 · ${groupMembers.filter(user => user.online).length} 人在线`;
  const sameGroup = (previous, message) => previous && !previous.recalledAt && !message.recalledAt && previous.senderId === message.senderId &&
    new Date(previous.createdAt).toDateString() === new Date(message.createdAt).toDateString() && message.createdAt - previous.createdAt < 5 * 60000;
  return <div className={`app ${privateMode ? 'privacy-on' : ''} ${nativeTitlebar ? 'native' : ''} ${mobileChat ? 'show-chat' : ''} ${compact ? 'compact-sidebar' : ''}`} style={{ '--sidebar': `${sidebarWidth}px` }} data-screen-label="虾扯蛋聊天空间">
    <aside className="sidebar glass" aria-label="会话列表">{resizer}
      <div className="sidebar-drag" data-drag-region aria-hidden="true" />
      <div className="space-heading" data-drag-region><div className="space-copy"><h1>{state.workspace.name}</h1><p><i className={`status-dot ${connected ? 'online' : ''}`} />{online.length} 人在线</p></div><IconButton icon={UserPlus} label="邀请同事" onClick={() => setModal('invite')} /></div>
      <label className="sidebar-search"><Search size={14} /><input aria-label="搜索会话和消息" placeholder="搜索会话和消息" value={search} onChange={event => setSearch(event.target.value)} />{search ? <IconButton icon={X} label="清空搜索" size={14} onClick={() => setSearch('')} /> : <button type="button" className="switch-hint" onClick={() => setSwitcher(true)} title="快速切换会话">{switchKey}</button>}</label>
      <nav className="conversation-scroll" aria-label="会话">
        {filtered.some(room => room.pinned) && <><div className="section-label"><span>置顶</span></div>{filtered.filter(room => room.pinned).map(roomButton)}</>}
        <div className="section-label"><span>群聊</span><IconButton icon={Plus} label="新建群聊" size={15} onClick={() => setModal('group')} /></div>{filtered.filter(room => !room.pinned && room.kind !== 'direct').map(roomButton)}
        <div className="section-label"><span>私聊</span><IconButton icon={Plus} label="发起私聊" size={15} onClick={() => setModal('members')} /></div>{filtered.filter(room => !room.pinned && room.kind === 'direct').map(roomButton)}
        {!filtered.some(room => room.kind === 'direct') && <p className="sidebar-empty">{search ? '没有匹配的私聊' : '找到一位同事，聊点新鲜事。'}</p>}
        {searchTerm && <section className="sidebar-messages" aria-label="消息搜索结果" aria-live="polite"><div className="section-label"><span>消息</span></div>
          {globalSearch.results?.map(message => { const target = rooms.find(item => item.id === message.roomId); if (!target) return null;
            const sender = message.senderId === state.me.id ? '我' : userMap[message.senderId]?.name || '成员';
            return <SearchResult key={message.id} message={message} term={searchTerm} avatar={roomIcon(target, 24)} title={target.name}
              prefix={target.kind === 'direct' && message.senderId !== state.me.id ? '' : `${sender}：`} privateMode={privateMode} onJump={jumpToMessage} />; })}
          <SearchStatus term={searchTerm} results={globalSearch.results} error={globalSearch.error} />
        </section>}
      </nav>
      {cloud && isAdmin && <button className="admin-entry" onClick={() => setModal('admin')}><ShieldCheck size={16} /><span>用户管理</span><ChevronRight size={14} /></button>}
      <div className="me-card"><button className="me-profile" title="修改昵称和头像" onClick={() => setModal('profile')}><Avatar user={state.me} size={30} /><span><b>{state.me.name}</b><small className={connected ? '' : 'warning'}>{connected ? cloud ? '已连接' : '局域网已连接' : '正在重新连接…'}</small></span></button><IconButton icon={Settings2} label={update?.available ? '设置（有新版本）' : '设置'} className={update?.available ? 'has-update' : ''} onClick={() => setModal('connection')} /></div>
      <button type="button" className="sidebar-logout" disabled={loggingOut} onClick={logout}>{loggingOut ? <LoaderCircle className="spin" size={14} /> : <LogOut size={14} />}<span>{loggingOut ? '正在退出…' : '退出登录'}</span></button>
    </aside>
    <main className="chat-main">
      {room ? <>
      <div className="conversation-body"><section className="chat-column">
        <header className="chat-toolbar" data-drag-region>
          <IconButton icon={ChevronLeft} label="返回会话列表" className="back-button glass" onClick={() => setMobileChat(false)} />
          <div className="toolbar-title glass"><span className="toolbar-icon">{roomIcon(room, 34)}</span><span className="toolbar-copy"><h2>{room.name}</h2><span className={`toolbar-subtitle ${typingLabel(room) ? 'typing-text' : ''}`} aria-live="polite">{typingLabel(room) || subtitle}</span></span></div>
          <div className="toolbar-actions">
            <button className={`toolbar-button glass privacy-toggle ${privateMode ? 'enabled' : ''}`} onClick={() => changePrivacy(value => !value)} role="switch" aria-checked={privateMode} aria-label="隐私模式" title="隐私模式 · ⌘⇧P · 悬停消息查看内容">{privateMode ? <EyeOff size={16} /> : <Eye size={16} />}<kbd>⌘⇧P</kbd></button>
            <button className={`toolbar-button glass member-count ${showMembers ? 'selected' : ''}`} onClick={() => { setShowMembers(value => !value); setPanelView('members'); }} aria-pressed={showMembers} aria-label={`会话成员，${groupMembers.length} 人`} title="会话成员"><span className="avatar-stack">{groupMembers.slice(0, 3).map(user => <Avatar key={user.id} user={user} size={20} />)}</span><span>{groupMembers.length}</span></button>
          </div>
        </header>
        {room.kind === 'group' && room.announcement && dismissedNotices[room.id] !== room.announcement.updatedAt && <div className="announcement-banner glass" role="note">
          <Megaphone size={15} /><p><b>群公告</b><PrivatePreview privateMode={privateMode}>{room.announcement.text}</PrivatePreview></p>
          <IconButton icon={X} label="不再显示这条公告" size={14} onClick={() => setDismissedNotices(previous => ({ ...previous, [room.id]: room.announcement.updatedAt }))} />
        </div>}
        {!connected && !loggingOut && <div className="offline-pill glass" role="status"><WifiOff size={14} />正在重新连接，草稿会保留</div>}
        <div className="message-scroll" ref={messageList} onScroll={event => { const node = event.currentTarget; sticky.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; setScrolledUp(!sticky.current); checkUnreadAnchor(); }}><div className="message-list" ref={messageContent}>
        {hasMore[selected] && <button className="load-older" onClick={loadOlder} disabled={loading}>{loading ? '正在加载…' : '查看更早的消息'}</button>}
        {!hasMore[selected] && <div className={`channel-welcome ${currentMessages.length ? 'has-messages' : ''}`}><span className="welcome-icon">{room.kind === 'public' ? <Hash size={22} /> : room.kind === 'group' ? <Users size={22} /> : <MessageCircle size={22} />}</span><h3>{room.kind === 'public' ? cloud ? '大家都在，随便扯两句。' : '同一个网络，随便扯两句。' : room.kind === 'group' ? `欢迎来到「${room.name}」` : `和${room.name}聊聊吧`}</h3><p>{room.kind === 'public' ? '工作、日常、好玩的，都可以往这里丢。' : room.kind === 'group' ? '文字、图片、视频，把想分享的都留在这里。' : '有些话，适合只对一个人说。'}</p>{room.kind === 'public' && !currentMessages.length && <button className="secondary-button" onClick={() => setModal('invite')}><UserPlus size={15} />邀请同事加入</button>}</div>}
        {!currentMessages.length && loading && <div className="messages-loading"><LoaderCircle className="spin" size={17} />正在加载消息…</div>}
        {currentMessages.map((message, index) => { const previous = currentMessages[index - 1]; const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString(); return <React.Fragment key={message.id}>{newDay && <div className="date-divider"><span>{new Date(message.createdAt).toDateString() === new Date().toDateString() ? '今天' : new Date(message.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span></div>}<Message onContextMenu={messageMenu} message={message}
          onReply={target => setReplying({ roomId: target.roomId, id: target.id })} nameOf={id => userMap[id]?.name}
          onOpenQuote={reply => jumpToMessage({ id: reply.id, seq: reply.seq, roomId: message.roomId })}
          reactionOptions={state.reactions || []} onReact={toggleReaction} picking={reactingTo === message.id} onPick={setReactingTo}
          selecting={Boolean(selection)} selected={selection?.includes(message.id)} onToggleSelect={target => setSelection(previous => previous.includes(target.id) ? previous.filter(id => id !== target.id) : [...previous, target.id])} user={userMap[message.senderId]} mine={message.senderId === state.me.id} continued={!newDay && sameGroup(previous, message)} last={!(currentMessages[index + 1] && sameGroup(message, currentMessages[index + 1]))} privateMode={privateMode} onPreview={setPreview} viewerId={state.me.id} readingEnabled={(windowActive || privateMode) && !modal && !removing && !recalling && !contextMenu && !preview && !loading} onRead={markMessageRead} recipients={groupMembers.filter(user => user.id !== state.me.id).map(user => user.id)} direct={room.kind === 'direct'} onReadDetail={(event, message) => { const rect = event.currentTarget.getBoundingClientRect(); setReadDetail(readDetail?.id === message.id ? null : { id: message.id, x: rect.right, y: rect.top }); }} /></React.Fragment>; })}
      </div></div>{scrolledUp && <button className="jump-to-latest glass" onClick={() => { sticky.current = true; messageList.current.scrollTo({ top: messageList.current.scrollHeight, behavior: 'smooth' }); }}><ArrowDown size={14} />{arrivedWhileAway ? `${arrivedWhileAway} 条新消息` : '回到最新消息'}</button>}
      {unreadAnchor?.roomId === selected && <button className="unread-anchor glass" onClick={jumpToFirstUnread}><ArrowUp size={14} />{unreadAnchor.count ? `${unreadAnchor.count} 条未读消息` : '跳到未读消息'}</button>}
      {selection ? <div className="selection-bar glass" role="toolbar" aria-label="多选消息">
        <span>已选 <b>{selection.length}</b> 条</span>
        <button className="secondary-button" onClick={() => setSelection(null)}>取消</button>
        <button className="primary-button" disabled={!selection.length} onClick={() => setForwarding([...selection])}>转发</button>
      </div> : <Composer room={room} connected={connected && !loggingOut} onSent={message => { sticky.current = true; receive(message); }} notify={notify} privateMode={privateMode}
        members={room.kind === 'direct' ? [] : groupMembers.filter(user => user.id !== state.me.id)} canMentionAll={room.kind === 'group' || (room.kind === 'public' && (isOwner || isAdmin))}
        onTyping={sendTyping} reply={replyTarget} replyAuthor={replyTarget && (replyTarget.senderId === state.me.id ? '自己' : userMap[replyTarget.senderId]?.name || '成员')} onCancelReply={() => setReplying(null)} />}</section>
      {showMembers && <aside className="members-panel glass" aria-label={panelView === 'history' ? '聊天记录' : '会话成员'}>{panelView === 'history'
        ? <HistorySearch room={room} userMap={userMap} privateMode={privateMode} historyVersion={historyVersion} onBack={() => setPanelView('members')} onJump={jumpToMessage} />
        : <><div className="members-panel-heading"><h3>会话成员 <small>{groupMembers.length}</small></h3><IconButton icon={X} label="关闭成员面板" size={15} onClick={() => setShowMembers(false)} /></div>{room.kind === 'group' && <button className="add-member-button" onClick={() => setModal('addMembers')}><UserPlus size={15} />邀请成员</button>}<button className="history-entry" onClick={() => setPanelView('history')}><MessagesSquare size={16} /><span>聊天记录</span><ChevronRight size={14} /></button>
          {room.kind === 'group' && <>
            {groupOwner === state.me.id && <button className="history-entry" onClick={() => setGroupAction({ type: 'name' })}><PencilLine size={16} /><span>修改群名</span><ChevronRight size={14} /></button>}
            <section className="announcement-card" aria-label="群公告"><div className="announcement-heading"><Megaphone size={14} /><b>群公告</b>{groupOwner === state.me.id && <button className="text-button" onClick={() => setGroupAction({ type: 'announcement' })}>{room.announcement ? '编辑' : '发布'}</button>}</div>
              <p>{room.announcement?.text || '暂无公告'}</p></section>
          </>}
          <div className="members-list">{groupMembers.map(user => memberRow(user, 30, room.kind === 'group'))}</div>
          {room.kind === 'group' && <button className="leave-group" onClick={() => setGroupAction({ type: 'leave' })}><LogOut size={15} />退出群聊</button>}</>}</aside>}</div>
      </> : <div className="empty-conversation"><MessageCircle size={32} /><h2>选择一个对话</h2><button className="secondary-button" onClick={() => setModal('members')}>发起私聊</button></div>}
    </main>
    {modal === 'profile' && <ProfileDialog cloud={cloud} me={state.me} onClose={() => setModal(null)} onUpdate={updateMe} notify={notify} />}
    {modal === 'invite' && <InviteDialog cloud={cloud} onClose={() => setModal(null)} notify={notify} />}
    {modal === 'admin' && cloud && isAdmin && <AdminDialog me={state.me} onClose={() => setModal(null)} onUpdated={refresh} notify={notify} />}
    {modal === 'password' && <Modal title="修改密码" subtitle="修改后，其他设备需要重新登录。" onClose={() => setModal(null)}><PasswordForm onChanged={() => location.reload()} /></Modal>}
    {['group', 'addMembers'].includes(modal) && <GroupDialog users={state.users.filter(user => !user.removed)} me={state.me} room={modal === 'addMembers' ? room : null} onClose={() => setModal(null)} onCreated={async id => { await refresh(); openRoom(id); }} notify={notify} />}
    {modal === 'connection' && <ConnectionDialog theme={theme} onTheme={setTheme} update={update} onUpdate={setUpdate} connected={connected} me={state.me} workspace={state.workspace} onPassword={() => setModal('password')} onLogout={logout} loggingOut={loggingOut} onCleared={result => { syncHistory([], result.throughSeq); return refresh(); }} onClose={() => setModal(null)} notify={notify} />}
    {modal === 'members' && <Modal title="空间成员" subtitle={`${state.users.filter(user => !user.removed).length} 位成员，${online.length} 人在线。点一位成员开始私聊。`} onClose={() => setModal(null)}><div className="space-members">{state.users.filter(user => !user.removed).map(user => memberRow(user, 32))}</div><div className="modal-footer"><button className="secondary-button" onClick={() => setModal('invite')}><UserPlus size={15} />邀请新同事</button></div></Modal>}
    {preview && !privateMode && (() => {
      const images = currentMessages.filter(message => !message.recalledAt).flatMap(message => message.attachments.filter(file => file.mime.startsWith('image/')));
      const index = Math.max(0, images.findIndex(file => file.id === preview.id));
      return <ImageViewer images={images.length ? images : [preview]} index={images.length ? index : 0} onIndex={next => setPreview(images[next])} onClose={() => setPreview(null)} notify={notify} />;
    })()}
    {removing && <RemoveMemberDialog user={removing} onClose={() => setRemoving(null)} onRemoved={async () => { setRemoving(null); await refresh(); notify("成员已移除，邀请码已更新"); }} />}
    {readDetail && currentMessages.some(message => message.id === readDetail.id) && <ReadDetail anchor={readDetail} message={currentMessages.find(message => message.id === readDetail.id)} members={groupMembers.filter(user => user.id !== state.me.id)} onClose={closeReadDetail} />}
    {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}
    {groupAction?.type === 'name' && room?.kind === 'group' && <GroupEditDialog room={room} field="name" onClose={() => setGroupAction(null)} onSaved={refresh} />}
    {groupAction?.type === 'announcement' && room?.kind === 'group' && <GroupEditDialog room={room} field="announcement" onClose={() => setGroupAction(null)} onSaved={refresh} />}
    {groupAction?.type === 'transfer' && room && <ConfirmDialog title={`把群主转让给「${groupAction.user.name}」？`} subtitle="转让后，你将不能再修改群名和群公告。" confirmLabel="确认转让" busyLabel="正在转让…"
      onConfirm={async () => { await api('room-owner', { roomId: room.id, userId: groupAction.user.id }); await refresh(); notify('群主已转让'); }} onClose={() => setGroupAction(null)} />}
    {groupAction?.type === 'leave' && room && <ConfirmDialog title={`退出「${room.name}」？`} subtitle={groupOwner === state.me.id ? '你是群主，退出后群主会自动转给最早加入的成员。退出后将看不到这个群的消息。' : '退出后将看不到这个群的消息，需要群里的人重新邀请才能回来。'} confirmLabel="退出群聊" busyLabel="正在退出…" danger
      onConfirm={async () => { await api('room-leave', { roomId: room.id }); setSelected('lobby'); setShowMembers(false); await refresh(); notify('已退出群聊'); }} onClose={() => setGroupAction(null)} />}
    {switcher && <QuickSwitcher rooms={ordered} icon={target => roomIcon(target, 24)} unread={unread} onOpen={id => { setSwitcher(false); openRoom(id); }} onClose={() => setSwitcher(false)} />}
    {forwarding && <ForwardDialog count={forwarding.length} rooms={rooms.filter(target => !target.hidden)} icon={target => roomIcon(target, 32)} onClose={() => setForwarding(null)} onForward={forwardTo} />}
    {recalling && <RecallDialog message={recalling} onClose={() => setRecalling(null)} onRecalled={message => { syncHistory([message]); notify('消息已撤回'); }} />}
    {toastElement}
  </div>;
}

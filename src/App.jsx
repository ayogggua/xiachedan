import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, MessagesSquare, Users, Settings2, Search, Plus, Hash, Eye, EyeOff, WifiOff, UserPlus, ChevronLeft, ChevronRight, ArrowDown, ArrowUp, X, Check, LoaderCircle, RefreshCw, ShieldCheck, Pin, BellOff, Megaphone, PencilLine, LogOut, Crown, Bot, Images, Bookmark, Clock, CheckCheck, Download, AtSign, FolderPlus, Timer, BookUser, MicOff, Link2, UserCheck, IdCard } from 'lucide-react';
import { api, downloadExport, formatTime, mediaUrl, nativeTitlebar, seenText, uid } from './api';
import { Avatar, IconButton, Logo, Message, Modal, PrivatePreview, ContextMenu, OutboxMessage, ProfileCard, ReadDetail, longPressHandlers, consumeLongPress, pressEvent, nameColor, activeStatus, StatusEmoji } from './components';
import Onboarding from './Onboarding';
import Account, { AdminDialog, PasswordForm } from './Account';
import Composer from './Composer';
import { ProfileDialog, RoomAvatarDialog, InviteDialog, GroupDialog, RemoveMemberDialog, RecallDialog, EditHistoryDialog, ForwardDialog, ConfirmDialog, GroupEditDialog, WebhooksDialog, AuditDialog, PollDialog, ScheduleDialog, ScheduledListDialog, ReminderDialog, MuteDialog, ShortcutsDialog, FolderDialog, StatusDialog, BundleDialog } from './dialogs';
import useUnread from './useUnread';
import useChatSession from './useChatSession';
import useConversations from './useConversations';
import usePinnedDrag from './usePinnedDrag';
import useOutbox from './useOutbox';
import { SettingsDialog } from './Settings';
import { messageLink, groupInviteLink } from './markdown';
import useDesktopBridge from './useDesktopBridge';
import useTheme from './useTheme';
import useAppearance from './appearance';
import useChatPrefs from './chatPrefs';
import ImageViewer from './ImageViewer';
import QuickSwitcher from './QuickSwitcher';
import RoomFiles from './RoomFiles';
import ThreadPanel from './ThreadPanel';
import HistorySearch, { SearchResult, SearchStatus, useMessageSearch } from './HistorySearch';
import { previewText, readStorage } from './history';

const NO_REACTIONS = [];
// 按会话自动删除的几档（秒）。
const AUTO_DELETE_OPTIONS = [[0, '关闭'], [86400, '1 天'], [604800, '1 周'], [2592000, '1 个月']];
const autoDeleteLabel = seconds => AUTO_DELETE_OPTIONS.find(([value]) => value === seconds)?.[1] || '';

// 选中的文字如果都在这条消息的正文里，就作为引用片段（Telegram 式部分引用）。
function selectedQuote(messageId) {
  const selection = window.getSelection();
  const text = selection?.toString().replace(/\s+/g, ' ').trim();
  if (!text || !selection.rangeCount) return '';
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const element = node.nodeType === 1 ? node : node.parentElement;
  const body = element?.closest('.message-text');
  return body && body.closest('[data-message-id]')?.dataset.messageId === messageId ? text.slice(0, 500) : '';
}

export default function App() {
  const [selected, setSelected] = useState('lobby');
  const [lastRead, setLastRead] = useState(() => readStorage('linliao.read', {}));
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [replying, setReplying] = useState(null);
  const [editing, setEditing] = useState(null);
  const [removingMessage, setRemovingMessage] = useState(null);
  // 当前会话的置顶消息；横条依次显示，点一下跳到那条消息并换到下一条。
  const [pins, setPins] = useState({ roomId: null, pins: [], canPin: false });
  const [pinIndex, setPinIndex] = useState(0);
  // 自己收藏的消息：菜单据此显示「收藏 / 取消收藏」，收藏夹弹窗列出全部。
  const [saved, setSaved] = useState([]);
  // 当前会话里自己还没发出的定时消息、正在设置提醒的消息。
  const [scheduled, setScheduled] = useState({ roomId: null, items: [] });
  const [scheduleText, setScheduleText] = useState(null);
  // 打开着的话题（根消息标识），显示在右侧面板。
  const [threadRoot, setThreadRoot] = useState(null);
  const [mutingUser, setMutingUser] = useState(null);
  const [openBundle, setOpenBundle] = useState(null);
  const [reminding, setReminding] = useState(null);
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
  const [profileCard, setProfileCard] = useState(null);
  const [draftTexts, setDraftTexts] = useState({});
  const [contactQuery, setContactQuery] = useState('');
  // 会话列表上方的分组标签：全部 / 未读 / 群聊 / 私聊 / 自建文件夹；停在哪个标签只记在本机。
  const [folderTab, setFolderTab] = useState(() => localStorage.getItem('linliao.folderTab') || 'all');
  const [editingFolder, setEditingFolder] = useState(null);
  const chooseFolderTab = id => { setFolderTab(id); try { localStorage.setItem('linliao.folderTab', id); } catch {} };
  const [historyFor, setHistoryFor] = useState(null);
  // 撤回后可以「重新编辑」：原文只在本机内存里保留 10 分钟，用过一次就丢弃。
  const [recalledTexts, setRecalledTexts] = useState({});
  const [injectDraft, setInjectDraft] = useState(null);
  const forgetRecalled = useCallback(id => setRecalledTexts(previous => { const { [id]: _, ...rest } = previous; return rest; }), []);
  const closeProfile = useCallback(() => setProfileCard(null), []);
  const avatarClick = useRef(0);
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
  const [appearance, setAppearance] = useAppearance();
  const [chatPrefs, setChatPrefs] = useChatPrefs();
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
    syncHistory, receive, markMessageRead, loadOlder: fetchOlder, loadThrough, updateMe, applyReactions, applyEdit, typing, sendTyping, pinsVersion, savedVersion, applyPoll, threadTick, applyNote, applyFolders, applyKeywords } = useChatSession({ selected, notify, privacyRef, mutedRef: mutedRooms, onHistoryChanged });
  const { rooms: conversations, scope: conversationScope, restore: restoreConversation, act: conversationAction, reorder: reorderPinned } =
    useConversations({ state, spaceId: bootstrap?.spaceId, selected, onSelect: setSelected, notify });
  const pinnedDrag = usePinnedDrag(ids => reorderPinned(ids, conversationScope));
  const outbox = useOutbox({ storageKey: conversationScope && `linliao.outbox:${conversationScope}`, connected: connected && !loggingOut, onSent: receive });
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
  // 正在编辑的消息同样以最新状态为准；按 ↑ 编辑自己最近一条还能编辑的消息。
  const editTarget = editing?.roomId === selected ? currentMessages.find(message => message.id === editing.id && !message.recalledAt) || null : null;
  const lastOwn = state?.me ? currentMessages.findLast(message => message.senderId === state.me.id && !message.recalledAt) : null;
  const replyMessage = replying?.roomId === selected ? currentMessages.find(message => message.id === replying.id && !message.recalledAt) || null : null;
  const replyTarget = replyMessage && replying.quote ? { ...replyMessage, quote: replying.quote } : replyMessage;
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
  const unreadRooms = JSON.stringify(loggingOut ? [] : conversations.filter(room => !room.hidden && (!room.muted || unread[room.id]?.mentioned) && (unread[room.id]?.hasUnread || room.markedUnread)).map(room => room.id));
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
      // 输入框已经处理过的组合键（如 ⌘K 插入链接）不再当作全局快捷键。
      if (event.defaultPrevented || !(mac ? event.metaKey : event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (document.querySelector('dialog[open]:not(.quick-switcher)')) return;
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); setSwitcher(value => !value); return; }
      if (event.key === '/') { event.preventDefault(); setSwitcher(false); setModal('shortcuts'); return; }
      const target = /^[1-9]$/.test(event.key) && orderedRef.current[Number(event.key) - 1];
      if (target) { event.preventDefault(); setSwitcher(false); setSelected(target.id); setMobileChat(true); setReadDetail(null); setPanelView('members'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setSelection(null); setReactingTo(null); }, [selected]);
  useEffect(() => {
    if (!state?.me.id) return;
    let alive = true;
    api('saved').then(result => { if (alive) setSaved(result.items); }).catch(() => {});
    return () => { alive = false; };
  }, [state?.me.id, savedVersion, historyVersion]);
  const lastScheduledSeq = currentMessages.findLast(message => message.clientId?.startsWith('scheduled:'))?.seq;
  const loadScheduled = useCallback(roomId => api(`scheduled?roomId=${encodeURIComponent(roomId)}`).then(result => setScheduled({ roomId, items: result.items })).catch(() => {}), []);
  useEffect(() => { if (state?.me.id && selected) loadScheduled(selected); }, [selected, state?.me.id, lastScheduledSeq, loadScheduled]);
  useEffect(() => {
    if (!state?.me.id || !selected) return;
    let alive = true;
    api(`room-pins?roomId=${encodeURIComponent(selected)}`).then(result => { if (alive) { setPins({ roomId: selected, ...result }); setPinIndex(0); } }).catch(() => {});
    return () => { alive = false; };
  }, [selected, state?.me.id, pinsVersion, historyVersion]);
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
  function openThread(rootId) { setThreadRoot(rootId); setPanelView('thread'); setShowMembers(true); }
  async function jumpToMessage(target) {
    if (target.threadOf) { if (target.roomId !== selected) setSelected(target.roomId); openThread(target.threadOf); return; }
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
  async function forwardTo(target, merge = false, comment = '') {
    const result = await api('forward', { roomId: target.id, messageIds: forwarding, merge });
    setSelection(null);
    if (target.id === selected) for (const message of result.messages) receive(message);
    // 附言作为一条普通消息，跟在转发的内容之后。
    if (comment) {
      try { const { message } = await api('messages', { roomId: target.id, text: comment, clientId: uid() }); if (target.id === selected) receive(message); }
      catch (error) { notify(`已转发，但附言没有发出：${error.message}`); await refresh(); return; }
    }
    notify(`已转发到「${target.name}」`);
    await refresh();
  }
  async function votePoll(message, options) {
    try { applyPoll(await api('polls/vote', { messageId: message.id, options })); }
    catch (error) { notify(error.message); }
  }
  async function closePoll(message) {
    try { applyPoll(await api('polls/close', { messageId: message.id })); notify('投票已结束'); }
    catch (error) { notify(error.message); }
  }
  async function toggleSaved(message, value) {
    try { await api('saved', { messageId: message.id, saved: value }); setSaved((await api('saved')).items); notify(value ? '已收藏' : '已取消收藏'); }
    catch (error) { notify(error.message); }
  }
  async function togglePin(message, pinned) {
    try { const result = await api('room-pins', { roomId: message.roomId, messageId: message.id, pinned }); setPins(previous => ({ ...previous, roomId: message.roomId, pins: result.pins })); setPinIndex(0); notify(pinned ? '已置顶这条消息' : '已取消置顶'); }
    catch (error) { notify(error.message); }
  }
  async function toggleReaction(message, emoji) {
    try { applyReactions(await api('reactions', { messageId: message.id, emoji })); }
    catch (error) { notify(error.message); }
  }
  async function directMessage(user) {
    if (user.id === state.me.id) return setModal('profile');
    try { const result = await api('rooms', { userId: user.id }); await refresh(); openRoom(result.id); setModal(null); setTimeout(() => document.querySelector('.composer textarea')?.focus(), 60); }
    catch (error) { notify(error.message); }
  }
  // 资料卡贴着头像弹出：头像在右半边时卡片放在左侧。
  function openProfile(user, element) {
    const rect = element.getBoundingClientRect();
    setProfileCard({ userId: user.id, x: rect.left > innerWidth / 2 ? rect.left - 268 : rect.right + 8, y: rect.top });
  }
  // 群聊头像和成员列表：单击看资料卡，双击直接发起私聊；单击稍等一下，免得双击时卡片闪一下。键盘回车立即打开。
  // 私聊里已经在和对方说话：单击只看资料卡，不等待双击。
  const profileClick = user => room?.kind === 'direct' ? { title: '查看资料', onClick: event => openProfile(user, event.currentTarget) } : ({
    title: user.id === state.me.id ? '查看资料' : '单击查看资料，双击发消息',
    onClick: event => { if (event.detail > 1) return; const element = event.currentTarget; clearTimeout(avatarClick.current);
      avatarClick.current = setTimeout(() => openProfile(user, element), event.detail === 0 || user.id === state.me.id ? 0 : 220); },
    onDoubleClick: () => { clearTimeout(avatarClick.current); if (user.id !== state.me.id) directMessage(user); },
  });
  const avatarButton = (user, children, className = 'avatar-button') => user
    ? <button type="button" className={className} data-user-id={user.id} aria-label={`查看${user.name}的资料`} {...profileClick(user)}>{children}</button> : children;
  // 群里资料卡上的管理操作：群主能设管理员、移出任何人；管理员只能移出普通成员。
  function groupActionsFor(user) {
    const amOwner = groupOwner === state.me.id, targetAdmin = groupAdmins.includes(user.id), targetOwner = user.id === groupOwner;
    const setAdmin = admin => async () => { setProfileCard(null); try { await api('room-admins', { roomId: room.id, userId: user.id, admin }); await refresh(); notify(admin ? `已把「${user.name}」设为管理员` : `已取消「${user.name}」的管理员`); } catch (error) { notify(error.message); } };
    return [
      ...(amOwner ? [{ label: targetAdmin ? '取消管理员' : '设为管理员', action: setAdmin(!targetAdmin) }] : []),
      ...(!targetOwner && (amOwner || (isGroupManager && !targetAdmin)) ? [{ label: '移出群聊', danger: true, action: () => { setProfileCard(null); setGroupAction({ type: 'remove', user }); } }] : []),
    ];
  }
  async function inviteLink(action) {
    try {
      const { inviteToken } = await api('room-invite', { roomId: room.id, action });
      await refresh();
      if (inviteToken) await copyInvite(inviteToken, action === 'create' && room.inviteToken ? '已重置，新链接已复制，旧链接失效' : '邀请链接已复制');
      else notify('邀请链接已停用');
    } catch (error) { notify(error.message); }
  }
  async function copyInvite(token, message = '邀请链接已复制') {
    const link = `${location.origin}${location.pathname}#join-group=${encodeURIComponent(room.id)}.${token}`;
    try { await (window.desktop?.copy ? window.desktop.copy(link) : navigator.clipboard.writeText(link)); notify(message); } catch (error) { notify(error.message); }
  }
  async function answerRequest(request, approve) {
    try { await api('room-requests', { roomId: room.id, requestId: request.id, approve }); await refresh(); notify(approve ? '已同意入群' : '已拒绝申请'); }
    catch (error) { notify(error.message); }
  }
  async function setRoomPolicy(change) {
    try { await api('room-policy', { roomId: room.id, ...change }); await refresh(); }
    catch (error) { notify(error.message); }
  }
  async function nudge(user) {
    try { receive((await api('nudge', { roomId: selected, userId: user.id })).message); }
    catch (error) { notify(error.message); }
  }
  async function saveNote(user, note) {
    try { applyNote(await api('user-note', { userId: user.id, note })); notify(note.trim() ? '备注已保存' : '备注已删除'); }
    catch (error) { notify(error.message); throw error; }
  }
  function openRoom(id) {
    if (!restoreConversation(id)) return;
    if (conversations.find(room => room.id === id)?.markedUnread) conversationAction('mark-read', id, conversationScope);
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
  // 标为已读：本机的已读位置推进到最新一条，不替别人发已读回执；标为未读只是给自己留个记号。
  function markRead(target) {
    const seq = target.lastMessage?.seq || 0;
    setLastRead(previous => seq > (previous[target.id] || 0) ? { ...previous, [target.id]: seq } : previous);
    if (target.markedUnread) conversationAction('mark-read', target.id, conversationScope);
  }
  function conversationMenu(event, target) {
    const pin = target.pinned ? 'unpin' : 'pin';
    const mute = target.muted ? 'unmute' : 'mute';
    const unreadNow = Boolean(unread[target.id]?.hasUnread || target.markedUnread);
    showContextMenu(event, { kind: 'conversation', pinned: target.pinned, muted: target.muted, unread: unreadNow }, [
      { id: unreadNow ? 'read' : 'unread', label: unreadNow ? '标为已读' : '标为未读', action: () => unreadNow ? markRead(target) : conversationAction('mark-unread', target.id, conversationScope) },
      { id: pin, label: target.pinned ? '取消置顶' : '置顶对话', action: () => conversationAction(pin, target.id, conversationScope) },
      { id: mute, label: target.muted ? '取消免打扰' : '消息免打扰', action: () => conversationAction(mute, target.id, conversationScope) },
      { id: 'export', label: '导出聊天记录', action: () => downloadExport(target.id) },
      { id: 'remove', label: '移除对话', action: () => conversationAction('remove', target.id, conversationScope) },
    ], '对话操作');
  }
  function messageMenu(event, message) {
    const canCopy = Boolean(message.text) && !privateMode;
    const canRecall = message.senderId === state.me.id && !message.recalledAt;
    const canReply = !message.recalledAt && !message.nudge;
    const quote = canReply && !privateMode ? selectedQuote(message.id) : '';
    const canReact = canReply && Boolean(state.reactions?.length);
    const canEdit = canRecall && !message.poll && !message.nudge;
    const manager = state.workspace.mode === 'cloud' ? ['admin', 'super_admin'].includes(state.me.role) : state.workspace.ownerId === state.me.id;
    const canRemove = manager && message.senderId !== state.me.id && !message.recalledAt;
    const canPin = pins.roomId === message.roomId && pins.canPin && !message.recalledAt && !message.nudge;
    const pinned = pins.pins.some(item => item.message.id === message.id);
    const isSaved = saved.some(item => item.message.id === message.id);
    const act = action => {
      const current = messageContext.current;
      if (current.scope !== conversationScope) return;
      const latest = current.messages[message.roomId]?.find(item => item.id === message.id);
      if (!latest || latest.recalledAt) return;
      if (action === 'recall') setRecalling(latest);
      if (action === 'remove') setRemovingMessage(latest);
      if (action === 'pin' || action === 'unpin') togglePin(latest, action === 'pin');
      if (action === 'save' || action === 'unsave') toggleSaved(latest, action === 'save');
      if (action === 'remind') setReminding(latest);
      if (action === 'thread') openThread(latest.id);
      if (action === 'reply' || action === 'quote') { setEditing(null); setReplying({ roomId: latest.roomId, id: latest.id, quote: action === 'quote' ? quote : '' }); }
      if (action === 'react') setReactingTo(latest.id);
      if (action === 'edit') { setReplying(null); setEditing({ roomId: latest.roomId, id: latest.id }); }
      if (action === 'forward') setForwarding([latest.id]);
      if (action === 'select') setSelection([latest.id]);
      if (action === 'link') {
        const link = `${location.origin}${location.pathname}#msg=${encodeURIComponent(latest.roomId)}/${encodeURIComponent(latest.id)}`;
        return (window.desktop?.copy ? window.desktop.copy(link) : navigator.clipboard.writeText(link)).then(() => notify('消息链接已复制')).catch(error => notify(error.message));
      }
      if (action === 'copy' && !current.privateMode) {
        const copy = window.desktop?.copy ? window.desktop.copy(latest.text) : navigator.clipboard.writeText(latest.text);
        return copy.catch(error => notify(error.message));
      }
    };
    showContextMenu(event, { kind: 'message', canReply, canQuote: Boolean(quote), canThread: canReply && !message.threadOf, canReact, canForward: canReply, canCopy, canLink: !message.recalledAt, canEdit, canPin, pinned, canSave: canReply, saved: isSaved, canRemind: canReply, canRecall, canRemove }, [
      ...(canReply ? [{ id: 'reply', label: '回复', action: () => act('reply') }] : []),
      ...(quote ? [{ id: 'quote', label: '引用所选文字', action: () => act('quote') }] : []),
      ...(canReact ? [{ id: 'react', label: '回应', action: () => act('react') }] : []),
      ...(canReply ? [{ id: 'forward', label: '转发', action: () => act('forward') }, { id: 'select', label: '多选', action: () => act('select') }] : []),
      ...(canCopy ? [{ id: 'copy', label: '复制', action: () => act('copy') }] : []),
      ...(!message.recalledAt ? [{ id: 'link', label: '复制消息链接', action: () => act('link') }] : []),
      ...(canEdit ? [{ id: 'edit', label: '编辑', action: () => act('edit') }] : []),
      ...(canReply && !message.threadOf ? [{ id: 'thread', label: '在话题中回复', action: () => act('thread') }] : []),
      ...(canReply ? [{ id: 'remind', label: '提醒我…', action: () => act('remind') }] : []),
      ...(canReply ? [{ id: isSaved ? 'unsave' : 'save', label: isSaved ? '取消收藏' : '收藏', action: () => act(isSaved ? 'unsave' : 'save') }] : []),
      ...(canPin ? [{ id: pinned ? 'unpin' : 'pin', label: pinned ? '取消置顶消息' : '置顶消息', action: () => act(pinned ? 'unpin' : 'pin') }] : []),
      ...(canRecall ? [{ id: 'recall', label: '撤回消息', action: () => act('recall') }] : []),
      ...(canRemove ? [{ id: 'remove', label: '删除消息（管理员）', action: () => act('remove') }] : []),
    ], '消息操作');
  }
  // 长会话里每次更新只重渲染有变化的消息：传给 Message 的回调保持同一引用，调用时再取最新的状态和处理函数。
  const latest = useRef(null);
  const nicknameCache = useRef(new Map());
  const [editingNickname, setEditingNickname] = useState(null);
  // 切换标签或文件夹变化时，把选中的标签滚到可见位置。
  useEffect(() => { document.querySelector('.folder-tabs .active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [folderTab, state?.folders?.length]);
  // 点聊天里的消息链接，或从外部打开带 #msg= 的地址：查到所在位置后跳过去。
  useEffect(() => {
    if (!state?.me?.id) return;
    const fromAddress = () => {
      const target = messageLink(location.href), invite = groupInviteLink(location.href);
      if (!target && !invite) return;
      history.replaceState(null, '', location.pathname + location.search);
      if (target) latest.current?.openMessageLink(target); else latest.current?.joinGroup(invite);
    };
    const open = event => latest.current?.openMessageLink(event.detail);
    const join = event => latest.current?.joinGroup(event.detail);
    fromAddress();
    window.addEventListener('hashchange', fromAddress);
    window.addEventListener('linliao:open-message', open);
    window.addEventListener('linliao:join-group', join);
    return () => { window.removeEventListener('hashchange', fromAddress); window.removeEventListener('linliao:open-message', open); window.removeEventListener('linliao:join-group', join); };
  }, [state?.me?.id]);
  const recipientsCache = useRef([]);
  const messageHandlers = useMemo(() => ({
    onContextMenu: (event, message) => latest.current.messageMenu(event, message),
    onReply: target => { setEditing(null); setReplying({ roomId: target.roomId, id: target.id, quote: selectedQuote(target.id) }); },
    nameOf: id => latest.current.displayUser(latest.current.userMap[id])?.name || (id?.startsWith('webhook:') ? '机器人' : undefined),
    userOf: id => latest.current.displayUser(latest.current.userMap[id]),
    colorOf: id => nameColor(id, latest.current.userMap[id]),
    onOpenQuote: (reply, message) => latest.current.jumpToMessage({ id: reply.id, seq: reply.seq, roomId: message.roomId }),
    onReact: (message, emoji) => latest.current.toggleReaction(message, emoji),
    onVote: (message, options) => latest.current.votePoll(message, options),
    onClosePoll: message => latest.current.closePoll(message),
    onOpenThread: target => latest.current.openThread(target.id),
    onRead: (roomId, messageId) => latest.current.markMessageRead(roomId, messageId),
    onToggleSelect: target => setSelection(previous => previous.includes(target.id) ? previous.filter(id => id !== target.id) : [...previous, target.id]),
    onReadDetail: (event, message) => { const rect = event.currentTarget.getBoundingClientRect(); setReadDetail(current => current?.id === message.id ? null : { id: message.id, x: rect.right, y: rect.top }); },
    onOpenBundle: setOpenBundle, onPick: setReactingTo, onPreview: setPreview,
    onReEdit: message => latest.current.reEdit(message),
    onShowHistory: setHistoryFor,
    onOpenProfile: (user, element) => latest.current.openProfile(user, element),
  }), []);
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
  latest.current = { messageMenu, userMap, displayUser, jumpToMessage, toggleReaction, votePoll, closePoll, openThread, markMessageRead, openProfile,
    joinGroup: async ({ roomId, token }) => {
      try {
        const result = await api('room-join', { roomId, token });
        if (result.pending) return notify('已申请加入，等待群主或管理员同意');
        await refresh(); openRoom(result.roomId);
      } catch (error) { notify(error.message); }
    },
    openMessageLink: async ({ id }) => {
      try { jumpToMessage(await api(`message-location?id=${encodeURIComponent(id)}`)); } catch (error) { notify(error.message); }
    },
    reEdit: message => { const saved = recalledTexts[message.id]; if (!saved) return; forgetRecalled(message.id); setInjectDraft({ roomId: message.roomId, text: saved.text, nonce: Date.now() }); } };
  // 还没看到的、提到我（或 @所有人）的消息：右下角的「@」按钮依次跳过去。
  const unreadMentions = currentMessages.filter(message => message.senderId !== state.me.id && !message.recalledAt && message.mentions?.some(id => id === state.me.id || id === '*')
    && Array.isArray(message.readBy) && !message.readBy.includes(state.me.id));
  // 群聊默认显示自己的头像、不显示自己的名字；私聊默认双方都不显示。都可以在设置里改。
  const showAvatar = mine => room?.kind === 'direct' ? chatPrefs.showBothInDirect : !mine || chatPrefs.showSelfInGroups;
  const showNameOf = mine => room?.kind === 'direct' ? chatPrefs.showBothInDirect : !mine || chatPrefs.showSelfNameInGroups;
  const recipientIds = groupMembers.filter(user => user.id !== state.me.id).map(user => user.id);
  if (recipientIds.join() !== recipientsCache.current.join()) recipientsCache.current = recipientIds;
  const query = search.trim().toLowerCase();
  const folders = state.folders || [];
  const activeFolder = folders.find(folder => folder.id === folderTab);
  const tabKey = ['all', 'unread', 'groups', 'direct'].includes(folderTab) || activeFolder ? folderTab : 'all';
  const roomUnread = room => Boolean(unread[room.id]?.hasUnread || room.markedUnread);
  const inTab = (room, key = tabKey) => key === 'unread' ? roomUnread(room) : key === 'groups' ? room.kind !== 'direct' : key === 'direct' ? room.kind === 'direct'
    : key === 'all' ? true : Boolean(folders.find(folder => folder.id === key)?.roomIds.includes(room.id));
  const folderTabs = [['all', '全部'], ['unread', '未读'], ['groups', '群聊'], ['direct', '私聊'], ...folders.map(folder => [folder.id, folder.name])]
    .map(([id, label]) => ({ id, label, unread: id === 'all' ? 0 : rooms.filter(room => !room.hidden && inTab(room, id) && roomUnread(room)).length }));
  const filtered = rooms.filter(room => (!room.hidden || query) && room.name.toLowerCase().includes(query) && (query || inTab(room)));
  const showGroupSection = ['all', 'groups'].includes(tabKey) || filtered.some(room => !room.pinned && room.kind !== 'direct');
  const showDirectSection = ['all', 'direct'].includes(tabKey) || filtered.some(room => !room.pinned && room.kind === 'direct');
  async function saveFolder(folder, name, roomIds) {
    const result = await api(folder ? 'folders/update' : 'folders', { ...(folder ? { id: folder.id } : {}), name, roomIds });
    applyFolders(result.folders);
    if (!folder) chooseFolderTab(result.folders.at(-1).id);
  }
  async function deleteFolder(folder) {
    applyFolders((await api('folders/delete', { id: folder.id })).folders);
    chooseFolderTab('all');
  }
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
  const roomIcon = (target, size = 32) => target.kind === 'direct' ? <Avatar user={peerOf(target)} size={size} online={peerOf(target)?.online} /> : target.avatar ? <Avatar user={{ avatar: target.avatar }} size={size} /> : <span className="room-avatar">{target.kind === 'public' ? <Hash size={16} /> : <Users size={16} />}</span>;
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
  const roomButton = (target, pinnedIds) => {
    const status = unread[target.id];
    const label = status?.hasUnread ? status.exact ? `${status.count} 条未读消息` : '有新消息' : '标为未读';
    const showUnread = status?.hasUnread || target.markedUnread;
    const sortable = Array.isArray(pinnedIds);
    const press = longPressHandlers(longPress, (x, y) => conversationMenu(pressEvent(x, y), target));
    return <button className={`conversation ${selected === target.id ? 'active' : ''} ${showUnread ? 'has-unread' : ''} ${target.muted ? 'muted' : ''} ${status?.mentioned ? 'mentioned' : ''} ${pinnedDrag.dragging === target.id ? 'dragging' : ''}`} key={target.id} data-room-id={target.id} aria-current={selected === target.id ? 'page' : undefined} aria-haspopup="menu"
      style={sortable ? pinnedDrag.styleFor(target.id) : undefined} aria-keyshortcuts={sortable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
      onClick={() => { if (sortable && pinnedDrag.consumeClick()) return; if (!consumeLongPress(longPress)) openRoom(target.id); }} {...press}
      onPointerDown={event => { press.onPointerDown(event); if (sortable) pinnedDrag.begin(event, target.id, pinnedIds); }}
      onContextMenu={event => { if (longPress.current.fired) event.preventDefault(); else conversationMenu(event, target); }}
      onKeyDown={event => { if (sortable && pinnedDrag.keyMove(event, target.id, pinnedIds)) return; if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { const rect = event.currentTarget.getBoundingClientRect(); conversationMenu(Object.assign(pressEvent(rect.left + 24, rect.bottom), { preventDefault: () => event.preventDefault() }), target); } }}>
      <span className="conversation-icon" title={compact ? target.name : undefined}>{roomIcon(target, 44)}{compact && showUnread && <i className="compact-dot" aria-hidden="true" />}</span><span className="conversation-copy"><span className="conversation-title"><span className="conversation-name">{target.name}</span>{target.kind === 'direct' && <StatusEmoji user={peerOf(target)} />}{target.pinned && <Pin className="conversation-pin" size={11} aria-label="已置顶" />}{target.muted && <BellOff className="conversation-pin" size={11} aria-label="免打扰" />}<time>{target.lastMessage ? formatTime(target.lastMessage.createdAt) : ''}</time></span>
        <span className="conversation-preview">{status?.mentioned && <span className="mention-flag">[有人@我]</span>}{typingLabel(target) ? <span className="typing-text">{typingLabel(target)}</span> : target.id !== selected && draftTexts[target.id] ? <span className="draft-preview"><span className="draft-tag">[草稿]</span><PrivatePreview privateMode={privateMode}>{draftTexts[target.id].replace(/\s+/g, ' ')}</PrivatePreview></span> : <PrivatePreview privateMode={privateMode && Boolean(target.lastMessage)}>{previewText(target.lastMessage)}</PrivatePreview>}{showUnread && <span className="unread-badge" aria-label={label} title={label}>{status?.hasUnread ? status.exact ? status.count > 99 ? '99+' : status.count : '新' : ''}</span>}</span>
      </span>
    </button>;
  };
  const groupOwner = room?.kind === 'group' ? room.ownerId : null;
  const groupAdmins = room?.kind === 'group' ? room.adminIds || [] : [];
  // 群昵称只在这个群里生效：显示用的用户对象换上昵称，原始对象和昵称都没变时复用同一个，消息才不会白白重新渲染。
  const nicknames = room?.kind === 'group' ? room.nicknames || {} : {};
  const nicknamesKey = JSON.stringify(nicknames);
  function displayUser(user) {
    const nick = user && nicknames[user.id];
    if (!nick) return user;
    const cached = nicknameCache.current.get(user.id);
    if (cached?.base === user && cached.nick === nick) return cached.value;
    const value = { ...user, name: nick, realName: user.name };
    nicknameCache.current.set(user.id, { base: user, nick, value });
    return value;
  }
  async function saveNickname(nickname) {
    try { await api('room-nickname', { roomId: room.id, nickname }); await refresh(); setEditingNickname(null); notify(nickname.trim() ? '群昵称已更新' : '已恢复原名'); }
    catch (error) { notify(error.message); }
  }
  const isGroupManager = groupOwner === state.me.id || groupAdmins.includes(state.me.id);
  const canSetAutoDelete = room?.kind === 'direct' || (room?.kind === 'group' ? groupOwner === state.me.id : room?.kind === 'public' && (cloud ? isAdmin : isOwner));
  const canEditRoomAvatar = room?.kind === 'group' ? groupOwner === state.me.id : room?.kind === 'public' && (cloud ? isAdmin : isOwner);
  // 右侧成员面板里单击看资料卡、双击私聊；「空间成员」弹窗里单击直接私聊。
  const memberRow = (user, size, inGroup = false, panel = false) => { const shown = inGroup ? displayUser(user) : user; return <div className="managed-member" key={user.id}><button className="member-row" {...(panel ? profileClick(user) : { onClick: () => directMessage(user) })}><Avatar user={user} size={size} online={user.online} /><span className="member-name" title={shown.realName ? `原名：${shown.realName}` : undefined}>{shown.name}<StatusEmoji user={user} />{user.department && <small className="member-department">{user.department}</small>}{user.id === state.me.id && <small className="me-tag">我</small>}{user.muted && <small className="muted-tag">已禁言</small>}{inGroup && user.id === groupOwner && <small className="owner-tag"><Crown size={10} />群主</small>}{inGroup && groupAdmins.includes(user.id) && <small className="owner-tag admin-tag">管理员</small>}</span><small title={user.bio || undefined}>{user.online ? '在线' : user.lastSeen ? seenText(user.lastSeen) : '离线'}</small><ChevronRight size={14} /></button>{!inGroup && (cloud ? isAdmin : isOwner) && user.id !== state.me.id && user.id !== state.workspace.ownerId && <button className="remove-member" aria-haspopup="menu" aria-label={`管理${user.name}`} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      setContextMenu({ x: rect.left - 100, y: rect.bottom + 4, label: `管理${user.name}`, items: [
        { id: 'mute', label: user.muted ? '解除禁言' : '禁言…', action: async () => { if (!user.muted) return setMutingUser(user); try { await api('admin/mute', { userId: user.id, muted: false }); notify('已解除禁言'); } catch (error) { notify(error.message); } } },
        ...(isOwner && !cloud ? [{ id: 'remove', label: '从空间移除', action: () => setRemoving(user) }] : []),
      ] });
    }}>管理</button>}
    {inGroup && groupOwner === state.me.id && user.id !== state.me.id && <button className="remove-member" onClick={() => setGroupAction({ type: 'transfer', user })} aria-label={`把群主转让给${user.name}`}>转让</button>}</div>; };
  // 通讯录：按部门分组，没填部门的放最后；组内在线的排前面。
  const contactNeedle = contactQuery.trim().toLowerCase();
  const contactGroups = Object.entries(state.users.filter(user => !user.removed && (!contactNeedle || [user.name, user.department, user.bio].some(value => value?.toLowerCase().includes(contactNeedle))))
    .reduce((groups, user) => { (groups[user.department || '未设置部门'] ||= []).push(user); return groups; }, {}))
    .sort(([a], [b]) => (a === '未设置部门') - (b === '未设置部门') || a.localeCompare(b, 'zh-Hans-CN'))
    .map(([department, members]) => [department, members.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'zh-Hans-CN'))]);
  const peerStatus = room?.kind === 'direct' && activeStatus(peer);
  const subtitle = room?.kind === 'direct' ? (peerStatus ? `${peerStatus.emoji} ${peerStatus.text} · `.replace(/^ /, '') : '') + (peer?.online ? '在线' : peer?.lastSeen ? seenText(peer.lastSeen) : '离线 · 上线后送达') : `${groupMembers.length} 位成员 · ${groupMembers.filter(user => user.online).length} 人在线`;
  const sameGroup = (previous, message) => previous && !previous.recalledAt && !message.recalledAt && !previous.nudge && !message.nudge && previous.senderId === message.senderId &&
    new Date(previous.createdAt).toDateString() === new Date(message.createdAt).toDateString() && message.createdAt - previous.createdAt < 5 * 60000;
  const userOf = message => displayUser(userMap[message.senderId]) || (message.bot ? { id: message.senderId, name: message.bot, avatar: 'bot' } : undefined);
  // 同一个人连续发的消息合成一组：头像放在组的一侧，滚动时贴住可视区底部。
  const messageGroups = [];
  for (const [index, message] of currentMessages.entries()) {
    const previous = currentMessages[index - 1];
    const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
    if (!newDay && sameGroup(previous, message)) messageGroups.at(-1).messages.push(message);
    else messageGroups.push({ newDay, messages: [message] });
  }
  return <div className={`app ${privateMode ? 'privacy-on' : ''} ${nativeTitlebar ? 'native' : ''} ${mobileChat ? 'show-chat' : ''} ${compact ? 'compact-sidebar' : ''}`} style={{ '--sidebar': `${sidebarWidth}px` }} data-screen-label="虾扯蛋聊天空间">
    <aside className="sidebar glass" aria-label="会话列表">{resizer}
      <div className="sidebar-drag" data-drag-region aria-hidden="true" />
      <div className="space-heading" data-drag-region><div className="space-copy"><h1>{state.workspace.name}</h1><p><i className={`status-dot ${connected ? 'online' : ''}`} />{online.length} 人在线</p></div><span className="space-actions">{rooms.some(target => !target.hidden && (unread[target.id]?.hasUnread || target.markedUnread)) && <IconButton icon={CheckCheck} label="全部标为已读" onClick={() => { for (const target of rooms) if (!target.hidden && (unread[target.id]?.hasUnread || target.markedUnread)) markRead(target); notify('已全部标为已读'); }} />}<IconButton icon={BookUser} label="通讯录" onClick={() => { setContactQuery(''); setModal('members'); }} /><IconButton icon={Bookmark} label="收藏" onClick={() => setModal('saved')} /><IconButton icon={UserPlus} label="邀请同事" onClick={() => setModal('invite')} /></span></div>
      <label className="sidebar-search"><Search size={14} /><input aria-label="搜索会话和消息" placeholder="搜索会话和消息" value={search} onChange={event => setSearch(event.target.value)} />{search ? <IconButton icon={X} label="清空搜索" size={14} onClick={() => setSearch('')} /> : <button type="button" className="switch-hint" onClick={() => setSwitcher(true)} title="快速切换会话">{switchKey}</button>}</label>
      {!compact && <div className="folder-bar"><div className="folder-tabs" role="tablist" aria-label="会话分组">{folderTabs.map(tab => <button type="button" role="tab" key={tab.id} aria-selected={tab.id === tabKey} className={tab.id === tabKey ? 'active' : ''} onClick={() => chooseFolderTab(tab.id)}>
        {tab.label}{tab.unread > 0 && <span className="folder-unread">{tab.unread > 99 ? '99+' : tab.unread}</span>}</button>)}</div>
        {activeFolder && <IconButton icon={PencilLine} label="编辑这个文件夹" size={14} onClick={() => setEditingFolder(activeFolder)} />}
        <IconButton icon={FolderPlus} label="新建文件夹" size={14} onClick={() => setEditingFolder('new')} /></div>}
      <nav className="conversation-scroll" aria-label="会话">
        {filtered.some(room => room.pinned) && <><div className="section-label"><span>置顶</span></div>{(() => { const pinnedRooms = filtered.filter(room => room.pinned), ids = query || tabKey !== 'all' ? undefined : pinnedRooms.map(room => room.id); return pinnedRooms.map(target => roomButton(target, ids)); })()}</>}
        {showGroupSection && <><div className="section-label"><span>群聊</span><IconButton icon={Plus} label="新建群聊" size={15} onClick={() => setModal('group')} /></div>{filtered.filter(room => !room.pinned && room.kind !== 'direct').map(roomButton)}</>}
        {showDirectSection && <><div className="section-label"><span>私聊</span><IconButton icon={Plus} label="发起私聊" size={15} onClick={() => setModal('members')} /></div>{filtered.filter(room => !room.pinned && room.kind === 'direct').map(roomButton)}</>}
        {!query && !['all', 'groups', 'direct'].includes(tabKey) && !filtered.length && <p className="sidebar-empty">{tabKey === 'unread' ? '没有未读的会话。' : '这个文件夹里还没有会话，点上方的编辑按钮添加。'}</p>}
        {['all', 'direct'].includes(tabKey) && !filtered.some(room => room.kind === 'direct') && <p className="sidebar-empty">{search ? '没有匹配的私聊' : '找到一位同事，聊点新鲜事。'}</p>}
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
          <div className="toolbar-title glass">{room.kind === 'direct' && peer ? avatarButton(peer, roomIcon(room, 34), 'toolbar-icon avatar-button') : canEditRoomAvatar ? <button type="button" className="toolbar-icon avatar-button" aria-label="设置群头像" title="设置群头像" aria-haspopup="dialog" onClick={() => setModal('roomAvatar')}>{roomIcon(room, 34)}</button> : <span className="toolbar-icon">{roomIcon(room, 34)}</span>}<span className="toolbar-copy"><h2>{room.name}{room.kind === 'group' && room.allMuted && <span className="auto-delete-tag"><MicOff size={12} />全员禁言</span>}{room.autoDelete > 0 && <span className="auto-delete-tag" title={`消息发出 ${autoDeleteLabel(room.autoDelete)} 后自动删除`}><Timer size={12} />{autoDeleteLabel(room.autoDelete)}</span>}</h2><span className={`toolbar-subtitle ${typingLabel(room) ? 'typing-text' : ''}`} aria-live="polite">{typingLabel(room) || subtitle}</span></span></div>
          <div className="toolbar-actions">
            <button className={`toolbar-button glass privacy-toggle ${privateMode ? 'enabled' : ''}`} onClick={() => changePrivacy(value => !value)} role="switch" aria-checked={privateMode} aria-label="隐私模式" title="隐私模式 · ⌘⇧P · 悬停消息查看内容">{privateMode ? <EyeOff size={16} /> : <Eye size={16} />}<kbd>⌘⇧P</kbd></button>
            <button className={`toolbar-button glass member-count ${showMembers ? 'selected' : ''}`} onClick={() => { setShowMembers(value => !value); setPanelView('members'); }} aria-pressed={showMembers} aria-label={`会话成员，${groupMembers.length} 人`} title="会话成员"><span className="avatar-stack">{groupMembers.slice(0, 3).map(user => <Avatar key={user.id} user={user} size={20} />)}</span><span>{groupMembers.length}</span></button>
          </div>
        </header>
        {pins.roomId === room.id && pins.pins.length > 0 && (() => { const current = pins.pins[pinIndex % pins.pins.length]; return <div className="pinned-bar glass" role="note">
          <button type="button" className="pinned-open" onClick={() => { jumpToMessage({ id: current.message.id, seq: current.message.seq, roomId: room.id }); setPinIndex(index => index + 1); }} title="跳到这条消息">
            <Pin size={14} /><span><b>置顶消息{pins.pins.length > 1 ? ` ${pinIndex % pins.pins.length + 1}/${pins.pins.length}` : ''}</b><PrivatePreview privateMode={privateMode}>{previewText(current.message)}</PrivatePreview></span></button>
          {pins.canPin && <IconButton icon={X} label="取消置顶这条消息" size={14} onClick={() => togglePin(current.message, false)} />}
        </div>; })()}
        {room.kind === 'group' && room.announcement && dismissedNotices[room.id] !== room.announcement.updatedAt && <div className="announcement-banner glass" role="note">
          <Megaphone size={15} /><p><b>群公告</b><PrivatePreview privateMode={privateMode}>{room.announcement.text}</PrivatePreview></p>
          <IconButton icon={X} label="不再显示这条公告" size={14} onClick={() => setDismissedNotices(previous => ({ ...previous, [room.id]: room.announcement.updatedAt }))} />
        </div>}
        {!connected && !loggingOut && <div className="offline-pill glass" role="status"><WifiOff size={14} />正在重新连接，消息会在恢复后自动发送</div>}
        <div className="message-scroll" ref={messageList} onScroll={event => { const node = event.currentTarget; sticky.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; setScrolledUp(!sticky.current); checkUnreadAnchor(); }}><div className="message-list" ref={messageContent}>
        {hasMore[selected] && <button className="load-older" onClick={loadOlder} disabled={loading}>{loading ? '正在加载…' : '查看更早的消息'}</button>}
        {!hasMore[selected] && <div className={`channel-welcome ${currentMessages.length ? 'has-messages' : ''}`}><span className="welcome-icon">{room.kind === 'public' ? <Hash size={22} /> : room.kind === 'group' ? <Users size={22} /> : <MessageCircle size={22} />}</span><h3>{room.kind === 'public' ? cloud ? '大家都在，随便扯两句。' : '同一个网络，随便扯两句。' : room.kind === 'group' ? `欢迎来到「${room.name}」` : `和${room.name}聊聊吧`}</h3><p>{room.kind === 'public' ? '工作、日常、好玩的，都可以往这里丢。' : room.kind === 'group' ? '文字、图片、视频，把想分享的都留在这里。' : '有些话，适合只对一个人说。'}</p>{room.kind === 'public' && !currentMessages.length && <button className="secondary-button" onClick={() => setModal('invite')}><UserPlus size={15} />邀请同事加入</button>}</div>}
        {!currentMessages.length && loading && <div className="messages-loading"><LoaderCircle className="spin" size={17} />正在加载消息…</div>}
        {messageGroups.map(group => { const first = group.messages[0]; const mine = first.senderId === state.me.id; const author = userOf(first); const withAvatar = showAvatar(mine) && !first.nudge; const avatar = withAvatar && !first.recalledAt && <div className="group-avatar">{avatarButton(first.bot ? null : author, <Avatar user={author} size={32} />)}</div>;
          return <React.Fragment key={first.id}>{group.newDay && <div className="date-divider"><span>{new Date(group.messages[0].createdAt).toDateString() === new Date().toDateString() ? '今天' : new Date(group.messages[0].createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span></div>}<div className={`message-group ${mine ? 'mine' : ''} ${withAvatar && chatPrefs.avatarMode === 'top' ? 'avatar-top' : ''}`}>{!mine && avatar}<div className="group-rows">{group.messages.map((message, position) => <Message {...messageHandlers} key={message.id} message={message} users={state.users} nicknames={nicknamesKey} showName={position === 0 && !first.nudge && showNameOf(mine)} reEditable={Boolean(recalledTexts[message.id])} quickReact={chatPrefs.quickReact}
          reactionOptions={state.reactions || NO_REACTIONS} picking={reactingTo === message.id} selecting={Boolean(selection)} selected={Boolean(selection?.includes(message.id))}
          user={userOf(message)} grouped mine={message.senderId === state.me.id} continued={position > 0} last={position === group.messages.length - 1} privateMode={privateMode} viewerId={state.me.id}
          readingEnabled={(windowActive || privateMode) && !modal && !removing && !recalling && !contextMenu && !preview && !loading} recipients={recipientsCache.current} direct={room.kind === 'direct'} />)}</div>{mine && avatar}</div></React.Fragment>; })}
        {outbox.items.filter(item => item.roomId === room.id).map(item => <OutboxMessage key={item.clientId} item={item} avatarColumn={showAvatar(true)} onRetry={outbox.retry} onDiscard={outbox.discard} />)}
      </div></div>{unreadMentions.length > 0 && <button type="button" className="jump-to-mention glass" aria-label={`跳到提到你的消息，还有 ${unreadMentions.length} 条`} title="跳到提到你的消息" onClick={() => jumpToMessage(unreadMentions[0])}><AtSign size={18} /><span className="mention-count">{unreadMentions.length > 99 ? '99+' : unreadMentions.length}</span></button>}{scrolledUp && <button className="jump-to-latest glass" onClick={() => { sticky.current = true; messageList.current.scrollTo({ top: messageList.current.scrollHeight, behavior: 'smooth' }); }}><ArrowDown size={14} />{arrivedWhileAway ? `${arrivedWhileAway} 条新消息` : '回到最新消息'}</button>}
      {unreadAnchor?.roomId === selected && <button className="unread-anchor glass" onClick={jumpToFirstUnread}><ArrowUp size={14} />{unreadAnchor.count ? `${unreadAnchor.count} 条未读消息` : '跳到未读消息'}</button>}
      {selection ? <div className="selection-bar glass" role="toolbar" aria-label="多选消息">
        <span>已选 <b>{selection.length}</b> 条</span>
        <button className="secondary-button" onClick={() => setSelection(null)}>取消</button>
        <button className="primary-button" disabled={!selection.length} onClick={() => setForwarding([...selection])}>转发</button>
      </div> : room.kind === 'group' && room.allMuted && !isGroupManager ? <div className="muted-notice glass" role="status">全员禁言中，只有群主和管理员可以发言</div> : state.me.muted ? <div className="muted-notice glass" role="status">你已被管理员禁言{state.me.mutedUntil ? `，${new Date(state.me.mutedUntil).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 后恢复` : ''}</div> : <Composer injectDraft={injectDraft} sendKey={chatPrefs.sendKey} onDraft={(id, text) => setDraftTexts(previous => (previous[id] || '') === text ? previous : { ...previous, [id]: text })} room={room} connected={connected && !loggingOut} onQueue={(payload, preview) => { sticky.current = true; outbox.send(payload, preview); }} notify={notify} privateMode={privateMode}
        members={room.kind === 'direct' ? [] : groupMembers.filter(user => user.id !== state.me.id)} canMentionAll={room.kind === 'group' || (room.kind === 'public' && (isOwner || isAdmin))}
        notice={scheduled.roomId === room.id && scheduled.items.length > 0 && <button type="button" className="scheduled-bar glass" onClick={() => setModal('scheduled')}><Clock size={14} />{scheduled.items.length} 条定时消息待发送 · 最近 {new Date(scheduled.items[0].sendAt).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</button>}
        onCreatePoll={() => setModal('poll')} onSchedule={text => setScheduleText(text)} onTyping={sendTyping} editing={editTarget} onCancelEdit={() => setEditing(null)} onEdited={message => { applyEdit(message); setEditing(null); }}
        onEditLast={() => { if (lastOwn) { setReplying(null); setEditing({ roomId: lastOwn.roomId, id: lastOwn.id }); } }}
        reply={replyTarget} replyAuthor={replyTarget && (replyTarget.senderId === state.me.id ? '自己' : userMap[replyTarget.senderId]?.name || '成员')} onCancelReply={() => setReplying(null)} />}</section>
      {showMembers && <aside className="members-panel glass" aria-label={panelView === 'history' ? '聊天记录' : panelView === 'files' ? '图片与文件' : panelView === 'thread' ? '话题' : '会话成员'}>{panelView === 'thread' && threadRoot
        ? <ThreadPanel key={threadRoot} sendKey={chatPrefs.sendKey} rootId={threadRoot} userMap={userMap} viewerId={state.me.id} privateMode={privateMode} threadTick={threadTick} onBack={() => setPanelView('members')} notify={notify} />
        : panelView === 'files'
        ? <RoomFiles room={room} userMap={userMap} privateMode={privateMode} historyVersion={historyVersion} onBack={() => setPanelView('members')} onPreview={setPreview} onJump={jumpToMessage} />
        : panelView === 'history'
        ? <HistorySearch room={room} userMap={userMap} members={groupMembers} privateMode={privateMode} historyVersion={historyVersion} onBack={() => setPanelView('members')} onJump={jumpToMessage} />
        : <><div className="members-panel-heading"><h3>会话成员 <small>{groupMembers.length}</small></h3><IconButton icon={X} label="关闭成员面板" size={15} onClick={() => setShowMembers(false)} /></div>{room.kind === 'group' && <button className="add-member-button" onClick={() => setModal('addMembers')}><UserPlus size={15} />邀请成员</button>}<button className="history-entry" onClick={() => setPanelView('history')}><MessagesSquare size={16} /><span>聊天记录</span><ChevronRight size={14} /></button><button className="history-entry" onClick={() => setPanelView('files')}><Images size={16} /><span>图片与文件</span><ChevronRight size={14} /></button><button className="history-entry" onClick={() => downloadExport(room.id)}><Download size={16} /><span>导出聊天记录</span></button>
          {room.kind === 'group' && (editingNickname !== null
            ? <form className="nickname-form" onSubmit={event => { event.preventDefault(); saveNickname(editingNickname); }}><input autoFocus aria-label="我在本群的昵称" maxLength={16} placeholder={`留空则显示「${userMap[state.me.id]?.name}」`} value={editingNickname} onChange={event => setEditingNickname(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setEditingNickname(null); } }} />
                <button type="button" className="secondary-button" onClick={() => setEditingNickname(null)}>取消</button><button className="primary-button">保存</button></form>
            : <button type="button" className="history-entry" onClick={() => setEditingNickname(nicknames[state.me.id] || '')}><IdCard size={16} /><span>我在本群的昵称</span><small className="entry-value">{nicknames[state.me.id] || '未设置'}</small><ChevronRight size={14} /></button>)}
          {room.kind === 'group' && isGroupManager && <>
            <div className="history-entry policy-entry"><Link2 size={16} /><span>邀请链接<small>{room.inviteToken ? '本空间的成员点开链接即可加入' : '还没有链接'}</small></span>
              {room.inviteToken ? <span className="invite-actions"><button type="button" className="text-button" onClick={() => copyInvite(room.inviteToken)}>复制</button><button type="button" className="text-button" onClick={() => inviteLink('create')}>重置</button><button type="button" className="text-button danger-text" onClick={() => inviteLink('disable')}>停用</button></span>
                : <button type="button" className="text-button" onClick={() => inviteLink('create')}>生成并复制</button>}</div>
            <div className="history-entry policy-entry"><UserCheck size={16} /><span>入群审批<small>链接加入、成员拉人都要群主或管理员同意</small></span>
              <button type="button" role="switch" aria-label="入群审批" aria-checked={Boolean(room.joinApproval)} className={`switch ${room.joinApproval ? 'enabled' : ''}`} onClick={() => setRoomPolicy({ joinApproval: !room.joinApproval })}><i className="switch-track"><i /></i></button></div>
            {room.joinRequests?.length > 0 && <section className="join-requests" aria-label="入群申请"><h4>入群申请 <small>{room.joinRequests.length}</small></h4>
              {room.joinRequests.map(request => { const user = userMap[request.userId]; return <div className="join-request" key={request.id}><Avatar user={user} size={28} /><span><b>{user?.name || '成员'}</b><small>{request.invitedBy ? `${userMap[request.invitedBy]?.name || '成员'} 邀请` : '通过邀请链接'}</small></span>
                <button type="button" className="text-button danger-text" onClick={() => answerRequest(request, false)}>拒绝</button><button type="button" className="primary-button" onClick={() => answerRequest(request, true)}>同意</button></div>; })}</section>}
          </>}
          {room.kind === 'group' && isGroupManager && <div className="history-entry policy-entry"><MicOff size={16} /><span>全员禁言<small>只有群主和管理员可以发言</small></span>
            <button type="button" role="switch" aria-label="全员禁言" aria-checked={Boolean(room.allMuted)} className={`switch ${room.allMuted ? 'enabled' : ''}`} onClick={() => setRoomPolicy({ allMuted: !room.allMuted })}><i className="switch-track"><i /></i></button></div>}
          <label className="history-entry auto-delete-entry"><Timer size={16} /><span>自动删除消息</span>
            {canSetAutoDelete ? <select aria-label="自动删除消息" value={room.autoDelete || 0} onChange={async event => { try { await api('room-auto-delete', { roomId: room.id, seconds: Number(event.target.value) }); await refresh(); notify(Number(event.target.value) ? `消息将在发出 ${autoDeleteLabel(Number(event.target.value))} 后自动删除` : '已关闭自动删除'); } catch (error) { notify(error.message); } }}>
              {AUTO_DELETE_OPTIONS.map(([seconds, label]) => <option key={seconds} value={seconds}>{label}</option>)}</select>
              : <small>{room.autoDelete ? autoDeleteLabel(room.autoDelete) : '关闭'}</small>}</label>
          {canEditRoomAvatar && <div className="room-avatar-edit">
            {roomIcon(room, 40)}<button type="button" className="secondary-button" aria-haspopup="dialog" onClick={() => setModal('roomAvatar')}>{room.avatar ? '更换群头像' : '设置群头像'}</button>
          </div>}
          {room.kind === 'group' && <>
            {isGroupManager && <button className="history-entry" onClick={() => setGroupAction({ type: 'name' })}><PencilLine size={16} /><span>修改群名</span><ChevronRight size={14} /></button>}
            {groupOwner === state.me.id && <button className="history-entry" onClick={() => setGroupAction({ type: 'webhooks' })}><Bot size={16} /><span>群机器人</span><ChevronRight size={14} /></button>}
            <section className="announcement-card" aria-label="群公告"><div className="announcement-heading"><Megaphone size={14} /><b>群公告</b>{isGroupManager && <button className="text-button" onClick={() => setGroupAction({ type: 'announcement' })}>{room.announcement ? '编辑' : '发布'}</button>}</div>
              <p>{room.announcement?.text || '暂无公告'}</p></section>
          </>}
          {room.kind === 'public' && (isOwner || isAdmin) && <button className="history-entry" onClick={() => setGroupAction({ type: 'webhooks' })}><Bot size={16} /><span>大厅机器人</span><ChevronRight size={14} /></button>}
          <div className="members-list">{groupMembers.map(user => memberRow(user, 30, room.kind === 'group', true))}</div>
          {room.kind === 'group' && <button className="leave-group" onClick={() => setGroupAction({ type: 'leave' })}><LogOut size={15} />退出群聊</button>}</>}</aside>}</div>
      </> : <div className="empty-conversation"><MessageCircle size={32} /><h2>选择一个对话</h2><button className="secondary-button" onClick={() => setModal('members')}>发起私聊</button></div>}
    </main>
    {modal === 'profile' && <ProfileDialog me={{ ...state.me, ...userMap[state.me.id] }} onClose={() => setModal(null)} onUpdate={updateMe} notify={notify} />}
    {modal === 'roomAvatar' && room && room.kind !== 'direct' && <RoomAvatarDialog key={room.id} room={room} onClose={() => setModal(null)} onSaved={refresh} notify={notify} />}
    {modal === 'invite' && <InviteDialog cloud={cloud} onClose={() => setModal(null)} notify={notify} />}
    {modal === 'admin' && cloud && isAdmin && <AdminDialog me={state.me} onClose={() => setModal(null)} onUpdated={refresh} notify={notify} />}
    {modal === 'password' && <Modal title="修改密码" subtitle="修改后，其他设备需要重新登录。" onClose={() => setModal(null)}><PasswordForm onChanged={() => location.reload()} /></Modal>}
    {['group', 'addMembers'].includes(modal) && <GroupDialog users={state.users.filter(user => !user.removed)} me={state.me} room={modal === 'addMembers' ? room : null} onClose={() => setModal(null)} onCreated={async id => { await refresh(); openRoom(id); }} notify={notify} />}
    {modal === 'connection' && <SettingsDialog onSetStatus={() => setModal('status')} keywords={state.keywords || []} onKeywords={async list => applyKeywords((await api('keywords', { keywords: list })).keywords)} onShortcuts={() => setModal('shortcuts')} chatPrefs={chatPrefs} onChatPrefs={setChatPrefs} privateMode={privateMode} onPrivateMode={changePrivacy} onEditProfile={() => setModal('profile')} appearance={appearance} onAppearance={setAppearance} onChanged={refresh} onAudit={(cloud ? isAdmin : isOwner) ? () => setModal('audit') : undefined} theme={theme} onTheme={setTheme} update={update} onUpdate={setUpdate} connected={connected} me={state.me} workspace={state.workspace} onPassword={() => setModal('password')} onLogout={logout} loggingOut={loggingOut} onCleared={result => { syncHistory([], result.throughSeq); return refresh(); }} onClose={() => setModal(null)} notify={notify} />}
    {modal === 'members' && <Modal title="通讯录" subtitle={`${state.users.filter(user => !user.removed).length} 位成员，${online.length} 人在线。单击查看资料，双击直接私聊。`} onClose={() => setModal(null)} className="contacts-dialog">
      <label className="sidebar-search contacts-search"><Search size={14} /><input autoFocus aria-label="搜索成员" placeholder="搜索名字、部门或签名" value={contactQuery} onChange={event => setContactQuery(event.target.value)} /></label>
      <div className="space-members">{contactGroups.map(([department, members]) => <section key={department} aria-label={department}><h4 className="contacts-group">{department}<small>{members.length}</small></h4>{members.map(user => memberRow(user, 32, false, true))}</section>)}
        {!contactGroups.length && <p className="history-empty">没有找到「{contactQuery.trim()}」</p>}</div>
      <div className="modal-footer"><button className="secondary-button" onClick={() => setModal('invite')}><UserPlus size={15} />邀请新同事</button></div></Modal>}
    {preview && !privateMode && (() => {
      const images = currentMessages.filter(message => !message.recalledAt).flatMap(message => message.attachments.filter(file => file.mime.startsWith('image/')));
      const index = Math.max(0, images.findIndex(file => file.id === preview.id));
      return <ImageViewer images={images.length ? images : [preview]} index={images.length ? index : 0} onIndex={next => setPreview(images[next])} onClose={() => setPreview(null)} notify={notify} />;
    })()}
    {removing && <RemoveMemberDialog user={removing} onClose={() => setRemoving(null)} onRemoved={async () => { setRemoving(null); await refresh(); notify("成员已移除，邀请码已更新"); }} />}
    {/* 从通讯录等弹窗里打开时，资料卡要挂在弹窗里面，否则会被弹窗挡住 */}
    {profileCard && userMap[profileCard.userId] && createPortal(<ProfileCard key={profileCard.userId} user={userMap[profileCard.userId]} anchor={profileCard} self={profileCard.userId === state.me.id} onClose={closeProfile}
      note={state.notes?.[profileCard.userId] || ''} onSaveNote={note => saveNote(userMap[profileCard.userId], note)}
      onMessage={() => { setProfileCard(null); directMessage(userMap[profileCard.userId]); }} onSetStatus={() => { setProfileCard(null); setModal('status'); }}
      groupNickname={nicknames[profileCard.userId]}
      groupActions={room?.kind === 'group' && profileCard.userId !== state.me.id && room.members.includes(profileCard.userId) ? groupActionsFor(userMap[profileCard.userId]) : []}
      onSetDepartment={(cloud ? isAdmin : isOwner) && profileCard.userId !== state.me.id ? async department => { try { await api('admin/department', { userId: profileCard.userId, department }); notify('部门已更新'); } catch (error) { notify(error.message); throw error; } } : undefined}
      onNudge={room && (room.kind === 'public' || room.members.includes(profileCard.userId)) && !state.me.muted ? () => { setProfileCard(null); nudge(userMap[profileCard.userId]); } : undefined} onEdit={() => { setProfileCard(null); setModal('profile'); }} />, document.querySelector('dialog[open]') || document.body)}
    {readDetail && currentMessages.some(message => message.id === readDetail.id) && <ReadDetail anchor={readDetail} message={currentMessages.find(message => message.id === readDetail.id)} members={groupMembers.filter(user => user.id !== state.me.id)} onClose={closeReadDetail}
      onOpenProfile={(user, element) => { openProfile(user, element); setReadDetail(null); }} />}
    {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}
    {removingMessage && <ConfirmDialog title="删除这条消息？" subtitle={`会话里的所有人都会看到「管理员删除了一条消息」，内容无法恢复。这次操作会记入操作日志。`} confirmLabel="删除" busyLabel="正在删除…" danger
      onConfirm={async () => { const { message } = await api('admin/delete-message', { messageId: removingMessage.id }); syncHistory([message]); applyEdit(message); notify('消息已删除'); }} onClose={() => setRemovingMessage(null)} />}
    {modal === 'audit' && <AuditDialog onClose={() => setModal(null)} />}
    {openBundle && <BundleDialog message={openBundle} privateMode={privateMode} onPreview={file => { setOpenBundle(null); setPreview(file); }} onClose={() => setOpenBundle(null)} />}
    {mutingUser && <MuteDialog user={mutingUser} onClose={() => setMutingUser(null)} onDone={() => notify(`已禁言「${mutingUser.name}」`)} />}
    {scheduleText !== null && room && <ScheduleDialog room={room} initialText={scheduleText} onClose={() => setScheduleText(null)} onScheduled={when => { notify(`将在 ${when} 发送`); loadScheduled(room.id); }} />}
    {modal === 'scheduled' && <ScheduledListDialog items={scheduled.items} onClose={() => setModal(null)} onCancel={async item => { try { await api('scheduled/cancel', { id: item.id }); await loadScheduled(item.roomId); notify('已取消发送'); } catch (error) { notify(error.message); } }} />}
    {reminding && <ReminderDialog message={reminding} notify={notify} onClose={() => setReminding(null)} />}
    {modal === 'poll' && room && <PollDialog room={room} onClose={() => setModal(null)} onCreated={message => { sticky.current = true; receive(message); }} />}
    {modal === 'saved' && <Modal title="收藏" subtitle="只有你自己看得到。点一条可以回到原来的会话。" onClose={() => setModal(null)}>
      {!saved.length ? <p className="inline-note">还没有收藏。在消息上点右键，选「收藏」。</p> : <div className="history-results saved-list">{saved.map(item => {
        const target = rooms.find(candidate => candidate.id === item.message.roomId);
        return <div className="saved-row" key={item.message.id}><SearchResult message={item.message} term="" avatar={<Avatar user={userMap[item.message.senderId]} size={24} />}
          title={`${userMap[item.message.senderId]?.name || item.message.bot || '成员'}${target ? ` · ${target.name}` : ''}`} privateMode={privateMode} onJump={message => { setModal(null); jumpToMessage(message); }} />
          <IconButton icon={X} label="取消收藏" size={14} onClick={() => toggleSaved(item.message, false)} /></div>;
      })}</div>}
    </Modal>}
    {groupAction?.type === 'webhooks' && room && room.kind !== 'direct' && <WebhooksDialog room={room} notify={notify} onClose={() => setGroupAction(null)} />}
    {groupAction?.type === 'name' && room?.kind === 'group' && <GroupEditDialog room={room} field="name" onClose={() => setGroupAction(null)} onSaved={refresh} />}
    {groupAction?.type === 'announcement' && room?.kind === 'group' && <GroupEditDialog room={room} field="announcement" onClose={() => setGroupAction(null)} onSaved={refresh} />}
    {groupAction?.type === 'remove' && room && <ConfirmDialog title={`把「${groupAction.user.name}」移出「${room.name}」？`} subtitle="移出后对方看不到这个群的新消息，需要重新邀请才能回来。" confirmLabel="移出" busyLabel="正在移出…" danger
      onConfirm={async () => { await api('room-remove', { roomId: room.id, userId: groupAction.user.id }); await refresh(); notify(`已把「${groupAction.user.name}」移出群聊`); }} onClose={() => setGroupAction(null)} />}
    {groupAction?.type === 'transfer' && room && <ConfirmDialog title={`把群主转让给「${groupAction.user.name}」？`} subtitle="转让后，你会变成普通成员，不能再设置管理员和转让群主。" confirmLabel="确认转让" busyLabel="正在转让…"
      onConfirm={async () => { await api('room-owner', { roomId: room.id, userId: groupAction.user.id }); await refresh(); notify('群主已转让'); }} onClose={() => setGroupAction(null)} />}
    {groupAction?.type === 'leave' && room && <ConfirmDialog title={`退出「${room.name}」？`} subtitle={groupOwner === state.me.id ? '你是群主，退出后群主会自动转给最早加入的成员。退出后将看不到这个群的消息。' : '退出后将看不到这个群的消息，需要群里的人重新邀请才能回来。'} confirmLabel="退出群聊" busyLabel="正在退出…" danger
      onConfirm={async () => { await api('room-leave', { roomId: room.id }); setSelected('lobby'); setShowMembers(false); await refresh(); notify('已退出群聊'); }} onClose={() => setGroupAction(null)} />}
    {switcher && <QuickSwitcher rooms={ordered} icon={target => roomIcon(target, 24)} unread={unread} onOpen={id => { setSwitcher(false); openRoom(id); }} onClose={() => setSwitcher(false)} />}
    {forwarding && <ForwardDialog count={forwarding.length} rooms={rooms.filter(target => !target.hidden)} icon={target => roomIcon(target, 32)} onClose={() => setForwarding(null)} onForward={forwardTo} />}
    {editingFolder && <FolderDialog folder={editingFolder === 'new' ? null : editingFolder} rooms={rooms.filter(target => !target.hidden)} icon={target => roomIcon(target, 28)}
      onSave={(name, roomIds) => saveFolder(editingFolder === 'new' ? null : editingFolder, name, roomIds)} onDelete={() => deleteFolder(editingFolder)} onClose={() => setEditingFolder(null)} />}
    {modal === 'status' && <StatusDialog status={activeStatus(userMap[state.me.id])} notify={notify} onClose={() => setModal(null)} />}
    {modal === 'shortcuts' && <ShortcutsDialog sendKey={chatPrefs.sendKey} onClose={() => setModal(null)} />}
    {historyFor && <EditHistoryDialog message={historyFor} onClose={() => setHistoryFor(null)} />}
    {recalling && <RecallDialog message={recalling} onClose={() => setRecalling(null)} onRecalled={message => {
      syncHistory([message]); notify('消息已撤回');
      if (recalling.text?.trim()) { setRecalledTexts(previous => ({ ...previous, [message.id]: { text: recalling.text } })); setTimeout(() => forgetRecalled(message.id), 10 * 60000); }
    }} />}
    {toastElement}
  </div>;
}

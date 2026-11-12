import { copyText } from './mobile/runtime';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, MessagesSquare, Users, Settings2, Search, Plus, Hash, Eye, EyeOff, WifiOff, UserPlus, ChevronLeft, ChevronRight, ArrowDown, ArrowUp, Undo2, X, Check, LoaderCircle, RefreshCw, ShieldCheck, Pin, BellOff, Megaphone, PencilLine, LogOut, Crown, Bot, Images, Bookmark, Clock, CheckCheck, Download, AtSign, FolderPlus, Timer, BookUser, MicOff, Link2, UserCheck, IdCard, MoreHorizontal, CirclePlus } from 'lucide-react';
import { absoluteUrl, api, downloadExport, formatTime, mediaUrl, nativeTitlebar, seenText, uid } from './api';
import { Avatar, IconButton, Logo, Message, Modal, PrivatePreview, ContextMenu, OutboxMessage, ProfileCard, ReadDetail, Skeleton, longPressHandlers, consumeLongPress, pressEvent, nameColor, activeStatus, StatusEmoji, coveredMedia, revealedMedia, BotTag, botStatusText } from './components';
import Onboarding from './Onboarding';
import Account, { AdminDialog, PasswordForm } from './Account';
import Composer from './Composer';
import { ShareTargetDialog, ProfileDialog, RoomAvatarDialog, InviteDialog, GroupDialog, RemoveMemberDialog, RecallDialog, EditHistoryDialog, ForwardDialog, ForwardButtons, ConfirmDialog, GroupEditDialog, WebhooksDialog, AuditDialog, PollDialog, ChainDialog, ChainEntryDialog, ScheduleDialog, ScheduledListDialog, ReminderDialog, MuteDialog, ShortcutsDialog, FolderDialog, StatusDialog, BundleDialog } from './dialogs';
import useUnread from './useUnread';
import useChatSession from './useChatSession';
import useConversations from './useConversations';
import usePinnedDrag from './usePinnedDrag';
import useOutbox from './useOutbox';
import { SettingsDialog } from './Settings';
import { BotsDialog, RoomBotsDialog } from './BotsDialog';
import { syncPush } from './push';
import { useAppLock, LockScreen, finishLockReset } from './AppLock';
import { TextPreviewDialog, openPdf, previewKind } from './FilePreview';
import { pendingShareId, takeShare } from './shareTarget';
import { popoutRoom } from './popout';
import { messageLink, groupInviteLink, plainText } from './markdown';
import { SPOILER_LABEL, quotable, spoilerRanges } from '../shared/preview.js';
import useDesktopBridge from './useDesktopBridge';
import useTheme from './useTheme';
import useSkin from './skin';
import useAppearance from './appearance';
import useChatPrefs from './chatPrefs';
import ImageViewer from './ImageViewer';
import QuickSwitcher from './QuickSwitcher';
import RoomFiles from './RoomFiles';
import ThreadPanel from './ThreadPanel';
import { SELECT_LIMIT } from '../shared/limits.js';
import HistorySearch, { SearchResult, SearchStatus, useMessageSearch } from './HistorySearch';
import { previewText, readStorage } from './history';
import { MobileHome, MobileTabs } from './mobile/MobileHome';
import { mobileClient, chooseServer } from './mobile/session';

const NO_REACTIONS = [];
// 按会话自动删除的几档（秒）。
const AUTO_DELETE_OPTIONS = [[0, '关闭'], [86400, '1 天'], [604800, '1 周'], [2592000, '1 个月']];
const autoDeleteLabel = seconds => AUTO_DELETE_OPTIONS.find(([value]) => value === seconds)?.[1] || '';

// 选中的文字如果都在这条消息的正文里，就作为引用片段（Telegram 式部分引用）；碰到剧透的不算（揭开过也一样），服务端同样会拒绝。
function selectedQuote(message) {
  const quote = selectionIn(message.id);
  return quote && quotable(message.text, quote) ? quote : '';
}
function selectionIn(messageId) {
  const selection = window.getSelection();
  const text = selection?.toString().replace(/\s+/g, ' ').trim();
  if (!text || !selection.rangeCount) return '';
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const element = node.nodeType === 1 ? node : node.parentElement;
  const body = element?.closest('.message-text');
  return body && body.closest('[data-message-id]')?.dataset.messageId === messageId ? text.slice(0, 500) : '';
}

// 复制消息：这位读者还没揭开的剧透复制成 [剧透]，揭开过的照原文复制。揭开状态只在页面上（每段剧透带着 data-range），没显示出来的一律按没揭开算。
function copyableText(message) {
  const ranges = spoilerRanges(message.text);
  if (!ranges.length) return message.text;
  const spans = [...document.querySelectorAll(`[data-message-id="${CSS.escape(message.id)}"] .spoiler[data-range]`)];
  const covered = new Set(spans.filter(span => !span.classList.contains('revealed')).map(span => Number(span.dataset.range)));
  const revealed = new Set(spans.filter(span => span.classList.contains('revealed')).map(span => Number(span.dataset.range)));
  return ranges.reduceRight((text, range) => revealed.has(range.start) && !covered.has(range.start) ? text : text.slice(0, range.start) + SPOILER_LABEL + text.slice(range.end), message.text);
}

// 经典风格的居中时间：今天只写时刻，昨天、一周内写星期，更早的写日期。
function classicTime(at) {
  const date = new Date(at), now = new Date();
  const clock = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const days = Math.round((new Date(now.toDateString()) - new Date(date.toDateString())) / 86400000);
  if (days === 0) return clock;
  if (days === 1) return `昨天 ${clock}`;
  if (days > 1 && days < 7) return `${date.toLocaleDateString('zh-CN', { weekday: 'long' })} ${clock}`;
  return `${date.toLocaleDateString('zh-CN', date.getFullYear() === now.getFullYear() ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' })} ${clock}`;
}

export default function App() {
  const [selected, setSelected] = useState(popoutRoom || 'lobby');
  const [lastRead, setLastRead] = useState(() => readStorage('linliao.read', {}));
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [replying, setReplying] = useState(null);
  const [editing, setEditing] = useState(null);
  const [removingMessage, setRemovingMessage] = useState(null);
  // 只对自己删除：要删的消息标识；清空会话：目标会话。
  const [hiding, setHiding] = useState(null);
  const [clearing, setClearing] = useState(null);
  // 推荐名片：要推荐的成员。
  const [sharingCard, setSharingCard] = useState(null);
  // 触屏上长按会弹出菜单、没法选字：在弹窗里选要引用的那一段。
  const [quoting, setQuoting] = useState(null);
  // 系统分享菜单发来的内容：先选会话，再放进那个会话的输入框。
  const [incomingShare, setIncomingShare] = useState(null);
  const [injectShare, setInjectShare] = useState(null);
  const quoteArea = useRef(null);
  // 文件预览：文本和代码在弹窗里看，PDF 在新标签页打开。
  const [filePreview, setFilePreview] = useState(null);
  // 当前会话的置顶消息；横条依次显示，点一下跳到那条消息并换到下一条。
  const [pins, setPins] = useState({ roomId: null, pins: [], canPin: false });
  const [pinIndex, setPinIndex] = useState(0);
  // 自己收藏的消息：菜单据此显示「收藏 / 取消收藏」，收藏夹弹窗列出全部。
  const [saved, setSaved] = useState([]);
  // 「提到我的」：@我、回复我、回应我的消息，打开时读取，可以继续往前翻。
  const [activity, setActivity] = useState(null);
  async function loadActivity(more = false) {
    const before = more ? activity?.items.at(-1)?.at : undefined;
    try {
      const result = await api(`activity${before ? `?before=${before}` : ''}`);
      setActivity(previous => ({ items: more && previous ? [...previous.items, ...result.items] : result.items, hasMore: result.hasMore }));
    } catch (error) { notify(error.message); setActivity(previous => previous || { items: [], hasMore: false }); }
  }
  useEffect(() => { if (modal === 'activity') loadActivity(); }, [modal]);
  // 当前会话里自己还没发出的定时消息、正在设置提醒的消息。
  const [scheduled, setScheduled] = useState({ roomId: null, items: [] });
  const [scheduleText, setScheduleText] = useState(null);
  // 打开着的话题（根消息标识），显示在右侧面板。
  const [threadRoot, setThreadRoot] = useState(null);
  // 话题面板里正在编辑的回复，以及面板当前加载的消息（右键菜单据此找到话题里的消息）。
  const [threadEditing, setThreadEditing] = useState(null);
  const threadMessages = useRef([]);
  useEffect(() => setThreadEditing(null), [threadRoot]);
  const [mutingUser, setMutingUser] = useState(null);
  const [openBundle, setOpenBundle] = useState(null);
  const [reminding, setReminding] = useState(null);
  // 阅后即焚模式：{ 会话标识: 秒数 }，只在内存里。开着时这个私聊里发出去的都是阅后即焚（输入框、表情、通知里的回复）；
  // 发不成阅后即焚的操作（投票、定时发送、推荐名片、拍一拍、转发进来、在话题里回复）一律拦下并说明原因，不会悄悄发成普通消息。
  const [burnModes, setBurnModes] = useState({});
  const burnBlocked = (roomId, what) => { if (!burnModes[roomId]) return false; notify(`阅后即焚开着，不能${what}；先关掉输入框上方的阅后即焚`); return true; };
  // 正在接龙（或修改自己那一行）的接龙消息：{ roomId, id }，弹窗里按最新的名单显示。
  const [chainEntry, setChainEntry] = useState(null);
  const [reactingTo, setReactingTo] = useState(null);
  const [selection, setSelection] = useState(null);
  const selectAnchor = useRef(null);
  const [forwarding, setForwarding] = useState(null);
  const [forwardMerge, setForwardMerge] = useState(false);
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
  // 从合并转发的聊天记录里看图时，左右切换的范围是那份记录里的图片。
  const [previewImages, setPreviewImages] = useState(null);
  const [toast, setToast] = useState('');
  const [scrolledUp, setScrolledUp] = useState(false);
  // 「N 条新消息」的起点，按会话各记一份：离开底部那一刻已加载的最新一条。之后别人发来的（seq 更大的）才算；
  // 回到底部就删掉。只看这个会话自己的消息，不受其他会话、往前翻页的影响；切走再回来也接着算。
  const awayFrom = useRef(new Map());
  const [unreadAnchor, setUnreadAnchor] = useState(null);
  const [mobileChat, setMobileChat] = useState(Boolean(popoutRoom));
  const [mobileTab, setMobileTab] = useState('chats');
  const [theme, setTheme] = useTheme();
  const [skin, setSkin] = useSkin();
  // 经典风格：熟悉的三栏聊天布局（左侧导航栏、按时间排的会话列表、每条消息带头像、居中时间）。
  const classic = skin === 'classic';
  const [appearance, setAppearance] = useAppearance(skin);
  const [chatPrefs, setChatPrefs] = useChatPrefs();
  const [update, setUpdate] = useState(null);
  const toastTimer = useRef();
  const messageList = useRef();
  const messageContent = useRef();
  const sticky = useRef(true);
  const firstLoad = useRef(true);
  // 每个会话离开时看到哪里：可视区最上面那条消息和它离顶部的距离（只在内存里，停在底部时不记）。
  // 记消息而不记 scrollTop：图片加载、新消息进来都会改变高度。
  const scrollSpots = useRef(new Map());
  // 切回往上翻过的会话时要找回的位置；找到之前的滚动是换会话造成的，不算用户在滚。
  const pendingSpot = useRef(null);
  // 恢复（或返回）到某个位置之后，用户还没自己滚动时，上方内容变高（图片解码、「查看更早的消息」替换欢迎语）就重新对齐到这条消息。
  // 不依赖浏览器的滚动锚定：WKWebView 没有这项功能，Chromium 在切换会话的淡入动画期间也会暂停它。
  const pinnedSpot = useRef(null);
  // 最近一次由代码对齐后的 scrollTop：滚动事件到达时还是这个值，说明不是用户在滚。
  const spotTop = useRef(null);
  const shownRoom = useRef(null);
  // 点引用、链接、置顶、搜索结果等跳走之前的位置：右下角「返回原位置」回到这里。连续跳转只记第一次离开的地方。
  const [returnSpot, setReturnSpot] = useState(null);
  // 由跳转（或返回）切过去的会话：不算用户自己换会话，不收起「返回原位置」。
  const jumpSwitch = useRef(null);
  // 跳转的平滑滚动停下之前，滚到底不算用户自己滚的。
  const jumpSettle = useRef(0);
  const settleTimer = useRef(0);
  // 每次跳转一个编号：跳转要等加载和两帧渲染，期间点了「返回原位置」或又跳了别处，这次跳转就作废，不再滚过去。
  const jumpRun = useRef(0);
  const longPress = useRef({ timer: 0, fired: false });
  const notify = useCallback(text => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3500); }, []);
  useEffect(() => {
    // 阅后即焚的内容不进文件预览、不在新标签页打开（只能发图片和视频，这里再挡一次）。
    const open = event => { const file = event.detail; if (file?.burnId) return; if (previewKind(file) === 'pdf') openPdf(file, notify); else if (previewKind(file) === 'text') setFilePreview(file); };
    window.addEventListener('linliao:open-file', open);
    return () => window.removeEventListener('linliao:open-file', open);
  }, [notify]);
  useEffect(() => () => { clearTimeout(toastTimer.current); clearTimeout(settleTimer.current); }, []);
  useEffect(() => {
    const receiveNotice = event => notify(event.detail);
    window.addEventListener('linliao:notice', receiveNotice);
    return () => window.removeEventListener('linliao:notice', receiveNotice);
  }, [notify]);
  // 右侧面板是浮层：在聊天区、会话列表、导航栏里点面板以外的地方就关掉。
  // 面板自己、打开面板的按钮，以及从面板里弹出的对话框、菜单、资料卡不算「外面」。
  useEffect(() => {
    if (!showMembers) return;
    const dismiss = event => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('.members-panel, .member-count, dialog, [role="menu"], .profile-card, .read-detail')) return;
      if (target.closest('.chat-main, .sidebar, .classic-rail')) setShowMembers(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [showMembers]);
  useEffect(() => {
    const back = event => {
      const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
      if (dialog) { event.preventDefault(); dialog.dispatchEvent(new Event('cancel', { cancelable: true })); return; }
      if (document.querySelector('[role="menu"], .emoji-picker')) { event.preventDefault(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return; }
      const closers = [[contextMenu, () => setContextMenu(null)], [profileCard, () => setProfileCard(null)], [readDetail, () => setReadDetail(null)], [reactingTo, () => setReactingTo(null)], [selection, () => setSelection(null)], [showMembers, () => setShowMembers(false)], [mobileChat, () => setMobileChat(false)], [mobileTab !== 'chats', () => setMobileTab('chats')]];
      const current = closers.find(([open]) => open);
      if (current) { event.preventDefault(); current[1](); }
    };
    window.addEventListener('linliao:back', back);
    return () => window.removeEventListener('linliao:back', back);
  }, [contextMenu, profileCard, readDetail, reactingTo, selection, showMembers, mobileChat, mobileTab]);
  const replyFromNotification = useRef(() => {});
  const { privateMode, privacyRef, changePrivacy, windowActive } = useDesktopBridge({ notify, onPendingRoom: openRoom,
    onOpenRoom: roomId => { openRoom(roomId); setModal(null); setSearch(''); }, onReply: (roomId, text, userId) => replyFromNotification.current(roomId, text, userId) });
  // 应用锁：锁着时整个界面不可操作，通知也按隐私模式只显示「新消息」。
  const appLock = useAppLock();
  const lockedRef = useRef(false);
  lockedRef.current = appLock.locked;
  const noticePrivacy = useMemo(() => ({ get current() { return privacyRef.current || lockedRef.current; } }), [privacyRef]);
  const closeReadDetail = useCallback(() => setReadDetail(null), []);
  const onHistoryChanged = useCallback(({ cleared }) => {
    if (cleared) { setScrolledUp(false); sticky.current = true; scrollSpots.current.clear(); awayFrom.current.clear(); pendingSpot.current = null; }
    setPreview(null); setContextMenu(null); setRecalling(null); setReadDetail(null);
  }, []);
  // 免打扰只在本机生效，与置顶一样保存在会话偏好里；不弹通知，也不计入菜单栏和托盘的未读数。
  const mutedRooms = useRef(new Set());
  const { bootstrap, state, startupError, start, refresh, logout, loggingOut, messages, hasMore, loading, connected, historyVersion,
    syncHistory, receive, markMessageRead, loadOlder: fetchOlder, loadThrough, updateMe, applyReactions, applyEdit, typing, sendTyping, pinsVersion, savedVersion, applyPoll, applyChain, threadTick, applyNote, applyFolders, applyKeywords, applyPhrases, hideLocally, burnContents, openBurn } = useChatSession({ selected, notify, privacyRef: noticePrivacy, mutedRef: mutedRooms, onHistoryChanged });
  const { rooms: conversations, scope: conversationScope, restore: restoreConversation, act: conversationAction, reorder: reorderPinned } =
    useConversations({ state, spaceId: bootstrap?.spaceId, selected, onSelect: setSelected, notify });
  const pinnedDrag = usePinnedDrag(ids => reorderPinned(ids, conversationScope));
  // macOS 通知里直接回复：和输入框发的一样进发件箱（断网时连上后自动重发，失败的留在会话里可重试），不打开窗口。
  // 没发出去不能悄无声息：另弹一条系统通知说明原因，窗口下次出现时再用提示条说一次。
  // 还没送达的通知回复：clientId → 是否已经提醒过「还没发出」。送达或确定失败才不再跟踪，暂时失败后最终失败也要报。
  const notificationReplies = useRef(new Map());
  const pendingReplyNotice = useRef('');
  const windowActiveRef = useRef(windowActive);
  windowActiveRef.current = windowActive;
  const replyNotice = (roomId, title, reason) => {
    window.desktop?.message?.({ id: `reply-notice:${uid()}`, roomId, title, body: reason.slice(0, 240), notice: true }).catch(() => {});
    if (windowActiveRef.current) notify(`${title}：${reason}`); else pendingReplyNotice.current = `${title}：${reason}`;
  };
  const outbox = useOutbox({ storageKey: conversationScope && `linliao.outbox:${conversationScope}`, connected: connected && !loggingOut,
    onSent: message => { notificationReplies.current.delete(message.clientId); receive(message); },
    onFailed: (item, reason, final) => {
      const tracked = notificationReplies.current;
      if (!tracked.has(item.clientId)) return;
      if (final) { tracked.delete(item.clientId); replyNotice(item.roomId, '回复没有发出', reason); return; }
      if (tracked.get(item.clientId)) return;
      tracked.set(item.clientId, true);
      replyNotice(item.roomId, '回复还没发出', '连接恢复后会自动发送');
    } });
  replyFromNotification.current = (roomId, text, userId) => {
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body) return;
    // 通知是另一个账号登录时弹的（期间退出换了人）：不能以现在的身份替前一个人回复。
    if (!state?.me || !userId || userId !== state.me.id) return replyNotice(roomId, '回复没有发出', '这条提醒属于之前登录的账号');
    // 应用锁着时不替人发言：通知可能是锁定之前弹出的。
    if (lockedRef.current) return replyNotice(roomId, '回复没有发出', '虾扯蛋已锁定，解锁后请在会话里重新发送');
    if (!state?.me || !state.rooms.some(target => target.id === roomId)) return replyNotice(roomId, '回复没有发出', '你已不在这个会话里');
    if (body.length > 10000) return replyNotice(roomId, '回复没有发出', '每条消息最多 10000 个字符');
    const clientId = uid();
    const offline = !(connected && !loggingOut);
    notificationReplies.current.set(clientId, offline);
    // 这个私聊开着阅后即焚时，通知里的回复同样是阅后即焚。
    const burn = burnModes[roomId] || 0;
    outbox.send({ roomId, text: body, clientId, ...(burn ? { burn } : {}) }, { text: body, files: [] });
    if (offline) replyNotice(roomId, '回复还没发出', '现在没有连上服务器，连接恢复后会自动发送');
  };
  useEffect(() => {
    if (!windowActive || !pendingReplyNotice.current) return;
    notify(pendingReplyNotice.current);
    pendingReplyNotice.current = '';
  }, [windowActive, notify]);
  mutedRooms.current = new Set(conversations.filter(room => room.muted).map(room => room.id));
  // 手机推送按这台设备的免打扰和隐私模式过滤：变化后同步给服务端。
  const mutedKey = [...mutedRooms.current].sort().join(',');
  useEffect(() => { if (bootstrap) finishLockReset(Boolean(state?.me), appLock); }, [bootstrap, state?.me?.id]);
  useEffect(() => {
    const id = state?.me?.id && pendingShareId();
    if (!id) return;
    history.replaceState(null, '', location.pathname + location.hash);
    takeShare(id).then(share => { if (share && (share.text || share.files.length)) setIncomingShare(share); else if (share) notify('没有可以发送的内容'); }).catch(() => notify('读取分享的内容失败'));
  }, [state?.me?.id]);
  useEffect(() => { if (state?.me?.id) syncPush({ muted: mutedKey ? mutedKey.split(',') : [], private: privateMode }).catch(() => {}); }, [state?.me?.id, mutedKey, privateMode]);
  const messageContext = useRef();
  messageContext.current = { scope: conversationScope, messages, privateMode };
  useEffect(() => { scrollSpots.current.clear(); awayFrom.current.clear(); }, [state?.me.id]);
  useEffect(() => {
    if (!state?.me.id) return;
    // 离开时停在底部（比如刚发完消息还没来得及触发滚动）就不记位置。
    if (sticky.current && shownRoom.current) scrollSpots.current.delete(shownRoom.current);
    shownRoom.current = selected;
    if (jumpSwitch.current !== selected) setReturnSpot(null);
    jumpSwitch.current = null;
    // 回到往上翻过的会话：先不当作在底部，等消息出来再定位，免得把下面没看的消息标成已读。
    const spot = scrollSpots.current.get(selected);
    pendingSpot.current = spot ? { roomId: selected, ...spot } : null;
    // 没有要恢复的位置，进来就停在底部：之前的计数起点作废。
    if (!spot) awayFrom.current.delete(selected);
    pinnedSpot.current = null;
    // 揭开过的剧透图在换会话后重新遮住，和文字一样。
    revealedMedia.clear();
    firstLoad.current = true; sticky.current = !spot; setScrolledUp(Boolean(spot));
    setContextMenu(null); setReadDetail(null); setPreview(null);
    // 切换会话时消息区淡入；系统要求减少动效时不做。
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) messageContent.current?.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }, [selected, state?.me.id]);
  const currentMessages = messages[selected] || [];
  const overSelected = (selection?.length || 0) > SELECT_LIMIT;
  // 正在回复的消息以最新状态为准：被撤回或清空后自动取消。
  // 正在编辑的消息同样以最新状态为准；按 ↑ 编辑自己最近一条还能编辑的消息。
  const editTarget = editing?.roomId === selected ? currentMessages.find(message => message.id === editing.id && !message.recalledAt) || null : null;
  const lastOwn = state?.me ? currentMessages.findLast(message => message.senderId === state.me.id && !message.recalledAt && !message.chain && !message.burn) : null;
  const replyMessage = replying?.roomId === selected ? currentMessages.find(message => message.id === replying.id && !message.recalledAt) || null : null;
  const replyTarget = replyMessage && replying.quote ? { ...replyMessage, quote: replying.quote } : replyMessage;
  const lastSeq = currentMessages.at(-1)?.seq;
  // 隐私模式下游标只推进到第一条还没看过的他人消息之前，未读角标与已读回执一致。
  // 悬停显示本身说明用户在看，因此隐私模式不再要求窗口处于激活状态。
  const unseen = privateMode && currentMessages.find(message => message.senderId !== state?.me.id && !message.recalledAt && Array.isArray(message.readBy) && !message.readBy.includes(state?.me.id));
  const readUpTo = unseen ? unseen.seq - 1 : lastSeq;
  const unread = useUnread(state, messages, lastRead, connected, historyVersion);
  const awayBase = scrolledUp ? awayFrom.current.get(selected) : undefined;
  const arrivedWhileAway = awayBase === undefined ? 0 : currentMessages.filter(message => message.seq > awayBase && message.senderId !== state?.me.id && !message.recalledAt && !message.notice).length;
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
    const spot = pendingSpot.current;
    let restored = false;
    if (spot?.roomId === selected) {
      // 这一轮的 scrolledUp 可能还是上一个会话的值：刚定位完不推进已读位置，之后由真实的滚动位置决定。
      if (scrollToSpot(spot)) { pendingSpot.current = null; pinnedSpot.current = spot; firstLoad.current = false; restored = true; }
      else if (!currentMessages.length) return;
      // 那条消息已经不在（被删除、清空，或不在已加载的范围里）：照常回到最新消息。
      else { pendingSpot.current = null; scrollSpots.current.delete(selected); awayFrom.current.delete(selected); sticky.current = true; setScrolledUp(false); }
    }
    if (firstLoad.current || sticky.current) { messageList.current.scrollTop = messageList.current.scrollHeight; firstLoad.current = false; }
    if (!restored && readUpTo && (windowActive || privateMode) && !scrolledUp && !modal && !preview) setLastRead(previous => readUpTo > (previous[selected] || 0) ? { ...previous, [selected]: readUpTo } : previous);
  }, [selected, lastSeq, readUpTo, loading, privateMode, windowActive, scrolledUp, modal, preview]);
  // 图片加载、已读回执等让内容变高，或输入区变高让列表变矮（经典风格）时，仍停在最新消息处。
  useEffect(() => {
    const list = messageList.current, content = messageContent.current;
    if (!list || !content) return;
    const observer = new ResizeObserver(() => { if (sticky.current) list.scrollTop = list.scrollHeight; else if (pinnedSpot.current) scrollToSpot(pinnedSpot.current); });
    observer.observe(content);
    observer.observe(list);
    // 用户自己动手（滚轮、触摸、按住滚动条、翻页键）就不再把之后的滚动当作跳转动画的余波。
    const takeOver = event => { if (event.type === 'keydown' && !['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) return; if (jumpSettle.current) { jumpSettle.current = 0; clearTimeout(settleTimer.current); } };
    const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    for (const type of inputs) list.addEventListener(type, takeOver, { passive: true });
    window.addEventListener('keydown', takeOver);
    return () => { observer.disconnect(); for (const type of inputs) list.removeEventListener(type, takeOver); window.removeEventListener('keydown', takeOver); };
  }, [state?.me.id, state?.rooms.length]);
  // 浮动按钮（回到最新消息、@、返回原位置）贴着输入区上沿放。输入区高度会变（多行、回复条，经典风格还在文档流里），
  // 所以量出它离聊天区底部多高、压住滚动区多少，写成 CSS 变量，不写死偏移。
  const composerWatch = useRef({});
  useEffect(() => {
    const list = messageList.current, column = list?.parentElement;
    const bottom = column?.querySelector(':scope > .composer-area, :scope > .selection-bar, :scope > .muted-notice');
    if (composerWatch.current.bottom === bottom && composerWatch.current.column === column) return;
    composerWatch.current.observer?.disconnect();
    composerWatch.current = { bottom, column };
    if (!bottom) return;
    const measure = () => {
      const top = bottom.getBoundingClientRect().top;
      column.style.setProperty('--composer-top', `${Math.round(column.getBoundingClientRect().bottom - top)}px`);
      column.style.setProperty('--composer-overlap', `${Math.max(0, Math.round(list.getBoundingClientRect().bottom - top))}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(bottom); observer.observe(column);
    composerWatch.current.observer = observer;
  });
  useEffect(() => () => composerWatch.current.observer?.disconnect(), []);
  // 菜单栏与 Dock 角标显示未读消息数，和会话列表一致；免打扰的会话不算，被 @ 时只算 1 条。
  const unreadList = loggingOut ? [] : conversations.filter(room => !room.hidden && (!room.muted || unread[room.id]?.mentioned) && (unread[room.id]?.hasUnread || room.markedUnread));
  const unreadRooms = JSON.stringify(unreadList.map(room => room.id));
  const unreadCount = unreadList.reduce((total, room) => total + (room.muted ? 1 : Math.max(1, unread[room.id]?.count || 0)), 0);
  useEffect(() => {
    window.desktop?.activity?.({ currentRoomId: state?.me.id && !loggingOut ? selected : null, unreadRooms: JSON.parse(unreadRooms), unreadCount }).catch(error => notify(error.message));
  }, [unreadRooms, unreadCount, selected, state?.me.id, loggingOut, notify]);
  useEffect(() => { localStorage.setItem('linliao.read', JSON.stringify(lastRead)); }, [lastRead]);
  useEffect(() => { localStorage.setItem('linliao.sidebarWidth', JSON.stringify(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => { localStorage.setItem('linliao.announcements', JSON.stringify(dismissedNotices)); }, [dismissedNotices]);
  useEffect(() => { if (privateMode) setPreview(null); }, [privateMode]);
  // 正在看的阅后即焚图片：消息销毁、撤回、到点或内容被清掉后立即关掉看图窗口。
  useEffect(() => {
    if (!preview?.burnId) return;
    const message = Object.values(messages).flat().find(item => item.id === preview.burnId);
    const files = message?.senderId === state?.me.id ? message.attachments : burnContents[preview.burnId]?.attachments;
    if (!message || message.recalledAt || message.burn?.destroyedAt || !files?.some(file => file.id === preview.id)) setPreview(null);
  }, [preview, messages, burnContents, state?.me.id]);
  useEffect(() => { if (filePreview?.burnId) setFilePreview(null); }, [filePreview]);
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
    // 看图窗口自己处理 Esc（cancel 事件）；这里再关一次会让 Esc 落到下面的对话框上，把聊天记录也关掉。
    const onKey = event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // 阅读位置：可视区里第一条从顶边以下开始的消息，和它离滚动区顶部的距离；行按顺序排列，二分查找。
  // 不用露出一半的那一行：它自己可能还在变高（图片没加载完、加了回应），按它的上沿恢复，下面的内容就会整体错开。
  // 和 Chromium 选滚动锚点的方式一致；一条消息高过整屏、没有从顶边以下开始的行时，退回到跨过顶边的那一行。
  // 扣掉切换会话时消息列表淡入的位移（transform），量到的是静止时的位置。
  const listShift = () => { const transform = messageContent.current ? getComputedStyle(messageContent.current).transform : 'none'; return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42; };
  function readingSpot() {
    const list = messageList.current, rows = list?.querySelectorAll('[data-message-id]');
    if (!rows?.length) return null;
    const box = list.getBoundingClientRect(), shift = listShift(), topOf = row => row.getBoundingClientRect().top - shift;
    let low = 0, high = rows.length;
    while (low < high) { const middle = (low + high) >> 1; if (topOf(rows[middle]) >= box.top) high = middle; else low = middle + 1; }
    const index = low < rows.length && topOf(rows[low]) < box.bottom ? low : Math.max(0, low - 1);
    return { id: rows[index].dataset.messageId, offset: topOf(rows[index]) - box.top };
  }
  // 对齐着的那条消息现在离顶部多远（找不到时为 null）。
  function spotOffset(spot) {
    const list = messageList.current, row = list?.querySelector(`[data-message-id="${CSS.escape(spot.id)}"]`);
    return row ? row.getBoundingClientRect().top - listShift() - list.getBoundingClientRect().top : null;
  }
  function scrollToSpot(spot) {
    const offset = spotOffset(spot);
    if (offset === null) return false;
    messageList.current.scrollTop += offset - spot.offset;
    spotTop.current = messageList.current.scrollTop;
    return true;
  }
  function onMessageScroll(event) {
    if (pendingSpot.current?.roomId === selected) return;
    const node = event.currentTarget;
    // 跳转的平滑滚动每帧都会触发滚动事件。从底部出发时头几帧还在底部附近，这时不能当作「停在底部」：
    // 否则这时完成的加载、解码完的图片会把列表拉回底部，打断这次跳转。停下 200 毫秒后再按实际位置判断；用户一动手就提前结束（见下方的输入监听）。
    const now = performance.now(), settling = now < jumpSettle.current && jumpSettle.current !== Infinity;
    // 重新对齐、浏览器自己的滚动锚定都让对齐的那条消息留在原处；它移动了才说明是用户自己在滚，不再对齐。
    // 不能重新挑一遍阅读位置来比较：上方图片还没撑开时挑出来的行不同，会把这些滚动误当成用户滚动。
    // 例外是跳转的平滑滚动还没停的时候点了「返回原位置」：Chromium 在立即定位之后还会再走一步动画，那不是用户在滚，拉回来。
    // 滚动位置还是代码刚设的值、那条消息却移动了，是上方内容在这一帧里变高（比如刚加载出来的图片解码完，滚动事件先于 ResizeObserver 到达），同样拉回。
    if (pinnedSpot.current) {
      const offset = spotOffset(pinnedSpot.current);
      const moved = offset !== null && Math.abs(offset - pinnedSpot.current.offset) > 2;
      if (moved && settling) { scrollToSpot(pinnedSpot.current); jumpSettle.current = now + 200; clearTimeout(settleTimer.current); settleTimer.current = setTimeout(settleJump, 200); return; }
      if (moved && Math.abs(node.scrollTop - spotTop.current) < 1) { scrollToSpot(pinnedSpot.current); return; }
      if (offset === null || moved) pinnedSpot.current = null; else spotTop.current = node.scrollTop;
    }
    sticky.current = !settling && node.scrollHeight - node.scrollTop - node.clientHeight < 100; setScrolledUp(!sticky.current); checkUnreadAnchor();
    if (sticky.current) scrollSpots.current.delete(selected);
    else { const spot = readingSpot(); if (spot) scrollSpots.current.set(selected, spot); }
    if (sticky.current) awayFrom.current.delete(selected); else if (!awayFrom.current.has(selected)) awayFrom.current.set(selected, lastSeq ?? 0);
    // 跳转造成的滚动停下之后，用户自己滚到底才收起「返回原位置」。
    if (settling) { jumpSettle.current = now + 200; clearTimeout(settleTimer.current); settleTimer.current = setTimeout(settleJump, 200); }
    else if (now >= jumpSettle.current && sticky.current) setReturnSpot(null);
  }
  function settleJump() {
    jumpSettle.current = 0;
    const list = messageList.current;
    if (!list) return;
    sticky.current = list.scrollHeight - list.scrollTop - list.clientHeight < 100; setScrolledUp(!sticky.current);
    if (sticky.current && shownRoom.current) { scrollSpots.current.delete(shownRoom.current); awayFrom.current.delete(shownRoom.current); }
  }
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
    const run = ++jumpRun.current;
    // 跳走前在哪里：停在底部时只记会话；已经记着（连续跳转）就保留第一次的。
    const origin = pendingSpot.current?.roomId === selected ? { ...pendingSpot.current } : { roomId: selected, ...(sticky.current ? {} : readingSpot()) };
    const keepOrigin = () => setReturnSpot(previous => previous || origin);
    pinnedSpot.current = null;
    // 手机布局下可能是从会话列表点进来的（搜索结果、提到我的、收藏、通知里的消息链接），目标就在当前会话时也要打开聊天区。
    setMobileChat(true);
    if (target.threadOf) { if (target.roomId !== selected) { keepOrigin(); jumpSwitch.current = target.roomId; setSelected(target.roomId); } openThread(target.threadOf); return; }
    jumpSettle.current = Infinity;
    // 跳到另一个会话：那里记着的阅读位置不再恢复，免得盖过这次定位。
    if (target.roomId !== selected) { keepOrigin(); scrollSpots.current.delete(target.roomId); jumpSwitch.current = target.roomId; setSelected(target.roomId); setReadDetail(null); }
    try { await loadThrough(target.roomId, target.seq); } catch (error) { if (run !== jumpRun.current) return; jumpSettle.current = 0; return notify(error.message); }
    if (run !== jumpRun.current) return;
    // 先让「返回原位置」出现，列表底部为它留的空带在滚动之前就到位，跳到最后一条时也不会被按钮压住。
    keepOrigin();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (run !== jumpRun.current) return;
    const row = messageList.current?.querySelector(`[data-message-id="${CSS.escape(target.id)}"]`);
    if (!row) { jumpSettle.current = 0; if (target.roomId === origin.roomId) setReturnSpot(previous => previous === origin ? null : previous); return notify('这条消息已不在聊天记录中'); }
    // 切换会话时的"首次加载滚到底部"不能覆盖这次定位。
    sticky.current = false; firstLoad.current = false;
    jumpSettle.current = performance.now() + 400;
    clearTimeout(settleTimer.current); settleTimer.current = setTimeout(settleJump, 400);
    // 系统要求减少动效时直接跳过去（CSS 的 scroll-behavior 管不到脚本里写明的 smooth）。
    row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    if (matchMedia('(max-width: 760px)').matches) setShowMembers(false);
  }
  // 多选：点一下切换这一条；Shift 点击或长按是连选，从上一次点的那条到这一条（含两端）都选上，
  // 跳过撤回、拍一拍这些本来就不能选的行；选满上限就停下，免得一下子把整段历史都选上。
  function selectMessage(target, range) {
    // 阅后即焚消息不能多选（不能转发，删除走单条菜单）。
    if (target.burn) return;
    const anchor = selectAnchor.current;
    selectAnchor.current = target.id;
    if (!range) return setSelection(previous => previous.includes(target.id) ? previous.filter(id => id !== target.id) : [...previous, target.id]);
    const from = currentMessages.findIndex(message => message.id === anchor), to = currentMessages.findIndex(message => message.id === target.id);
    // 从起点往这一条的方向选，到上限时留下的是离起点近的那些。
    const span = from < 0 || to < 0 ? [target] : from <= to ? currentMessages.slice(from, to + 1) : currentMessages.slice(to, from + 1).reverse();
    const next = [...(selection || [])], chosen = new Set(next);
    for (const message of span) {
      if (message.recalledAt || message.nudge || message.burn || chosen.has(message.id)) continue;
      if (next.length >= SELECT_LIMIT) { notify(`一次最多选 ${SELECT_LIMIT} 条，后面的没有选上`); break; }
      next.push(message.id); chosen.add(message.id);
    }
    setSelection(next);
  }
  // 逐个会话转发；有失败的会话时报出来，成功的照常完成。
  async function forwardTo(targets, merge = false, comment = '') {
    const failed = [];
    let skipped = 0;
    for (const target of targets) {
      if (burnModes[target.id]) { failed.push(`「${target.name}」开着阅后即焚，不能转发进去`); continue; }
      try {
        const result = await api('forward', { roomId: target.id, messageIds: forwarding, merge });
        skipped = result.skipped || 0;
        if (target.id === selected) for (const message of result.messages) receive(message);
        // 附言作为一条普通消息，跟在转发的内容之后。
        if (comment) {
          try { const { message } = await api('messages', { roomId: target.id, text: comment, clientId: uid() }); if (target.id === selected) receive(message); }
          catch (error) { failed.push(`「${target.name}」的附言没有发出：${error.message}`); }
        }
      } catch (error) { failed.push(`「${target.name}」：${error.message}`); }
    }
    setSelection(null);
    await refresh();
    const done = targets.length - failed.filter(item => !item.includes('的附言')).length;
    if (failed.length && !done) throw new Error(failed.join('；'));
    const skippedNote = skipped ? `，跳过了 ${skipped} 条不能转发的消息（名片、拍一拍或已撤回）` : '';
    notify((failed.length ? `已转发到 ${done} 个会话；${failed.join('；')}` : targets.length === 1 ? `已转发到「${targets[0].name}」` : `已转发到 ${targets.length} 个会话`) + skippedNote);
  }
  async function votePoll(message, options) {
    try { applyPoll(await api('polls/vote', { messageId: message.id, options })); }
    catch (error) { notify(error.message); }
  }
  async function closePoll(message) {
    try { applyPoll(await api('polls/close', { messageId: message.id })); notify('投票已结束'); }
    catch (error) { notify(error.message); }
  }
  // 点开阅后即焚消息：失败（比如已经被撤回、自己删掉了）只提示，内容拿不到就还是遮住的。
  async function openBurnMessage(message) {
    try { await openBurn(message); }
    catch (error) { notify(error.message); }
  }
  async function closeChain(message) {
    try { applyChain(await api('chains/close', { messageId: message.id })); notify('接龙已结束'); }
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
    const link = absoluteUrl(`/#join-group=${encodeURIComponent(room.id)}.${token}`);
    try { await copyText(link); notify(message); } catch (error) { notify(error.message); }
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
    if (burnBlocked(selected, '拍一拍')) return;
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
    setSelected(id); setMobileChat(true); setReadDetail(null); setContextMenu(null); setPanelView('members'); setShowMembers(false);
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
  // 桌面端：会话在独立窗口里打开（再点一次会切到已经打开的那个窗口）。
  function openRoomWindow(target) {
    window.desktop?.openRoomWindow?.(target.id, target.name).catch(error => notify(error.message));
  }
  // 把会话从侧栏拖到窗口外面松开，也是在独立窗口打开。
  function dragOut(event, target) {
    if (!window.desktop?.openRoomWindow || event.pointerType !== 'mouse' || event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY }, node = event.currentTarget;
    try { node.setPointerCapture(event.pointerId); } catch {}
    const up = upEvent => {
      node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', cancel);
      const outside = upEvent.clientX < 0 || upEvent.clientY < 0 || upEvent.clientX >= innerWidth || upEvent.clientY >= innerHeight;
      if (outside && Math.hypot(upEvent.clientX - start.x, upEvent.clientY - start.y) > 40) openRoomWindow(target);
    };
    const cancel = () => { node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', cancel); };
    node.addEventListener('pointerup', up); node.addEventListener('pointercancel', cancel);
  }
  function conversationMenu(event, target) {
    const pin = target.pinned ? 'unpin' : 'pin';
    const mute = target.muted ? 'unmute' : 'mute';
    const unreadNow = Boolean(unread[target.id]?.hasUnread || target.markedUnread);
    const canPopout = Boolean(window.desktop?.openRoomWindow);
    showContextMenu(event, { kind: 'conversation', pinned: target.pinned, muted: target.muted, unread: unreadNow, canClear: true, canPopout }, [
      ...(canPopout ? [{ id: 'popout', label: '在独立窗口打开', action: () => openRoomWindow(target) }] : []),
      { id: unreadNow ? 'read' : 'unread', label: unreadNow ? '标为已读' : '标为未读', action: () => unreadNow ? markRead(target) : conversationAction('mark-unread', target.id, conversationScope) },
      { id: pin, label: target.pinned ? '取消置顶' : '置顶对话', action: () => conversationAction(pin, target.id, conversationScope) },
      { id: mute, label: target.muted ? '取消免打扰' : '消息免打扰', action: () => conversationAction(mute, target.id, conversationScope) },
      { id: 'export', label: '导出聊天记录', action: () => downloadExport(target.id) },
      { id: 'clear', label: '清空聊天记录（仅自己）', action: () => setClearing(target) },
      { id: 'remove', label: '移除对话', action: () => conversationAction('remove', target.id, conversationScope) },
    ], '对话操作');
  }
  // 把消息里的图片收藏成自己的表情（相册里的每张都加）。
  async function addStickers(message) {
    const images = message.attachments.filter(file => /^image\/(png|jpeg|webp|gif)$/.test(file.mime));
    try { for (const file of images) await api('stickers', { fileId: file.id }); notify(images.length > 1 ? `已添加 ${images.length} 个表情` : '已添加到表情'); }
    catch (error) { notify(error.message); }
  }
  function messageMenu(event, message) {
    if (message.burn && !message.recalledAt) return burnMenu(event, message);
    const canCopy = Boolean(message.text) && !privateMode;
    const own = message.senderId === state.me.id && !message.recalledAt;
    // 管理者设了撤回时限时，超时的消息不再显示「撤回」；编辑不受影响。
    const recallWindow = state.workspace.recallWindow || 0;
    const canRecall = own && (!recallWindow || Date.now() - message.createdAt <= recallWindow * 1000);
    const canReply = !message.recalledAt && !message.nudge && !message.notice;
    // 话题里的回复不在主时间线上：不能在主输入框回复、多选或置顶。
    const inThread = Boolean(message.threadOf);
    const quote = canReply && !inThread && !privateMode ? selectedQuote(message) : '';
    const canReact = canReply && Boolean(state.reactions?.length);
    const canEdit = own && !message.poll && !message.chain && !message.nudge && !message.card;
    const manager = state.workspace.mode === 'cloud' ? ['admin', 'super_admin'].includes(state.me.role) : state.workspace.ownerId === state.me.id;
    const canRemove = manager && message.senderId !== state.me.id && !message.recalledAt;
    const canPin = !inThread && pins.roomId === message.roomId && pins.canPin && !message.recalledAt && !message.nudge && !message.notice;
    const pinned = pins.pins.some(item => item.message.id === message.id);
    const isSaved = saved.some(item => item.message.id === message.id);
    const act = action => {
      const current = messageContext.current;
      if (current.scope !== conversationScope) return;
      const latest = current.messages[message.roomId]?.find(item => item.id === message.id) || threadMessages.current.find(item => item.id === message.id);
      if (!latest || latest.recalledAt) return;
      if (action === 'recall') setRecalling(latest);
      if (action === 'hide') setHiding([latest.id]);
      if (action === 'quote-part') setQuoting(latest);
      if (action === 'sticker') return addStickers(latest);
      if (action === 'remove') setRemovingMessage(latest);
      if (action === 'pin' || action === 'unpin') togglePin(latest, action === 'pin');
      if (action === 'save' || action === 'unsave') toggleSaved(latest, action === 'save');
      if (action === 'remind') setReminding(latest);
      if (action === 'thread') openThread(latest.id);
      if (action === 'reply' || action === 'quote') { setEditing(null); setReplying({ roomId: latest.roomId, id: latest.id, quote: action === 'quote' ? quote : '' }); }
      if (action === 'react') setReactingTo(latest.id);
      if (action === 'edit') { if (latest.threadOf) { setThreadEditing(latest); return; } setReplying(null); setEditing({ roomId: latest.roomId, id: latest.id }); }
      if (action === 'forward') setForwarding([latest.id]);
      if (action === 'select') { selectAnchor.current = latest.id; setSelection([latest.id]); }
      if (action === 'link') {
        const link = absoluteUrl(`/#msg=${encodeURIComponent(latest.roomId)}/${encodeURIComponent(latest.id)}`);
        return copyText(link).then(() => notify('消息链接已复制')).catch(error => notify(error.message));
      }
      if (action === 'copy' && !current.privateMode) {
        const text = copyableText(latest);
        const copy = window.desktop?.copy ? window.desktop.copy(text) : copyText(text);
        return copy.catch(error => notify(error.message));
      }
    };
    const images = !privateMode && !message.recalledAt ? message.attachments.filter(file => /^image\/(png|jpeg|webp|gif)$/.test(file.mime)) : [];
    showContextMenu(event, { kind: 'message', canSticker: images.length > 0, canSelect: canReply && !inThread, canHide: !message.recalledAt, canReply: canReply && !inThread, canQuote: Boolean(quote), canThread: canReply && !message.threadOf, canReact, canForward: canReply && !message.card, canCopy, canLink: !message.recalledAt, canEdit, canPin, pinned, canSave: canReply, saved: isSaved, canRemind: canReply, canRecall, canRemove }, [
      ...(canReply && !inThread ? [{ id: 'reply', label: '回复', action: () => act('reply') }] : []),
      ...(quote ? [{ id: 'quote', label: '引用所选文字', action: () => act('quote') }] : []),
      ...(!quote && canReply && !inThread && !privateMode && message.text && matchMedia('(pointer: coarse)').matches ? [{ id: 'quote-part', label: '引用部分文字…', action: () => act('quote-part') }] : []),
      ...(canReact ? [{ id: 'react', label: '回应', action: () => act('react') }] : []),
      ...(canReply ? [...(message.card ? [] : [{ id: 'forward', label: '转发', action: () => act('forward') }]), ...(inThread ? [] : [{ id: 'select', label: '多选', action: () => act('select') }])] : []),
      ...(canCopy ? [{ id: 'copy', label: '复制', action: () => act('copy') }] : []),
      ...(!message.recalledAt ? [{ id: 'link', label: '复制消息链接', action: () => act('link') }] : []),
      ...(images.length ? [{ id: 'sticker', label: '添加到表情', action: () => act('sticker') }] : []),
      ...(canEdit ? [{ id: 'edit', label: '编辑', action: () => act('edit') }] : []),
      ...(canReply && !message.threadOf ? [{ id: 'thread', label: '在话题中回复', action: () => act('thread') }] : []),
      ...(canReply ? [{ id: 'remind', label: '提醒我…', action: () => act('remind') }] : []),
      ...(canReply ? [{ id: isSaved ? 'unsave' : 'save', label: isSaved ? '取消收藏' : '收藏', action: () => act(isSaved ? 'unsave' : 'save') }] : []),
      ...(canPin ? [{ id: pinned ? 'unpin' : 'pin', label: pinned ? '取消置顶消息' : '置顶消息', action: () => act(pinned ? 'unpin' : 'pin') }] : []),
      ...(canRecall ? [{ id: 'recall', label: '撤回消息', action: () => act('recall') }] : []),
      ...(!message.recalledAt ? [{ id: 'hide', label: '删除（仅自己）', action: () => act('hide') }] : []),
      ...(canRemove ? [{ id: 'remove', label: '删除消息（管理员）', action: () => act('remove') }] : []),
    ], '消息操作');
  }
  // 阅后即焚消息的菜单只有撤回（自己的、在时限内）、删除（仅自己）和管理员删除：不能回复、引用、回应、转发、多选、复制、
  // 编辑、置顶、收藏、提醒、开话题，也不复制链接。服务端同样逐项拒绝。
  function burnMenu(event, message) {
    const own = message.senderId === state.me.id;
    const recallWindow = state.workspace.recallWindow || 0;
    const canRecall = own && !message.burn.destroyedAt && (!recallWindow || Date.now() - message.createdAt <= recallWindow * 1000);
    const manager = state.workspace.mode === 'cloud' ? ['admin', 'super_admin'].includes(state.me.role) : state.workspace.ownerId === state.me.id;
    const canRemove = manager && !own && !message.burn.destroyedAt;
    const act = action => {
      const latestMessage = messageContext.current.messages[message.roomId]?.find(item => item.id === message.id);
      if (!latestMessage || latestMessage.recalledAt || messageContext.current.scope !== conversationScope) return;
      if (action === 'recall') setRecalling(latestMessage);
      if (action === 'hide') setHiding([latestMessage.id]);
      if (action === 'remove') setRemovingMessage(latestMessage);
    };
    showContextMenu(event, { kind: 'message', canSticker: false, canSelect: false, canHide: true, canReply: false, canQuote: false, canThread: false, canReact: false, canForward: false, canCopy: false, canLink: false, canEdit: false, canPin: false, pinned: false, canSave: false, saved: false, canRemind: false, canRecall, canRemove }, [
      ...(canRecall ? [{ id: 'recall', label: '撤回消息', action: () => act('recall') }] : []),
      { id: 'hide', label: '删除（仅自己）', action: () => act('hide') },
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
    // 点手机推送通知时，Service Worker 让已打开的页面跳到那条消息。
    const fromWorker = event => { if (event.data?.type === 'open-message') latest.current?.openMessageLink({ roomId: event.data.roomId, id: event.data.id }); };
    navigator.serviceWorker?.addEventListener('message', fromWorker);
    fromAddress();
    window.addEventListener('hashchange', fromAddress);
    window.addEventListener('linliao:open-message', open);
    window.addEventListener('linliao:join-group', join);
    return () => { window.removeEventListener('hashchange', fromAddress); window.removeEventListener('linliao:open-message', open); window.removeEventListener('linliao:join-group', join); navigator.serviceWorker?.removeEventListener('message', fromWorker); };
  }, [state?.me?.id]);
  const recipientsCache = useRef([]);
  const messageHandlers = useMemo(() => ({
    onContextMenu: (event, message) => latest.current.messageMenu(event, message),
    onReply: target => { setEditing(null); setReplying({ roomId: target.roomId, id: target.id, quote: selectedQuote(target) }); },
    nameOf: id => latest.current.displayUser(latest.current.userMap[id])?.name || (id?.startsWith('webhook:') ? '机器人' : undefined),
    userOf: id => latest.current.displayUser(latest.current.userMap[id]),
    colorOf: id => nameColor(id, latest.current.userMap[id]),
    onOpenQuote: (reply, message) => latest.current.jumpToMessage({ id: reply.id, seq: reply.seq, roomId: message.roomId }),
    onReact: (message, emoji) => latest.current.toggleReaction(message, emoji),
    onVote: (message, options) => latest.current.votePoll(message, options),
    onClosePoll: message => latest.current.closePoll(message),
    onChainEntry: message => setChainEntry({ roomId: message.roomId, id: message.id }),
    onCloseChain: message => latest.current.closeChain(message),
    onOpenBurn: message => latest.current.openBurnMessage(message),
    onOpenThread: target => latest.current.openThread(target.id),
    onRead: (roomId, messageId) => latest.current.markMessageRead(roomId, messageId),
    onToggleSelect: (target, range) => latest.current.selectMessage(target, range),
    onReadDetail: (event, message) => { const rect = event.currentTarget.getBoundingClientRect(); setReadDetail(current => current?.id === message.id ? null : { id: message.id, x: rect.right, y: rect.top }); },
    onOpenBundle: setOpenBundle, onPick: setReactingTo, onPreview: setPreview,
    onReEdit: message => latest.current.reEdit(message),
    onShowHistory: setHistoryFor,
    onOpenProfile: (user, element) => latest.current.openProfile(user, element),
  }), []);
  const toastElement = toast && <div className="toast" role="status"><Check size={15} />{toast}</div>;
  if (startupError) return <div className="startup-state"><Logo /><h2>暂时无法连接</h2><p>{startupError}</p><div className="startup-actions"><button className="primary-button" onClick={start}><RefreshCw size={15} />重新连接</button>{mobileClient && <button className="secondary-button" onClick={chooseServer}>连接服务器</button>}{window.desktop && <button className="secondary-button" onClick={() => window.desktop.home()}>返回本机空间</button>}</div></div>;
  if (!bootstrap) return <div className="startup-state"><Logo /><p>正在连接虾扯蛋…</p><LoaderCircle className="spin" size={18} /></div>;
  if (!state?.me) return <>{bootstrap.mode === 'cloud' ? <Account bootstrap={bootstrap} onChanged={start} onLogout={logout} loggingOut={loggingOut} /> : <Onboarding bootstrap={bootstrap} onJoined={start} notify={notify} />}{toastElement}</>;
  const userMap = Object.fromEntries(state.users.map(user => [user.id, user]));
  const peerOf = room => userMap[room.members.find(id => id !== state.me.id)];
  const roomName = room => room.kind === 'direct' ? peerOf(room)?.name || '私聊' : room.name;
  const rooms = conversations.map(room => ({ ...room, name: roomName(room) }));
  const room = rooms.find(room => room.id === selected && !room.hidden);
  // 机器人只算在它加入的群聊和大厅里；私聊里它本来就是两位成员之一。
  const inRoom = (target, user) => user.bot && target.kind !== 'direct' ? (target.bots || []).includes(user.id) : target.kind === 'public' || target.members.includes(user.id);
  const groupMembers = !room ? [] : state.users.filter(user => !user.removed && inRoom(room, user));
  // 会接收这里全部消息的机器人（私聊里机器人总是收全部，另有说明）。
  const listeningBots = room && room.kind !== 'direct' ? groupMembers.filter(user => user.bot?.receiveAll) : [];
  const online = state.users.filter(user => !user.removed && user.online);
  latest.current = { messageMenu, userMap, displayUser, jumpToMessage, toggleReaction, votePoll, closePoll, closeChain, openBurnMessage, openThread, markMessageRead, openProfile, selectMessage,
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
  const showAvatar = mine => classic || (room?.kind === 'direct' ? chatPrefs.showBothInDirect : !mine || chatPrefs.showSelfInGroups);
  // 经典风格固定：私聊不显示名字，群聊只显示别人的名字。
  const showNameOf = mine => classic ? room?.kind !== 'direct' && !mine : room?.kind === 'direct' ? chatPrefs.showBothInDirect : !mine || chatPrefs.showSelfNameInGroups;
  // 机器人不回已读，不算在已读人数里（和机器人的私聊也就不显示已读、未读）。
  const recipientIds = groupMembers.filter(user => user.id !== state.me.id && !user.bot).map(user => user.id);
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
  // 回到跳转前的位置：另一个会话借用切换会话时的位置恢复；同一个会话直接滚回去，那条消息不在了就回到最新消息。
  function returnToOrigin() {
    const spot = returnSpot;
    setReturnSpot(null);
    if (!spot) return;
    // 还在等加载的跳转作废；它还没开始滚动，也就没有要拉回的动画余波。
    jumpRun.current++;
    if (jumpSettle.current === Infinity) jumpSettle.current = 0;
    if (spot.roomId !== selected) {
      if (!rooms.some(target => target.id === spot.roomId && !target.hidden)) return notify('原来的会话已不在列表中');
      if (spot.id) scrollSpots.current.set(spot.roomId, { id: spot.id, offset: spot.offset }); else scrollSpots.current.delete(spot.roomId);
      jumpSwitch.current = spot.roomId; setSelected(spot.roomId); setMobileChat(true); setReadDetail(null);
      return;
    }
    // 阅读位置平时在滚动事件里记下；回去之后马上换会话的话，那次滚动事件还没到，记着的仍是跳转目标，所以这里直接记好。
    if (spot.id && scrollToSpot(spot)) { sticky.current = false; pinnedSpot.current = spot; scrollSpots.current.set(selected, { id: spot.id, offset: spot.offset }); return; }
    scrollSpots.current.delete(selected);
    sticky.current = true;
    if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight;
  }
  // 停在同一个会话底部时跳走，「回到最新消息」已经能回去，不再多一个同样作用的按钮。
  const showReturn = Boolean(returnSpot && (returnSpot.roomId !== selected || returnSpot.id));
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
  const roomIcon = (target, size = 32) => target.kind === 'direct' ? <Avatar user={peerOf(target)} size={size} online={peerOf(target)?.bot ? undefined : peerOf(target)?.online} /> : target.avatar ? <Avatar user={{ avatar: target.avatar }} size={size} /> : <span className="room-avatar">{target.kind === 'public' ? <Hash size={16} /> : <Users size={16} />}</span>;
  const fitSidebar = raw => raw < 160 ? 76 : Math.min(440, Math.max(220, Math.round(raw)));
  const compact = sidebarWidth === 76;
  const searchBox = <label className="sidebar-search"><Search size={14} /><input aria-label="搜索会话和消息" placeholder="搜索会话和消息" value={search} onChange={event => setSearch(event.target.value)} />{search ? <IconButton icon={X} label="清空搜索" size={14} onClick={() => setSearch('')} /> : <button type="button" className="switch-hint" onClick={() => setSwitcher(true)} title="快速切换会话">{switchKey}</button>}</label>;
  const anyUnread = rooms.some(target => !target.hidden && (unread[target.id]?.hasUnread || target.markedUnread));
  const markAllRead = () => { for (const target of rooms) if (!target.hidden && (unread[target.id]?.hasUnread || target.markedUnread)) markRead(target); notify('已全部标为已读'); };
  // 经典风格：搜索框旁的「＋」收纳发起聊天、邀请、文件夹和全部已读；左侧导航栏放原来侧栏顶部和底部的入口。
  const openClassicMenu = event => {
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.left, y: rect.bottom + 4, label: '发起', items: [
      { id: 'group', label: '发起群聊', action: () => setModal('group') },
      { id: 'direct', label: '发起私聊', action: () => { setContactQuery(''); setModal('members'); } },
      { id: 'invite', label: '邀请同事', action: () => setModal('invite') },
      { id: 'folder', label: '新建文件夹', action: () => setEditingFolder('new') },
      ...(anyUnread ? [{ id: 'read-all', label: '全部标为已读', action: markAllRead }] : []),
    ] });
  };
  const railButton = (Icon, label, onClick, { active = false, badge = 0, dot = false, disabled = false } = {}) => <button type="button" className={`rail-button ${active ? 'active' : ''}`}
    aria-label={badge ? `${label}，${badge} 条未读` : label} title={label} aria-current={active ? 'page' : undefined} disabled={disabled} onClick={onClick}>
    <Icon size={22} strokeWidth={1.8} />{badge > 0 && <span className="rail-badge">{badge > 99 ? '99+' : badge}</span>}{dot && <i className="rail-dot" aria-hidden="true" />}</button>;
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
    return <button className={`conversation ${selected === target.id ? 'active' : ''} ${showUnread ? 'has-unread' : ''} ${target.muted ? 'muted' : ''} ${status?.mentioned ? 'mentioned' : ''} ${target.pinned ? 'pinned' : ''} ${pinnedDrag.dragging === target.id ? 'dragging' : ''}`} key={target.id} data-room-id={target.id} aria-current={selected === target.id ? 'page' : undefined} aria-haspopup="menu"
      style={sortable ? pinnedDrag.styleFor(target.id) : undefined} aria-keyshortcuts={sortable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
      onClick={() => { if (sortable && pinnedDrag.consumeClick()) return; if (!consumeLongPress(longPress)) openRoom(target.id); }} {...press}
      onPointerDown={event => { press.onPointerDown(event); if (sortable) pinnedDrag.begin(event, target.id, pinnedIds); dragOut(event, target); }}
      onContextMenu={event => { if (longPress.current.fired) event.preventDefault(); else conversationMenu(event, target); }}
      onKeyDown={event => { if (sortable && pinnedDrag.keyMove(event, target.id, pinnedIds)) return; if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { const rect = event.currentTarget.getBoundingClientRect(); conversationMenu(Object.assign(pressEvent(rect.left + 24, rect.bottom), { preventDefault: () => event.preventDefault() }), target); } }}>
      <span className="conversation-icon" title={compact ? target.name : undefined}>{roomIcon(target, classic ? 40 : 44)}{compact && showUnread && <i className="compact-dot" aria-hidden="true" />}</span><span className="conversation-copy"><span className="conversation-title"><span className="conversation-name">{target.name}</span>{target.kind === 'direct' && <StatusEmoji user={peerOf(target)} />}{target.pinned && <Pin className="conversation-pin" size={11} aria-label="已置顶" />}{target.muted && <BellOff className="conversation-pin" size={11} aria-label="免打扰" />}<time>{target.lastMessage ? formatTime(target.lastMessage.createdAt) : ''}</time></span>
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
  // 把机器人拉进、移出：群聊是群主和群管理员，大厅是空间管理者。
  const canManageRoomBots = Boolean(room && (room.kind === 'group' ? isGroupManager : room.kind === 'public' && (cloud ? isAdmin : isOwner)));
  // 不能发言时（禁言、全员禁言）不提供左滑回复。
  const composerBlocked = Boolean(room && ((room.kind === 'group' && room.allMuted && !isGroupManager) || state.me.muted));
  // 接龙：群主、群管理员（大厅是空间管理者）也能结束别人发起的；不能发言时不能接龙。
  const chainManager = room?.kind === 'group' ? isGroupManager : room?.kind === 'public' && (cloud ? isAdmin : isOwner);
  const voiceBlocked = !room ? '' : room.kind === 'group' && room.allMuted && !isGroupManager ? '全员禁言中，只有群主和管理员可以接龙' : state.me.muted ? '你已被管理员禁言' : '';
  const canSetAutoDelete = room?.kind === 'direct' || (room?.kind === 'group' ? groupOwner === state.me.id : room?.kind === 'public' && (cloud ? isAdmin : isOwner));
  const canEditRoomAvatar = room?.kind === 'group' ? groupOwner === state.me.id : room?.kind === 'public' && (cloud ? isAdmin : isOwner);
  // 右侧成员面板里单击看资料卡、双击私聊；「空间成员」弹窗里单击直接私聊。
  const memberRow = (user, size, inGroup = false, panel = false, roomPanel = false) => { const shown = inGroup ? displayUser(user) : user; return <div className="managed-member" key={user.id}><button className="member-row" {...(panel ? profileClick(user) : { onClick: () => directMessage(user) })}><Avatar user={user} size={size} online={user.bot ? undefined : user.online} /><span className="member-name" title={shown.realName ? `原名：${shown.realName}` : undefined}>{shown.name}<StatusEmoji user={user} />{user.bot && <BotTag />}{user.department && <small className="member-department">{user.department}</small>}{user.id === state.me.id && <small className="me-tag">我</small>}{user.muted && <small className="muted-tag">已禁言</small>}{inGroup && user.id === groupOwner && <small className="owner-tag"><Crown size={10} />群主</small>}{inGroup && groupAdmins.includes(user.id) && <small className="owner-tag admin-tag">管理员</small>}</span><small title={user.bio || undefined} className={user.bot?.receiveAll && user.bot.status === 'enabled' ? 'bot-listening-text' : undefined}>{user.bot ? user.bot.status !== 'enabled' ? '已停用' : user.bot.receiveAll ? '接收全部消息' : '' : user.online ? '在线' : user.lastSeen ? seenText(user.lastSeen) : '离线'}</small><ChevronRight size={14} /></button>{!inGroup && !user.bot && (cloud ? isAdmin : isOwner) && user.id !== state.me.id && user.id !== state.workspace.ownerId && <button className="remove-member" aria-haspopup="menu" aria-label={`管理${user.name}`} onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      setContextMenu({ x: rect.left - 100, y: rect.bottom + 4, label: `管理${user.name}`, items: [
        { id: 'mute', label: user.muted ? '解除禁言' : '禁言…', action: async () => { if (!user.muted) return setMutingUser(user); try { await api('admin/mute', { userId: user.id, muted: false }); notify('已解除禁言'); } catch (error) { notify(error.message); } } },
        ...(isOwner && !cloud ? [{ id: 'remove', label: '从空间移除', action: () => setRemoving(user) }] : []),
      ] });
    }}>管理</button>}
    {inGroup && !user.bot && groupOwner === state.me.id && user.id !== state.me.id && <button className="remove-member" onClick={() => setGroupAction({ type: 'transfer', user })} aria-label={`把群主转让给${user.name}`}>转让</button>}
    {roomPanel && user.bot && canManageRoomBots && <button className="remove-member" onClick={() => setGroupAction({ type: 'removeBot', user })} aria-label={`把机器人${user.name}移出`}>移出</button>}</div>; };
  // 通讯录：按部门分组，没填部门的放最后；组内在线的排前面。
  const contactNeedle = contactQuery.trim().toLowerCase();
  const contactGroups = Object.entries(state.users.filter(user => !user.removed && (!contactNeedle || [user.name, user.department, user.bio].some(value => value?.toLowerCase().includes(contactNeedle))))
    .reduce((groups, user) => { (groups[user.bot ? '机器人' : user.department || '未设置部门'] ||= []).push(user); return groups; }, {}))
    .sort(([a], [b]) => (a === '机器人') - (b === '机器人') || (a === '未设置部门') - (b === '未设置部门') || a.localeCompare(b, 'zh-Hans-CN'))
    .map(([department, members]) => [department, members.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'zh-Hans-CN'))]);
  const peerStatus = room?.kind === 'direct' && activeStatus(peer);
  // 和机器人的私聊：它总是收这里的全部消息，停用、删除后说清楚收不到。
  const botPeerText = peer => peer.bot.status === 'deleted' ? '机器人已删除，消息不会再送达' : peer.bot.status === 'enabled' ? '你在这里发的消息都会发给它' : '机器人已停用，暂时收不到消息';
  const subtitle = room?.kind === 'direct' ? peer?.bot ? botPeerText(peer) : (peerStatus ? `${peerStatus.emoji} ${peerStatus.text} · `.replace(/^ /, '') : '') + (peer?.online ? '在线' : peer?.lastSeen ? seenText(peer.lastSeen) : '离线 · 上线后送达') : `${groupMembers.length} 位成员 · ${groupMembers.filter(user => user.online).length} 人在线`;
  const sameGroup = (previous, message) => !classic && previous && !previous.recalledAt && !message.recalledAt && !previous.burn?.destroyedAt && !message.burn?.destroyedAt && !previous.nudge && !message.nudge && !previous.notice && !message.notice && previous.senderId === message.senderId &&
    new Date(previous.createdAt).toDateString() === new Date(message.createdAt).toDateString() && message.createdAt - previous.createdAt < 5 * 60000;
  const userOf = message => displayUser(userMap[message.senderId]) || (message.bot ? { id: message.senderId, name: message.bot, avatar: 'bot' } : undefined);
  // 同一个人连续发的消息合成一组：头像放在组的一侧，滚动时贴住可视区底部。
  const messageGroups = [];
  for (const [index, message] of currentMessages.entries()) {
    const previous = currentMessages[index - 1];
    const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
    if (!newDay && sameGroup(previous, message)) messageGroups.at(-1).messages.push(message);
    // 经典风格：和上一条相隔 5 分钟以上（或跨天）时在中间插一行时间。
    else messageGroups.push({ newDay, messages: [message], timeLabel: classic && (newDay || message.createdAt - previous.createdAt >= 5 * 60000) ? classicTime(message.createdAt) : null });
  }
  return <>{appLock.locked && <LockScreen appLock={appLock} onLogout={logout} loggingOut={loggingOut} />}<div inert={appLock.locked} className={`app ${popoutRoom ? 'popout' : ''} ${privateMode ? 'privacy-on' : ''} ${nativeTitlebar ? 'native' : ''} ${mobileChat ? 'show-chat' : ''} ${compact ? 'compact-sidebar' : ''}`} style={{ '--sidebar': `${sidebarWidth}px` }} data-screen-label="虾扯蛋聊天空间">
    {classic && !popoutRoom && <nav className="classic-rail" aria-label="导航">
      <div className="rail-drag" data-drag-region aria-hidden="true" />
      <button type="button" className="rail-me" aria-label="修改昵称和头像" title={`${state.me.name} · ${state.workspace.name}`} onClick={() => setModal('profile')}><Avatar user={userMap[state.me.id] || state.me} size={36} /></button>
      {railButton(MessageCircle, '聊天', () => chooseFolderTab('all'), { active: true, badge: unreadCount })}
      {railButton(BookUser, '通讯录', () => { setContactQuery(''); setModal('members'); })}
      {railButton(AtSign, '提到我的', () => { setActivity(null); setModal('activity'); })}
      {railButton(Bookmark, '收藏', () => setModal('saved'))}
      <span className="rail-spacer" />
      {cloud && isAdmin && railButton(ShieldCheck, '用户管理', () => setModal('admin'))}
      {railButton(Settings2, update?.available ? '设置（有新版本）' : '设置', () => setModal('connection'), { dot: Boolean(update?.available) })}
      {railButton(LogOut, loggingOut ? '正在退出…' : '退出登录', logout, { disabled: loggingOut })}
    </nav>}
    <aside className="sidebar glass" aria-label="会话列表" data-mobile-tab={mobileTab}>{resizer}
      <MobileHome tab={mobileTab} me={{ ...state.me, ...userMap[state.me.id] }} users={state.users} connected={connected} onDirect={directMessage} onAction={setModal} isAdmin={cloud && isAdmin} loggingOut={loggingOut} onLogout={logout} />
      <div className="sidebar-drag" data-drag-region aria-hidden="true" />
      <div className="space-heading" data-drag-region><div className="space-copy"><h1>{state.workspace.name}</h1><p><i className={`status-dot ${connected ? 'online' : ''}`} />{online.length} 人在线</p></div><span className="space-actions">{anyUnread && <IconButton icon={CheckCheck} label="全部标为已读" onClick={markAllRead} />}<IconButton icon={BookUser} label="通讯录" className="contacts-entry" onClick={() => { setContactQuery(''); setModal('members'); }} /><IconButton icon={AtSign} label="提到我的" onClick={() => { setActivity(null); setModal('activity'); }} /><IconButton icon={Bookmark} label="收藏" onClick={() => setModal('saved')} /><IconButton icon={UserPlus} label="邀请同事" onClick={() => setModal('invite')} /></span></div>
      {classic ? <div className="classic-search">{searchBox}<IconButton icon={CirclePlus} size={22} label="发起聊天、邀请同事" className="classic-plus" aria-haspopup="menu" onClick={openClassicMenu} /></div> : searchBox}
      {!compact && <div className="folder-bar"><div className="folder-tabs" role="tablist" aria-label="会话分组">{folderTabs.map(tab => <button type="button" role="tab" key={tab.id} aria-selected={tab.id === tabKey} className={tab.id === tabKey ? 'active' : ''} onClick={() => chooseFolderTab(tab.id)}>
        {tab.label}{tab.unread > 0 && <span className="folder-unread">{tab.unread > 99 ? '99+' : tab.unread}</span>}</button>)}</div>
        {activeFolder && <IconButton icon={PencilLine} label="编辑这个文件夹" size={14} onClick={() => setEditingFolder(activeFolder)} />}
        <IconButton icon={FolderPlus} label="新建文件夹" size={14} onClick={() => setEditingFolder('new')} /></div>}
      <nav className="conversation-scroll" aria-label="会话">
        {classic ? (() => {
          // 经典风格：一个列表，置顶的在前，其余按最后一条消息的时间排。
          const pinnedRooms = filtered.filter(target => target.pinned), ids = query || tabKey !== 'all' ? undefined : pinnedRooms.map(target => target.id);
          const recent = filtered.filter(target => !target.pinned).sort((x, y) => (y.lastMessage?.createdAt || 0) - (x.lastMessage?.createdAt || 0));
          return <>{pinnedRooms.map(target => roomButton(target, ids))}{recent.map(target => roomButton(target))}</>;
        })() : <>
        {filtered.some(room => room.pinned) && <><div className="section-label"><span>置顶</span></div>{(() => { const pinnedRooms = filtered.filter(room => room.pinned), ids = query || tabKey !== 'all' ? undefined : pinnedRooms.map(room => room.id); return pinnedRooms.map(target => roomButton(target, ids)); })()}</>}
        {showGroupSection && <><div className="section-label"><span>群聊</span><IconButton icon={Plus} label="新建群聊" size={15} onClick={() => setModal('group')} /></div>{filtered.filter(room => !room.pinned && room.kind !== 'direct').map(roomButton)}</>}
        {showDirectSection && <><div className="section-label"><span>私聊</span><IconButton icon={Plus} label="发起私聊" size={15} onClick={() => setModal('members')} /></div>{filtered.filter(room => !room.pinned && room.kind === 'direct').map(roomButton)}</>}
        </>}
        {!query && !['all', 'groups', 'direct'].includes(tabKey) && !filtered.length && <p className="sidebar-empty">{tabKey === 'unread' ? '没有未读的会话。' : '这个文件夹里还没有会话，点上方的编辑按钮添加。'}</p>}
        {['all', 'direct'].includes(tabKey) && !filtered.some(room => room.kind === 'direct') && <p className="sidebar-empty">{search ? '没有匹配的私聊' : '找到一位同事，聊点新鲜事。'}</p>}
        {searchTerm && <section className="sidebar-messages" aria-label="消息搜索结果" aria-live="polite"><div className="section-label"><span>消息</span></div>
          {globalSearch.results?.map(message => { const target = rooms.find(item => item.id === message.roomId); if (!target) return null;
            const sender = message.senderId === state.me.id ? '我' : userMap[message.senderId]?.name || '成员';
            return <SearchResult key={message.id} message={message} term={searchTerm} avatar={roomIcon(target, 24)} title={target.name}
              prefix={target.kind === 'direct' && message.senderId !== state.me.id ? '' : `${sender}：`} privateMode={privateMode} onJump={jumpToMessage} />; })}
          <SearchStatus term={searchTerm} results={globalSearch.results} error={globalSearch.error} pending={globalSearch.pending} />
        </section>}
      </nav>
      {cloud && isAdmin && <button className="admin-entry" onClick={() => setModal('admin')}><ShieldCheck size={16} /><span>用户管理</span><ChevronRight size={14} /></button>}
      <div className="me-card"><button className="me-profile" title="修改昵称和头像" onClick={() => setModal('profile')}><Avatar user={state.me} size={30} /><span><b>{state.me.name}</b><small className={connected ? '' : 'warning'}>{connected ? cloud ? '已连接' : '局域网已连接' : '正在重新连接…'}</small></span></button><IconButton icon={Settings2} label={update?.available ? '设置（有新版本）' : '设置'} className={update?.available ? 'has-update' : ''} onClick={() => setModal('connection')} /></div>
      <button type="button" className="sidebar-logout" disabled={loggingOut} onClick={logout}>{loggingOut ? <LoaderCircle className="spin" size={14} /> : <LogOut size={14} />}<span>{loggingOut ? '正在退出…' : '退出登录'}</span></button>
      <MobileTabs tab={mobileTab} onChange={tab => { setMobileTab(tab); setMobileChat(false); }} unread={rooms.reduce((count, target) => count + (!target.muted && !target.hidden ? unread[target.id]?.count || 0 : 0), 0)} />
    </aside>
    <main className="chat-main">
      {room ? <>
      <div className="conversation-body"><section className={`chat-column ${showReturn ? 'has-jump-back' : ''}`}>
        <header className="chat-toolbar" data-drag-region>
          <IconButton icon={ChevronLeft} label="返回会话列表" className="back-button glass" onClick={() => setMobileChat(false)} />
          <div className="toolbar-title glass">{room.kind === 'direct' && peer ? avatarButton(peer, roomIcon(room, 34), 'toolbar-icon avatar-button') : canEditRoomAvatar ? <button type="button" className="toolbar-icon avatar-button" aria-label="设置群头像" title="设置群头像" aria-haspopup="dialog" onClick={() => setModal('roomAvatar')}>{roomIcon(room, 34)}</button> : <span className="toolbar-icon">{roomIcon(room, 34)}</span>}<span className="toolbar-copy"><h2>{room.name}{classic && room.kind !== 'direct' && <span className="title-count">({groupMembers.length})</span>}{room.kind === 'group' && room.allMuted && <span className="auto-delete-tag"><MicOff size={12} />全员禁言</span>}{listeningBots.length > 0 && <span className="auto-delete-tag bot-listening-tag" title={`${listeningBots.map(user => `「${user.name}」`).join('、')}会接收这里的全部消息`}><Bot size={12} aria-hidden="true" />机器人接收全部消息<span className="visually-hidden">：{listeningBots.map(user => user.name).join('、')}</span></span>}{room.kind === 'direct' && peer?.bot && <BotTag />}{classic && room.kind === 'direct' && peer?.bot && peer.bot.status !== 'enabled' && <span className="auto-delete-tag" title={botPeerText(peer)}>{peer.bot.status === 'deleted' ? '已删除' : '已停用'}</span>}{room.autoDelete > 0 && <span className="auto-delete-tag" title={`消息发出 ${autoDeleteLabel(room.autoDelete)} 后自动删除`}><Timer size={12} />{autoDeleteLabel(room.autoDelete)}</span>}</h2><span className={`toolbar-subtitle ${typingLabel(room) ? 'typing-text' : ''}`} aria-live="polite">{typingLabel(room) || subtitle}</span></span></div>
          <div className="toolbar-actions">
            <button className={`toolbar-button glass privacy-toggle ${privateMode ? 'enabled' : ''}`} onClick={() => changePrivacy(value => !value)} role="switch" aria-checked={privateMode} aria-label="隐私模式" title="隐私模式 · ⌘⇧P · 悬停消息查看内容">{privateMode ? <EyeOff size={16} /> : <Eye size={16} />}<kbd>⌘⇧P</kbd></button>
            <button className={`toolbar-button glass member-count ${showMembers ? 'selected' : ''}`} onClick={() => { setShowMembers(value => !value); setPanelView('members'); }} aria-pressed={showMembers} aria-label={`会话成员，${groupMembers.length} 人`} title={classic ? '聊天信息' : '会话成员'}>{classic ? <MoreHorizontal size={19} strokeWidth={1.7} /> : <><span className="avatar-stack">{groupMembers.slice(0, 3).map(user => <Avatar key={user.id} user={user} size={20} />)}</span><span>{groupMembers.length}</span></>}</button>
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
        <div className="message-scroll" ref={messageList} onScroll={onMessageScroll}><div className="message-list" ref={messageContent}>
        {hasMore[selected] && <button className="load-older" onClick={loadOlder} disabled={loading}>{loading ? '正在加载…' : '查看更早的消息'}</button>}
        {!hasMore[selected] && <div className={`channel-welcome ${currentMessages.length ? 'has-messages' : ''}`}><span className="welcome-icon">{room.kind === 'public' ? <Hash size={22} /> : room.kind === 'group' ? <Users size={22} /> : <MessageCircle size={22} />}</span><h3>{room.kind === 'public' ? cloud ? '大家都在，随便扯两句。' : '同一个网络，随便扯两句。' : room.kind === 'group' ? `欢迎来到「${room.name}」` : `和${room.name}聊聊吧`}</h3><p>{room.kind === 'public' ? '工作、日常、好玩的，都可以往这里丢。' : room.kind === 'group' ? '文字、图片、视频，把想分享的都留在这里。' : '有些话，适合只对一个人说。'}</p>{room.kind === 'public' && !currentMessages.length && <button className="secondary-button" onClick={() => setModal('invite')}><UserPlus size={15} />邀请同事加入</button>}</div>}
        {!currentMessages.length && loading && <Skeleton kind="message" rows={6} label="正在加载消息…" />}
        {messageGroups.map(group => { const first = group.messages[0]; const mine = first.senderId === state.me.id; const author = userOf(first); const withAvatar = showAvatar(mine) && !first.nudge && !first.notice; const avatar = withAvatar && !first.recalledAt && !first.burn?.destroyedAt && <div className="group-avatar">{avatarButton(first.bot ? null : author, <Avatar user={author} size={classic ? 36 : 32} />)}</div>;
          return <React.Fragment key={first.id}>{group.timeLabel && <div className="time-divider"><span>{group.timeLabel}</span></div>}{!classic && group.newDay && <div className="date-divider"><span>{new Date(group.messages[0].createdAt).toDateString() === new Date().toDateString() ? '今天' : new Date(group.messages[0].createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span></div>}<div className={`message-group ${mine ? 'mine' : ''} ${withAvatar && (classic || chatPrefs.avatarMode === 'top') ? 'avatar-top' : ''}`}>{!mine && avatar}<div className="group-rows">{group.messages.map((message, position) => <Message {...messageHandlers} key={message.id} message={message} users={state.users} nicknames={nicknamesKey} showName={position === 0 && !first.nudge && showNameOf(mine)} reEditable={Boolean(recalledTexts[message.id])} quickReact={chatPrefs.quickReact}
          reactionOptions={state.reactions || NO_REACTIONS} picking={reactingTo === message.id} selecting={Boolean(selection)} selected={Boolean(selection?.includes(message.id))} swipeReply={!selection && !composerBlocked}
          user={userOf(message)} grouped mine={message.senderId === state.me.id} continued={position > 0} last={position === group.messages.length - 1} privateMode={privateMode} viewerId={state.me.id}
          readingEnabled={(windowActive || privateMode) && !modal && !removing && !recalling && !contextMenu && !preview && !loading} recipients={recipientsCache.current} direct={room.kind === 'direct'}
          chainManager={chainManager} voiceBlocked={voiceBlocked} burnContent={burnContents[message.id]} />)}</div>{mine && avatar}</div></React.Fragment>; })}
        {outbox.items.filter(item => item.roomId === room.id && !item.payload.threadOf).map(item => <OutboxMessage key={item.clientId} item={item} avatarColumn={showAvatar(true)} onRetry={outbox.retry} onDiscard={outbox.discard} />)}
      </div></div>{unreadMentions.length > 0 && <button type="button" className="jump-to-mention glass" aria-label={`跳到提到你的消息，还有 ${unreadMentions.length} 条`} title="跳到提到你的消息" onClick={() => jumpToMessage(unreadMentions[0])}><AtSign size={18} /><span className="mention-count">{unreadMentions.length > 99 ? '99+' : unreadMentions.length}</span></button>}{scrolledUp && <button className="jump-to-latest glass" onClick={() => { sticky.current = true; setReturnSpot(null); messageList.current.scrollTo({ top: messageList.current.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}><ArrowDown size={14} />{arrivedWhileAway ? `${arrivedWhileAway} 条新消息` : '回到最新消息'}</button>}
      {showReturn && <button type="button" className="jump-back glass" aria-label="返回原位置（跳转前看到的地方）" title="返回跳转前看到的地方" onClick={returnToOrigin}><Undo2 size={14} />返回原位置</button>}
      {unreadAnchor?.roomId === selected && <button className="unread-anchor glass" onClick={jumpToFirstUnread}><ArrowUp size={14} />{unreadAnchor.count ? `${unreadAnchor.count} 条未读消息` : '跳到未读消息'}</button>}
      {selection ? <div className="selection-bar glass" role="toolbar" aria-label="多选消息">
        <span>已选 <b className={overSelected ? 'over' : ''}>{selection.length}</b>/{SELECT_LIMIT} 条<small className={overSelected ? 'over' : ''} aria-live="polite">{overSelected ? `一次最多选 ${SELECT_LIMIT} 条，请取消 ${selection.length - SELECT_LIMIT} 条` : matchMedia('(pointer: coarse)').matches ? '长按另一条可连选' : '按住 Shift 点击可连选'}</small></span>
        <button className="secondary-button" onClick={() => setSelection(null)}>取消</button>
        <button className="secondary-button" disabled={!selection.length || overSelected} onClick={() => setHiding([...selection])}>删除</button>
        <ForwardButtons count={selection.length} disabled={!selection.length || overSelected} onForward={merge => { setForwardMerge(merge); setForwarding([...selection]); }} />
      </div> : peer?.bot?.status === 'deleted' ? <div className="muted-notice glass" role="status">机器人已删除，不能再发消息</div> : room.kind === 'group' && room.allMuted && !isGroupManager ? <div className="muted-notice glass" role="status">全员禁言中，只有群主和管理员可以发言</div> : state.me.muted ? <div className="muted-notice glass" role="status">你已被管理员禁言{state.me.mutedUntil ? `，${new Date(state.me.mutedUntil).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 后恢复` : ''}</div> : <Composer injectDraft={injectDraft} injectShare={injectShare} sendKey={chatPrefs.sendKey} onDraft={(id, text) => setDraftTexts(previous => (previous[id] || '') === text ? previous : { ...previous, [id]: text })} room={room} connected={connected && !loggingOut} onQueue={(payload, preview) => { sticky.current = true; setReturnSpot(null); outbox.send(payload, preview); }} notify={notify} privateMode={privateMode}
        members={room.kind === 'direct' ? [] : groupMembers.filter(user => user.id !== state.me.id)} canMentionAll={room.kind === 'group' || (room.kind === 'public' && (isOwner || isAdmin))} phrases={state.phrases}
        notice={scheduled.roomId === room.id && scheduled.items.length > 0 && <button type="button" className="scheduled-bar glass" onClick={() => setModal('scheduled')}><Clock size={14} />{scheduled.items.length} 条定时消息待发送 · 最近 {new Date(scheduled.items[0].sendAt).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</button>}
        onCreatePoll={() => { if (!burnBlocked(room.id, '发起投票')) setModal('poll'); }} onCreateChain={room.kind !== 'direct' ? () => setModal('chain') : undefined}
        burnAvailable={room.kind === 'direct' && !peer?.bot} burnMode={burnModes[room.id] || 0} onBurn={seconds => setBurnModes(previous => ({ ...previous, [room.id]: seconds }))}
        onSchedule={text => { if (!burnBlocked(room.id, '定时发送')) setScheduleText(text); }} onTyping={sendTyping} editing={editTarget} onCancelEdit={() => setEditing(null)} onEdited={message => { applyEdit(message); setEditing(null); }}
        onEditLast={() => { if (lastOwn) { setReplying(null); setEditing({ roomId: lastOwn.roomId, id: lastOwn.id }); } }}
        reply={replyTarget} replyAuthor={replyTarget && (replyTarget.senderId === state.me.id ? '自己' : userMap[replyTarget.senderId]?.name || '成员')} onCancelReply={() => setReplying(null)} />}</section>
      {showMembers && <aside className="members-panel glass" aria-label={panelView === 'history' ? '聊天记录' : panelView === 'files' ? '图片与文件' : panelView === 'thread' ? '话题' : '会话成员'}>{panelView === 'thread' && threadRoot
        ? <ThreadPanel key={threadRoot} rootId={threadRoot} room={room} viewerId={state.me.id} privateMode={privateMode} threadTick={threadTick} onBack={() => setPanelView('members')} notify={notify}
          onLoaded={items => { threadMessages.current = items; }} handlers={messageHandlers} userOf={userOf} reactionOptions={state.reactions || NO_REACTIONS} reactingTo={reactingTo} quickReact={chatPrefs.quickReact}
          blocked={room.kind === 'group' && room.allMuted && !isGroupManager ? '全员禁言中，只有群主和管理员可以发言' : state.me.muted ? '你已被管理员禁言' : burnModes[room.id] ? '阅后即焚开着，话题里不能回复；先关掉输入框上方的阅后即焚' : ''}
          composer={{ connected, notify, privateMode, phrases: state.phrases, sendKey: chatPrefs.sendKey, members: room.kind === 'direct' ? [] : groupMembers.filter(user => user.id !== state.me.id), canMentionAll: room.kind === 'group' || (room.kind === 'public' && (isOwner || isAdmin)) }}
          outbox={outbox} editing={threadEditing && !threadEditing.recalledAt ? threadEditing : null} onCancelEdit={() => setThreadEditing(null)} onEdited={message => { applyEdit(message); setThreadEditing(null); }}
          onEditLast={() => { const own = threadMessages.current.findLast(item => item.threadOf && item.senderId === state.me.id && !item.recalledAt); if (own) setThreadEditing(own); }} />
        : panelView === 'files'
        ? <RoomFiles room={room} userMap={userMap} privateMode={privateMode} historyVersion={historyVersion} onBack={() => setPanelView('members')} onPreview={setPreview} onJump={jumpToMessage} />
        : panelView === 'history'
        ? <HistorySearch room={room} userMap={userMap} members={groupMembers} privateMode={privateMode} historyVersion={historyVersion} onBack={() => setPanelView('members')} onJump={jumpToMessage} />
        : <><div className="members-panel-heading"><h3>{classic ? '聊天信息' : '会话成员'} <small>{groupMembers.length}</small></h3><IconButton icon={X} label="关闭成员面板" size={15} onClick={() => setShowMembers(false)} /></div>{room.kind === 'group' && <button className="add-member-button" onClick={() => setModal('addMembers')}><UserPlus size={15} />邀请成员</button>}{canManageRoomBots && <button className="add-member-button" onClick={() => setModal('addBot')}><Bot size={15} />添加机器人</button>}<button className="history-entry" onClick={() => setPanelView('history')}><MessagesSquare size={16} /><span>聊天记录</span><ChevronRight size={14} /></button><button className="history-entry" onClick={() => setPanelView('files')}><Images size={16} /><span>图片与文件</span><ChevronRight size={14} /></button><button className="history-entry" onClick={() => downloadExport(room.id)}><Download size={16} /><span>导出聊天记录</span></button>
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
            {groupOwner === state.me.id && <button className="history-entry" onClick={() => setGroupAction({ type: 'webhooks' })}><Bot size={16} /><span>群机器人（Webhook）</span><ChevronRight size={14} /></button>}
            <section className="announcement-card" aria-label="群公告"><div className="announcement-heading"><Megaphone size={14} /><b>群公告</b>{isGroupManager && <button className="text-button" onClick={() => setGroupAction({ type: 'announcement' })}>{room.announcement ? '编辑' : '发布'}</button>}</div>
              <p>{room.announcement?.text || '暂无公告'}</p></section>
          </>}
          {room.kind === 'public' && (isOwner || isAdmin) && <button className="history-entry" onClick={() => setGroupAction({ type: 'webhooks' })}><Bot size={16} /><span>大厅机器人</span><ChevronRight size={14} /></button>}
          {listeningBots.length > 0 && <p className="bot-listening-note" role="note"><Bot size={14} aria-hidden="true" /><span>{listeningBots.map(user => `「${user.name}」`).join('、')}会接收这里的全部消息，不只是 @它的消息。</span></p>}
          <div className="members-list">{groupMembers.map(user => memberRow(user, 30, room.kind === 'group', true, true))}</div>
          {room.kind === 'group' && <button className="leave-group" onClick={() => setGroupAction({ type: 'leave' })}><LogOut size={15} />退出群聊</button>}</>}</aside>}</div>
      </> : <div className="empty-conversation"><MessageCircle size={32} /><h2>选择一个对话</h2><button className="secondary-button" onClick={() => setModal('members')}>发起私聊</button></div>}
    </main>
    {modal === 'profile' && <ProfileDialog me={{ ...state.me, ...userMap[state.me.id] }} onClose={() => setModal(null)} onUpdate={updateMe} notify={notify} />}
    {modal === 'roomAvatar' && room && room.kind !== 'direct' && <RoomAvatarDialog key={room.id} room={room} onClose={() => setModal(null)} onSaved={refresh} notify={notify} />}
    {modal === 'invite' && <InviteDialog cloud={cloud} onClose={() => setModal(null)} notify={notify} />}
    {modal === 'admin' && cloud && isAdmin && <AdminDialog me={state.me} onClose={() => setModal(null)} onUpdated={refresh} notify={notify} />}
    {modal === 'password' && <Modal title="修改密码" subtitle="修改后，其他设备需要重新登录。" onClose={() => setModal(null)}><PasswordForm onChanged={() => location.reload()} /></Modal>}
    {['group', 'addMembers'].includes(modal) && <GroupDialog users={state.users.filter(user => !user.removed && !user.bot)} me={state.me} room={modal === 'addMembers' ? room : null} onClose={() => setModal(null)} onCreated={async id => { await refresh(); openRoom(id); }} notify={notify} />}
    {modal === 'connection' && <SettingsDialog appLock={appLock} pushSettings={{ muted: mutedKey ? mutedKey.split(',') : [], private: privateMode }} phrases={state.phrases || []} onPhrases={async list => applyPhrases((await api('phrases', { phrases: list })).phrases)} onSetStatus={() => setModal('status')} keywords={state.keywords || []} onKeywords={async list => applyKeywords((await api('keywords', { keywords: list })).keywords)} onShortcuts={() => setModal('shortcuts')} chatPrefs={chatPrefs} onChatPrefs={setChatPrefs} privateMode={privateMode} onPrivateMode={changePrivacy} onEditProfile={() => setModal('profile')} appearance={appearance} onAppearance={setAppearance} skin={skin} onSkin={setSkin} onChanged={refresh} onAudit={(cloud ? isAdmin : isOwner) ? () => setModal('audit') : undefined} onBots={(cloud ? isAdmin : isOwner) ? () => setModal('bots') : undefined} theme={theme} onTheme={setTheme} update={update} onUpdate={setUpdate} connected={connected} me={state.me} workspace={state.workspace} onPassword={() => setModal('password')} onLogout={logout} loggingOut={loggingOut} onCleared={result => { syncHistory([], result.throughSeq); return refresh(); }} onClose={() => setModal(null)} notify={notify} />}
    {modal === 'members' && <Modal title="通讯录" subtitle={`${state.users.filter(user => !user.removed && !user.bot).length} 位成员，${online.length} 人在线。单击查看资料，双击直接私聊。`} onClose={() => setModal(null)} className="contacts-dialog">
      <label className="sidebar-search contacts-search"><Search size={14} /><input autoFocus aria-label="搜索成员" placeholder="搜索名字、部门或签名" value={contactQuery} onChange={event => setContactQuery(event.target.value)} /></label>
      <div className="space-members">{contactGroups.map(([department, members]) => <section key={department} aria-label={department}><h4 className="contacts-group">{department}<small>{members.length}</small></h4>{members.map(user => memberRow(user, 32, false, true))}</section>)}
        {!contactGroups.length && <p className="history-empty">没有找到「{contactQuery.trim()}」</p>}</div>
      <div className="modal-footer"><button className="secondary-button" onClick={() => setModal('invite')}><UserPlus size={15} />邀请新同事</button></div></Modal>}
    {preview && !privateMode && (() => {
      // 没揭开的剧透图不进左右翻页。
      // 阅后即焚的图片不进左右翻页，单独看；倒计时到点或销毁时看图窗口跟着关掉（见上面的 effect）。
      const images = preview.burnId ? [preview] : (previewImages?.some(file => file.id === preview.id) ? previewImages : currentMessages.filter(message => !message.recalledAt && !message.burn).flatMap(message => message.attachments.filter(file => file.mime.startsWith('image/'))))
        .filter(file => file.id === preview.id || !coveredMedia(file));
      const index = Math.max(0, images.findIndex(file => file.id === preview.id));
      return <ImageViewer images={images.length ? images : [preview]} index={images.length ? index : 0} onIndex={next => setPreview(images[next])} onClose={() => setPreview(null)} notify={notify} />;
    })()}
    {removing && <RemoveMemberDialog user={removing} onClose={() => setRemoving(null)} onRemoved={async () => { setRemoving(null); await refresh(); notify("成员已移除，邀请码已更新"); }} />}
    {/* 从通讯录等弹窗里打开时，资料卡要挂在弹窗里面，否则会被弹窗挡住 */}
    {profileCard && userMap[profileCard.userId] && createPortal(<ProfileCard key={profileCard.userId} user={userMap[profileCard.userId]} anchor={profileCard} self={profileCard.userId === state.me.id} onClose={closeProfile}
      note={state.notes?.[profileCard.userId] || ''} onSaveNote={note => saveNote(userMap[profileCard.userId], note)}
      onMessage={() => { setProfileCard(null); directMessage(userMap[profileCard.userId]); }} onSetStatus={() => { setProfileCard(null); setModal('status'); }}
      groupNickname={nicknames[profileCard.userId]}
      groupActions={room?.kind === 'group' && profileCard.userId !== state.me.id && room.members.includes(profileCard.userId) ? groupActionsFor(userMap[profileCard.userId])
        : canManageRoomBots && (room.bots || []).includes(profileCard.userId) ? [{ label: '移出机器人', danger: true, action: () => { setProfileCard(null); setGroupAction({ type: 'removeBot', user: userMap[profileCard.userId] }); } }] : []}
      onSetDepartment={(cloud ? isAdmin : isOwner) && profileCard.userId !== state.me.id && !userMap[profileCard.userId].bot ? async department => { try { await api('admin/department', { userId: profileCard.userId, department }); notify('部门已更新'); } catch (error) { notify(error.message); throw error; } } : undefined}
      onNudge={room && !userMap[profileCard.userId].bot && !peer?.bot && (room.kind === 'public' || room.members.includes(profileCard.userId)) && !state.me.muted ? () => { setProfileCard(null); nudge(userMap[profileCard.userId]); } : undefined} onShare={userMap[profileCard.userId].bot ? undefined : () => { setProfileCard(null); setSharingCard(userMap[profileCard.userId]); }} onEdit={() => { setProfileCard(null); setModal('profile'); }} />, document.querySelector('dialog[open]') || document.body)}
    {readDetail && currentMessages.some(message => message.id === readDetail.id) && <ReadDetail anchor={readDetail} message={currentMessages.find(message => message.id === readDetail.id)} members={groupMembers.filter(user => user.id !== state.me.id && !user.bot)} onClose={closeReadDetail}
      onOpenProfile={(user, element) => { openProfile(user, element); setReadDetail(null); }} />}
    {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}
    {hiding && <ConfirmDialog title={hiding.length > 1 ? `删除这 ${hiding.length} 条消息？` : '删除这条消息？'} subtitle="只从你这里删除，会话里的其他人仍然能看到。" confirmLabel="删除" busyLabel="正在删除…" danger
      onConfirm={async () => { const result = await api('messages/hide', { messageIds: hiding }); hideLocally({ messageIds: result.messageIds }); setSelection(null); await refresh(); notify('已删除'); }} onClose={() => setHiding(null)} />}
    {clearing && <ConfirmDialog title={`清空「${clearing.name}」的聊天记录？`} subtitle="只清空你这里的记录，会话里的其他人不受影响；之后的新消息照常显示。" confirmLabel="清空" busyLabel="正在清空…" danger
      onConfirm={async () => { const result = await api('room-clear', { roomId: clearing.id }); scrollSpots.current.delete(result.roomId); hideLocally({ cleared: { [result.roomId]: result.throughSeq } }); setLastRead(previous => ({ ...previous, [result.roomId]: Math.max(previous[result.roomId] || 0, result.throughSeq) })); await refresh(); notify('聊天记录已清空'); }} onClose={() => setClearing(null)} />}
    {removingMessage && <ConfirmDialog title="删除这条消息？" subtitle={`会话里的所有人都会看到「管理员删除了一条消息」，内容无法恢复。这次操作会记入操作日志。`} confirmLabel="删除" busyLabel="正在删除…" danger
      onConfirm={async () => { const { message } = await api('admin/delete-message', { messageId: removingMessage.id }); syncHistory([message]); applyEdit(message); notify('消息已删除'); }} onClose={() => setRemovingMessage(null)} />}
    {modal === 'audit' && <AuditDialog onClose={() => setModal(null)} />}
    {openBundle && <BundleDialog message={openBundle} privateMode={privateMode} userOf={id => userMap[id]} onPreview={(file, images) => { setPreviewImages(images); setPreview(file); }} onClose={() => { setOpenBundle(null); setPreviewImages(null); }} />}
    {mutingUser && <MuteDialog user={mutingUser} onClose={() => setMutingUser(null)} onDone={() => notify(`已禁言「${mutingUser.name}」`)} />}
    {scheduleText !== null && room && <ScheduleDialog room={room} initialText={scheduleText} onClose={() => setScheduleText(null)} onScheduled={when => { notify(`将在 ${when} 发送`); loadScheduled(room.id); }} />}
    {modal === 'scheduled' && <ScheduledListDialog items={scheduled.items} onClose={() => setModal(null)} onCancel={async item => { try { await api('scheduled/cancel', { id: item.id }); await loadScheduled(item.roomId); notify('已取消发送'); } catch (error) { notify(error.message); } }} />}
    {reminding && <ReminderDialog message={reminding} notify={notify} onClose={() => setReminding(null)} />}
    {modal === 'poll' && room && <PollDialog room={room} onClose={() => setModal(null)} onCreated={message => { sticky.current = true; setReturnSpot(null); receive(message); }} />}
    {modal === 'chain' && room && room.kind !== 'direct' && <ChainDialog room={room} onClose={() => setModal(null)} onCreated={message => { sticky.current = true; setReturnSpot(null); receive(message); }} />}
    {chainEntry && (() => {
      const target = (messages[chainEntry.roomId] || []).find(message => message.id === chainEntry.id) || threadMessages.current.find(message => message.id === chainEntry.id);
      return target?.chain && !target.recalledAt ? <ChainEntryDialog message={target} viewerId={state.me.id} onClose={() => setChainEntry(null)} onChanged={result => { applyChain(result); }} /> : null;
    })()}
    {modal === 'activity' && <Modal title="提到我的" subtitle="别人 @你、回复你、回应你的消息。点一条回到原来的位置。" onClose={() => setModal(null)}>
      {!activity ? <div className="history-results saved-list activity-list"><Skeleton rows={4} /></div> : !activity.items.length ? <p className="inline-note">还没有人提到你。</p> : <div className="history-results saved-list activity-list">
        {activity.items.map(item => {
          const actor = displayUser(userMap[item.actorId]), target = rooms.find(candidate => candidate.id === item.message.roomId);
          const verb = { mention: '@了你', reply: '回复了你', thread: '在话题里回复了你', reaction: `回应了 ${item.emoji}` }[item.kind];
          return <SearchResult key={`${item.kind}:${item.message.id}:${item.actorId}:${item.emoji || ''}`} message={item.message} term="" at={item.at} prefix={item.kind === 'reaction' ? '你的消息：' : ''}
            avatar={<Avatar user={actor} size={24} />} title={`${actor?.name || '成员'} ${verb}${target ? ` · ${target.name}` : ''}`} privateMode={privateMode} onJump={message => { setModal(null); jumpToMessage(message); }} />;
        })}
        {activity.hasMore && <button type="button" className="text-button load-more" onClick={() => loadActivity(true)}>加载更多</button>}
      </div>}
    </Modal>}
    {modal === 'saved' && <Modal title="收藏" subtitle="只有你自己看得到。点一条可以回到原来的会话。" onClose={() => setModal(null)}>
      {!saved.length ? <p className="inline-note">还没有收藏。在消息上点右键，选「收藏」。</p> : <div className="history-results saved-list">{saved.map(item => {
        const target = rooms.find(candidate => candidate.id === item.message.roomId);
        return <div className="saved-row" key={item.message.id}><SearchResult message={item.message} term="" avatar={<Avatar user={userMap[item.message.senderId]} size={24} />}
          title={`${userMap[item.message.senderId]?.name || item.message.bot || '成员'}${target ? ` · ${target.name}` : ''}`} privateMode={privateMode} onJump={message => { setModal(null); jumpToMessage(message); }} />
          <IconButton icon={X} label="取消收藏" size={14} onClick={() => toggleSaved(item.message, false)} /></div>;
      })}</div>}
    </Modal>}
    {groupAction?.type === 'webhooks' && room && room.kind !== 'direct' && <WebhooksDialog room={room} notify={notify} onClose={() => setGroupAction(null)} />}
    {modal === 'bots' && (cloud ? isAdmin : isOwner) && <BotsDialog notify={notify} onChanged={refresh} onClose={() => setModal(null)} />}
    {modal === 'addBot' && room && canManageRoomBots && <RoomBotsDialog room={room} bots={state.users.filter(user => user.bot)} notify={notify} onAdded={refresh} onClose={() => setModal(null)} />}
    {groupAction?.type === 'removeBot' && room && <ConfirmDialog title={`把机器人「${groupAction.user.name}」移出${room.kind === 'public' ? '大厅' : `「${room.name}」`}？`} subtitle="移出后它收不到这里的消息，也不能再在这里发言。会话里会留一行提示。" confirmLabel="移出" busyLabel="正在移出…" danger
      onConfirm={async () => { await api('room-bots', { roomId: room.id, botId: groupAction.user.id, add: false }); await refresh(); notify(`已把「${groupAction.user.name}」移出`); }} onClose={() => setGroupAction(null)} />}
    {groupAction?.type === 'name' && room?.kind === 'group' && <GroupEditDialog room={room} field="name" onClose={() => setGroupAction(null)} onSaved={refresh} />}
    {groupAction?.type === 'announcement' && room?.kind === 'group' && <GroupEditDialog room={room} field="announcement" onClose={() => setGroupAction(null)} onSaved={refresh} />}
    {groupAction?.type === 'remove' && room && <ConfirmDialog title={`把「${groupAction.user.name}」移出「${room.name}」？`} subtitle="移出后对方看不到这个群的新消息，需要重新邀请才能回来。" confirmLabel="移出" busyLabel="正在移出…" danger
      onConfirm={async () => { await api('room-remove', { roomId: room.id, userId: groupAction.user.id }); await refresh(); notify(`已把「${groupAction.user.name}」移出群聊`); }} onClose={() => setGroupAction(null)} />}
    {groupAction?.type === 'transfer' && room && <ConfirmDialog title={`把群主转让给「${groupAction.user.name}」？`} subtitle="转让后，你会变成普通成员，不能再设置管理员和转让群主。" confirmLabel="确认转让" busyLabel="正在转让…"
      onConfirm={async () => { await api('room-owner', { roomId: room.id, userId: groupAction.user.id }); await refresh(); notify('群主已转让'); }} onClose={() => setGroupAction(null)} />}
    {groupAction?.type === 'leave' && room && <ConfirmDialog title={`退出「${room.name}」？`} subtitle={groupOwner === state.me.id ? '你是群主，退出后群主会自动转给最早加入的成员。退出后将看不到这个群的消息。' : '退出后将看不到这个群的消息，需要群里的人重新邀请才能回来。'} confirmLabel="退出群聊" busyLabel="正在退出…" danger
      onConfirm={async () => { await api('room-leave', { roomId: room.id }); setSelected('lobby'); setShowMembers(false); await refresh(); notify('已退出群聊'); }} onClose={() => setGroupAction(null)} />}
    {switcher && <QuickSwitcher rooms={ordered} icon={target => roomIcon(target, 24)} unread={unread} onOpen={id => { setSwitcher(false); openRoom(id); }} onClose={() => setSwitcher(false)} />}
    {quoting && <Modal title="引用部分文字" subtitle="选中要引用的那一段，再点「引用」；不选就引用整条。" onClose={() => setQuoting(null)}>
      <textarea ref={quoteArea} className="quote-select" aria-label="消息内容" readOnly rows={6} value={plainText(quoting.text)} />
      <div className="modal-footer"><button type="button" className="secondary-button" onClick={() => setQuoting(null)}>取消</button>
        <button type="button" className="primary-button" onClick={() => { const node = quoteArea.current, part = node.value.slice(node.selectionStart, node.selectionEnd).trim();
          // 选中的一段碰到剧透就不能引用：在这里拦下，不让它发出去再被服务端拒绝、卡在发件箱里。
          if (part && !quotable(quoting.text, part.slice(0, 500))) return notify('选中的文字里有剧透，不能引用；换一段，或者不选、引用整条');
          setEditing(null); setReplying({ roomId: quoting.roomId, id: quoting.id, quote: part.slice(0, 500) }); setQuoting(null); }}>引用</button></div>
    </Modal>}
    {incomingShare && <ShareTargetDialog share={incomingShare} rooms={rooms.filter(target => !target.hidden)} icon={target => roomIcon(target, 32)} onClose={() => setIncomingShare(null)}
      onPick={target => { const share = incomingShare; setIncomingShare(null); openRoom(target.id); setMobileChat(true); setInjectShare({ roomId: target.id, text: share.text, files: share.files, nonce: Date.now() }); }} />}
    {filePreview && <TextPreviewDialog file={filePreview} onClose={() => setFilePreview(null)} />}
    {sharingCard && <ForwardDialog count={1} title={`推荐「${displayUser(sharingCard)?.name || sharingCard.name}」的名片`} subtitle="对方点开名片就能看到资料卡、发起私聊。" rooms={rooms.filter(target => !target.hidden)} icon={target => roomIcon(target, 32)} onClose={() => setSharingCard(null)}
      onForward={async (targets, _merge, comment) => {
        const failed = [];
        for (const target of targets) {
          if (burnModes[target.id]) { failed.push(`「${target.name}」开着阅后即焚，不能推荐名片`); continue; }
          try {
            const { message } = await api('contact-card', { roomId: target.id, userId: sharingCard.id });
            if (target.id === selected) receive(message);
            if (comment) { const extra = await api('messages', { roomId: target.id, text: comment, clientId: uid() }); if (target.id === selected) receive(extra.message); }
          } catch (error) { failed.push(`「${target.name}」：${error.message}`); }
        }
        await refresh();
        if (failed.length === targets.length) throw new Error(failed.join('；'));
        notify(failed.length ? `已推荐到 ${targets.length - failed.length} 个会话；${failed.join('；')}` : '名片已发送');
      }} />}
    {forwarding && <ForwardDialog count={forwarding.length} initialMerge={forwardMerge} rooms={rooms.filter(target => !target.hidden)} icon={target => roomIcon(target, 32)} onClose={() => setForwarding(null)} onForward={forwardTo} />}
    {editingFolder && <FolderDialog folder={editingFolder === 'new' ? null : editingFolder} rooms={rooms.filter(target => !target.hidden)} icon={target => roomIcon(target, 28)}
      onSave={(name, roomIds) => saveFolder(editingFolder === 'new' ? null : editingFolder, name, roomIds)} onDelete={() => deleteFolder(editingFolder)} onClose={() => setEditingFolder(null)} />}
    {modal === 'status' && <StatusDialog status={activeStatus(userMap[state.me.id])} notify={notify} onClose={() => setModal(null)} />}
    {modal === 'shortcuts' && <ShortcutsDialog sendKey={chatPrefs.sendKey} onClose={() => setModal(null)} />}
    {historyFor && <EditHistoryDialog message={historyFor} onClose={() => setHistoryFor(null)} />}
    {recalling && <RecallDialog message={recalling} onClose={() => setRecalling(null)} onRecalled={message => {
      syncHistory([message]); notify('消息已撤回');
      if (recalling.text?.trim() && !recalling.burn) { setRecalledTexts(previous => ({ ...previous, [message.id]: { text: recalling.text } })); setTimeout(() => forgetRecalled(message.id), 10 * 60000); }
    }} />}
    {toastElement}
  </div></>;
}

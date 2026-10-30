import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Users, Settings2, Search, Plus, Hash, Eye, EyeOff, WifiOff, UserPlus, ChevronLeft, ChevronRight, ArrowDown, X, Check, LoaderCircle, RefreshCw } from 'lucide-react';
import { api, formatTime, mediaUrl } from './api';
import { Avatar, IconButton, Logo, Message, Modal, PrivatePreview, MessageContextMenu } from './components';
import Onboarding from './Onboarding';
import Composer from './Composer';
import { ProfileDialog, InviteDialog, GroupDialog, ConnectionDialog, RemoveMemberDialog, RecallDialog } from './dialogs';
import useUnread from './useUnread';
import useChatSession from './useChatSession';
import useDesktopBridge from './useDesktopBridge';
import { previewText, readStorage } from './history';

export default function App() {
  const [selected, setSelected] = useState('lobby');
  const [lastRead, setLastRead] = useState(() => readStorage('linliao.read', {}));
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [recalling, setRecalling] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [showMembers, setShowMembers] = useState(false);
  const [preview, setPreview] = useState(null);
  const [toast, setToast] = useState('');
  const [scrolledUp, setScrolledUp] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const toastTimer = useRef();
  const messageList = useRef();
  const messageContent = useRef();
  const sticky = useRef(true);
  const firstLoad = useRef(true);
  const notify = useCallback(text => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3500); }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const { privateMode, privacyRef, changePrivacy, windowActive } = useDesktopBridge({ notify, onPendingRoom: setSelected,
    onOpenRoom: roomId => { setSelected(roomId); setMobileChat(true); setModal(null); setSearch(''); } });
  const onHistoryChanged = useCallback(({ cleared }) => {
    if (cleared) { setScrolledUp(false); sticky.current = true; }
    setPreview(null); setContextMenu(null); setRecalling(null);
  }, []);
  const { bootstrap, state, startupError, start, refresh, messages, hasMore, loading, connected, historyVersion,
    syncHistory, receive, markMessageRead, loadOlder: fetchOlder, updateMe } = useChatSession({ selected, notify, privacyRef, onHistoryChanged });
  useEffect(() => {
    if (!state?.me.id) return;
    firstLoad.current = true; sticky.current = true; setScrolledUp(false);
  }, [selected, state?.me.id]);
  const currentMessages = messages[selected] || [];
  const lastSeq = currentMessages.at(-1)?.seq;
  const unread = useUnread(state, messages, lastRead, connected, historyVersion);
  useEffect(() => {
    if (!messageList.current || loading) return;
    if (firstLoad.current || sticky.current) { messageList.current.scrollTop = messageList.current.scrollHeight; firstLoad.current = false; }
    if (lastSeq && windowActive && !scrolledUp && !modal && !preview) setLastRead(previous => lastSeq > (previous[selected] || 0) ? { ...previous, [selected]: lastSeq } : previous);
  }, [selected, lastSeq, loading, privateMode, windowActive, scrolledUp, modal, preview]);
  // 图片加载、已读回执等让内容变高时，仍停在最新消息处。
  useEffect(() => {
    const list = messageList.current, content = messageContent.current;
    if (!list || !content) return;
    const observer = new ResizeObserver(() => { if (sticky.current) list.scrollTop = list.scrollHeight; });
    observer.observe(content);
    return () => observer.disconnect();
  }, [state?.me.id, state?.rooms.length]);
  const unreadRooms = JSON.stringify(state?.rooms.filter(room => unread[room.id]?.hasUnread).map(room => room.id) || []);
  useEffect(() => {
    window.desktop?.activity?.({ currentRoomId: state?.me.id ? selected : null, unreadRooms: JSON.parse(unreadRooms) }).catch(error => notify(error.message));
  }, [unreadRooms, selected, state?.me.id, notify]);
  useEffect(() => { localStorage.setItem('linliao.read', JSON.stringify(lastRead)); }, [lastRead]);
  useEffect(() => { if (privateMode) setPreview(null); }, [privateMode]);
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  async function loadOlder() {
    const previousHeight = messageList.current.scrollHeight;
    if (await fetchOlder()) requestAnimationFrame(() => { if (messageList.current) messageList.current.scrollTop += messageList.current.scrollHeight - previousHeight; });
  }
  async function directMessage(user) {
    if (user.id === state.me.id) return setModal('profile');
    try { const result = await api('rooms', { userId: user.id }); await refresh(); setSelected(result.id); setMobileChat(true); setModal(null); }
    catch (error) { notify(error.message); }
  }
  const toastElement = toast && <div className="toast" role="status"><Check size={15} />{toast}</div>;
  if (startupError) return <div className="startup-state"><Logo /><h2>稍等，连接有点慢</h2><p>{startupError}</p><div className="startup-actions"><button className="primary-button" onClick={start}><RefreshCw size={15} />重新连接</button>{window.desktop && <button className="secondary-button" onClick={() => window.desktop.home()}>返回本机空间</button>}</div></div>;
  if (!bootstrap) return <div className="startup-state"><Logo /><p>正在连接虾扯蛋…</p><LoaderCircle className="spin" size={18} /></div>;
  if (!state?.me) return <><Onboarding bootstrap={bootstrap} onJoined={refresh} notify={notify} />{toastElement}</>;
  const userMap = Object.fromEntries(state.users.map(user => [user.id, user]));
  const peerOf = room => userMap[room.members.find(id => id !== state.me.id)];
  const roomName = room => room.kind === 'direct' ? peerOf(room)?.name || '私聊' : room.name;
  const rooms = state.rooms.map(room => ({ ...room, name: roomName(room) }));
  const room = rooms.find(room => room.id === selected) || rooms[0];
  if (!room) return <div className="startup-state"><LoaderCircle className="spin" size={18} /><p>正在加载会话…</p></div>;
  const groupMembers = room.kind === 'public' ? state.users.filter(user => !user.removed) : state.users.filter(user => !user.removed && room.members.includes(user.id));
  const online = state.users.filter(user => !user.removed && user.online);
  const filtered = rooms.filter(room => room.name.toLowerCase().includes(search.toLowerCase()));
  const peer = room.kind === 'direct' ? peerOf(room) : null;
  const isOwner = state.workspace.ownerId === state.me.id;
  const roomIcon = (target, size = 32) => target.kind === 'direct' ? <Avatar user={peerOf(target)} size={size} online={peerOf(target)?.online} /> : <span className="room-avatar">{target.kind === 'public' ? <Hash size={16} /> : <Users size={16} />}</span>;
  const openRoom = id => { setSelected(id); setMobileChat(true); };
  const roomButton = target => {
    const status = unread[target.id];
    const label = status?.exact ? `${status.count} 条未读消息` : '有新消息';
    return <button className={`conversation ${selected === target.id ? 'active' : ''} ${status?.hasUnread ? 'has-unread' : ''}`} key={target.id} data-room-id={target.id} aria-current={selected === target.id ? 'page' : undefined} onClick={() => openRoom(target.id)}>
      {roomIcon(target)}<span className="conversation-copy"><span className="conversation-title"><span className="conversation-name">{target.name}</span><time>{target.lastMessage ? formatTime(target.lastMessage.createdAt) : ''}</time></span>
        <span className="conversation-preview"><PrivatePreview privateMode={privateMode && Boolean(target.lastMessage)}>{previewText(target.lastMessage)}</PrivatePreview>{status?.hasUnread && <span className="unread-badge" aria-label={label} title={label}>{status.exact ? status.count > 99 ? '99+' : status.count : '新'}</span>}</span>
      </span>
    </button>;
  };
  const memberRow = (user, size) => <div className="managed-member" key={user.id}><button className="member-row" onClick={() => directMessage(user)}><Avatar user={user} size={size} online={user.online} /><span className="member-name">{user.name}{user.id === state.me.id && <small className="me-tag">我</small>}</span><small>{user.online ? '在线' : '离线'}</small><ChevronRight size={14} /></button>{isOwner && user.id !== state.me.id && <button className="remove-member" onClick={() => setRemoving(user)} aria-label={`从空间移除${user.name}`}>移除</button>}</div>;
  const subtitle = room.kind === 'direct' ? peer?.online ? '在线' : '离线 · 上线后送达' : `${groupMembers.length} 位成员 · ${groupMembers.filter(user => user.online).length} 人在线`;
  const sameGroup = (previous, message) => previous && !previous.recalledAt && !message.recalledAt && previous.senderId === message.senderId &&
    new Date(previous.createdAt).toDateString() === new Date(message.createdAt).toDateString() && message.createdAt - previous.createdAt < 5 * 60000;
  return <div className={`app ${privateMode ? 'privacy-on' : ''} ${window.desktop ? 'native' : ''} ${mobileChat ? 'show-chat' : ''}`} data-screen-label="虾扯蛋聊天空间">
    <aside className="sidebar glass" aria-label="会话列表">
      <div className="space-heading"><div className="space-copy"><h1>{state.workspace.name}</h1><p><i className={`status-dot ${connected ? 'online' : ''}`} />{online.length} 人在线</p></div><IconButton icon={UserPlus} label="邀请同事" onClick={() => setModal('invite')} /></div>
      <label className="sidebar-search"><Search size={14} /><input aria-label="搜索会话" placeholder="搜索" value={search} onChange={event => setSearch(event.target.value)} />{search && <IconButton icon={X} label="清空搜索" size={14} onClick={() => setSearch('')} />}</label>
      <nav className="conversation-scroll" aria-label="会话">
        <div className="section-label"><span>群聊</span><IconButton icon={Plus} label="新建群聊" size={15} onClick={() => setModal('group')} /></div>{filtered.filter(room => room.kind !== 'direct').map(roomButton)}
        <div className="section-label"><span>私聊</span><IconButton icon={Plus} label="发起私聊" size={15} onClick={() => setModal('members')} /></div>{filtered.filter(room => room.kind === 'direct').map(roomButton)}
        {!filtered.some(room => room.kind === 'direct') && <p className="sidebar-empty">{search ? '没有匹配的私聊' : '找到一位同事，聊点新鲜事。'}</p>}
      </nav>
      <div className="me-card"><button className="me-profile" title="修改昵称和头像" onClick={() => setModal('profile')}><Avatar user={state.me} size={30} /><span><b>{state.me.name}</b><small className={connected ? '' : 'warning'}>{connected ? '局域网已连接' : '正在重新连接…'}</small></span></button><IconButton icon={Settings2} label="连接与空间" onClick={() => setModal('connection')} /></div>
    </aside>
    <main className="chat-main">
      <div className="conversation-body"><section className="chat-column">
        <header className="chat-toolbar">
          <IconButton icon={ChevronLeft} label="返回会话列表" className="back-button glass" onClick={() => setMobileChat(false)} />
          <div className="toolbar-title glass"><span className="toolbar-icon">{room.kind === 'public' ? <Hash size={15} /> : room.kind === 'group' ? <Users size={15} /> : <Avatar user={peer} size={20} online={peer?.online} />}</span><h2>{room.name}</h2><span className="toolbar-subtitle">{subtitle}</span></div>
          <div className="toolbar-actions">
            <button className={`toolbar-button glass privacy-toggle ${privateMode ? 'enabled' : ''}`} onClick={() => changePrivacy(value => !value)} role="switch" aria-checked={privateMode} aria-label="隐私模式" title="隐私模式 · ⌘⇧P · 悬停消息查看内容">{privateMode ? <EyeOff size={16} /> : <Eye size={16} />}<kbd>⌘⇧P</kbd></button>
            <button className={`toolbar-button glass member-count ${showMembers ? 'selected' : ''}`} onClick={() => setShowMembers(value => !value)} aria-pressed={showMembers} aria-label={`会话成员，${groupMembers.length} 人`} title="会话成员"><span className="avatar-stack">{groupMembers.slice(0, 3).map(user => <Avatar key={user.id} user={user} size={20} />)}</span><span>{groupMembers.length}</span></button>
          </div>
        </header>
        {!connected && <div className="offline-pill glass" role="status"><WifiOff size={14} />正在重新连接，草稿会保留</div>}
        <div className="message-scroll" ref={messageList} onScroll={event => { const node = event.currentTarget; sticky.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; setScrolledUp(!sticky.current); }}><div className="message-list" ref={messageContent}>
        {hasMore[selected] && <button className="load-older" onClick={loadOlder} disabled={loading}>{loading ? '正在加载…' : '查看更早的消息'}</button>}
        {!hasMore[selected] && <div className={`channel-welcome ${currentMessages.length ? 'has-messages' : ''}`}><span className="welcome-icon">{room.kind === 'public' ? <Hash size={22} /> : room.kind === 'group' ? <Users size={22} /> : <MessageCircle size={22} />}</span><h3>{room.kind === 'public' ? '同一个网络，随便扯两句。' : room.kind === 'group' ? `欢迎来到「${room.name}」` : `和${room.name}聊聊吧`}</h3><p>{room.kind === 'public' ? '工作、日常、好玩的，都可以往这里丢。' : room.kind === 'group' ? '文字、图片、视频，把想分享的都留在这里。' : '有些话，适合只对一个人说。'}</p>{room.kind === 'public' && !currentMessages.length && <button className="secondary-button" onClick={() => setModal('invite')}><UserPlus size={15} />邀请同事加入</button>}</div>}
        {!currentMessages.length && loading && <div className="messages-loading"><LoaderCircle className="spin" size={17} />正在加载消息…</div>}
        {currentMessages.map((message, index) => { const previous = currentMessages[index - 1]; const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString(); return <React.Fragment key={message.id}>{newDay && <div className="date-divider"><span>{new Date(message.createdAt).toDateString() === new Date().toDateString() ? '今天' : new Date(message.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span></div>}<Message onContextMenu={(event, message) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, message }); }} message={message} user={userMap[message.senderId]} mine={message.senderId === state.me.id} continued={!newDay && sameGroup(previous, message)} privateMode={privateMode} onPreview={setPreview} viewerId={state.me.id} readingEnabled={windowActive && !modal && !removing && !recalling && !contextMenu && !preview && !loading} onRead={markMessageRead} recipients={groupMembers.filter(user => user.id !== state.me.id).map(user => user.id)} direct={room.kind === 'direct'} /></React.Fragment>; })}
      </div></div>{scrolledUp && <button className="jump-to-latest glass" onClick={() => { sticky.current = true; messageList.current.scrollTo({ top: messageList.current.scrollHeight, behavior: 'smooth' }); }}><ArrowDown size={14} />回到最新消息</button>}
      <Composer room={room} connected={connected} onSent={message => { sticky.current = true; receive(message); }} notify={notify} /></section>
      {showMembers && <aside className="members-panel glass" aria-label="会话成员"><div className="members-panel-heading"><h3>会话成员 <small>{groupMembers.length}</small></h3><IconButton icon={X} label="关闭成员面板" size={15} onClick={() => setShowMembers(false)} /></div>{room.kind === 'group' && <button className="add-member-button" onClick={() => setModal('addMembers')}><UserPlus size={15} />邀请成员</button>}<div className="members-list">{groupMembers.map(user => memberRow(user, 30))}</div></aside>}</div>
    </main>
    {modal === 'profile' && <ProfileDialog me={state.me} onClose={() => setModal(null)} onUpdate={updateMe} notify={notify} />}
    {modal === 'invite' && <InviteDialog onClose={() => setModal(null)} notify={notify} />}
    {['group', 'addMembers'].includes(modal) && <GroupDialog users={state.users.filter(user => !user.removed)} me={state.me} room={modal === 'addMembers' ? room : null} onClose={() => setModal(null)} onCreated={async id => { await refresh(); openRoom(id); }} notify={notify} />}
    {modal === 'connection' && <ConnectionDialog connected={connected} me={state.me} workspace={state.workspace} onCleared={result => { syncHistory([], result.throughSeq); return refresh(); }} onClose={() => setModal(null)} notify={notify} />}
    {modal === 'members' && <Modal title="空间成员" subtitle={`${state.users.filter(user => !user.removed).length} 位成员，${online.length} 人在线。点一位成员开始私聊。`} onClose={() => setModal(null)}><div className="space-members">{state.users.filter(user => !user.removed).map(user => memberRow(user, 32))}</div><div className="modal-footer"><button className="secondary-button" onClick={() => setModal('invite')}><UserPlus size={15} />邀请新同事</button></div></Modal>}
    {preview && !privateMode && <Modal title={preview.name} onClose={() => setPreview(null)} wide><img className="lightbox-image" src={mediaUrl(preview.id)} alt={preview.name} /></Modal>}
    {removing && <RemoveMemberDialog user={removing} onClose={() => setRemoving(null)} onRemoved={async () => { setRemoving(null); await refresh(); notify("成员已移除，邀请码已更新"); }} />}
    {contextMenu && <MessageContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} onRecall={() => { setRecalling(contextMenu.message); setContextMenu(null); }} />}
    {recalling && <RecallDialog message={recalling} onClose={() => setRecalling(null)} onRecalled={message => { syncHistory([message]); notify('消息已撤回'); }} />}
    {toastElement}
  </div>;
}

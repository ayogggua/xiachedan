import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Users, Settings2, Search, Plus, Hash, Eye, EyeOff, Wifi, WifiOff, UserPlus, ChevronDown, ChevronRight, ArrowDown, X, Radio, ShieldCheck, Check, LoaderCircle, RefreshCw } from 'lucide-react';
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
  const toastTimer = useRef();
  const messageList = useRef();
  const sticky = useRef(true);
  const firstLoad = useRef(true);
  const notify = useCallback(text => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 3500); }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const { privateMode, privacyRef, changePrivacy, windowActive } = useDesktopBridge({ notify, onPendingRoom: setSelected,
    onOpenRoom: roomId => { setSelected(roomId); setModal(null); setSearch(''); } });
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
    try { const result = await api('rooms', { userId: user.id }); await refresh(); setSelected(result.id); setModal(null); }
    catch (error) { notify(error.message); }
  }
  const toastElement = toast && <div className="toast" role="status"><Check size={16} />{toast}</div>;
  if (startupError) return <div className="startup-state"><Logo /><h2>稍等，连接有点慢</h2><p>{startupError}</p><button className="primary-button" onClick={start}><RefreshCw size={16} />重新连接</button>{window.desktop && <button className="secondary-button" onClick={() => window.desktop.home()}>返回本机空间</button>}</div>;
  if (!bootstrap) return <div className="startup-state"><Logo /><p>正在连接虾扯蛋…</p><LoaderCircle className="spin" size={20} /></div>;
  if (!state?.me) return <><Onboarding bootstrap={bootstrap} onJoined={refresh} notify={notify} />{toastElement}</>;
  const userMap = Object.fromEntries(state.users.map(user => [user.id, user]));
  const roomName = room => room.kind === 'direct' ? userMap[room.members.find(id => id !== state.me.id)]?.name || '私聊' : room.name;
  const rooms = state.rooms.map(room => ({ ...room, name: roomName(room) }));
  const room = rooms.find(room => room.id === selected) || rooms[0];
  if (!room) return <div className="startup-state">正在加载会话…</div>;
  const groupMembers = room.kind === 'public' ? state.users.filter(user => !user.removed) : state.users.filter(user => !user.removed && room.members.includes(user.id));
  const online = state.users.filter(user => !user.removed && user.online);
  const filtered = rooms.filter(room => room.name.toLowerCase().includes(search.toLowerCase()));
  const roomIcon = target => target.kind === 'direct' ? <Avatar user={userMap[target.members.find(id => id !== state.me.id)]} size={41} online={userMap[target.members.find(id => id !== state.me.id)]?.online} /> : <span className={`room-avatar ${target.kind === 'public' ? 'public-room' : ''}`}>{target.kind === 'public' ? <Hash size={23} /> : <Users size={22} />}</span>;
  const roomButton = target => {
    const status = unread[target.id];
    const label = status?.exact ? `${status.count} 条未读消息` : '有新消息';
    return <button className={`conversation ${selected === target.id ? 'active' : ''} ${status?.hasUnread ? 'has-unread' : ''}`} key={target.id} data-room-id={target.id} onClick={() => setSelected(target.id)}>
      {roomIcon(target)}<span className="conversation-copy"><span className="conversation-title"><span className="conversation-name">{target.name}</span><time>{target.lastMessage ? formatTime(target.lastMessage.createdAt) : ''}</time></span>
        <span className="conversation-preview"><PrivatePreview privateMode={privateMode && Boolean(target.lastMessage)}>{previewText(target.lastMessage)}</PrivatePreview>{status?.hasUnread && <span className="unread-badge" aria-label={label} title={label}>{status.exact ? status.count > 99 ? '99+' : status.count : '新'}</span>}</span>
      </span>
    </button>;
  };
  return <div className={`app ${privateMode ? 'privacy-on' : ''}`} data-screen-label="虾扯蛋聊天空间">
    <div className={`window-bar ${window.desktop ? 'native' : ''}`}><div className="window-label"><Logo small /><span>虾扯蛋</span></div><span className="window-center">{state.workspace.name}</span><span className="window-right">有事说事，没事虾扯蛋。</span></div>
    <nav className="app-rail" aria-label="主导航"><Logo /><div className="rail-top"><IconButton icon={MessageCircle} label="聊天" className="rail-active" onClick={() => setModal(null)} /><IconButton icon={Users} label="空间成员" onClick={() => setModal('members')} /></div><div className="rail-bottom"><IconButton icon={UserPlus} label="邀请同事" onClick={() => setModal('invite')} /><IconButton icon={Settings2} label="连接与空间" onClick={() => setModal('connection')} /><span className="rail-divider" /><button className="own-avatar" title="修改昵称和头像" aria-label="修改昵称和头像" onClick={() => setModal('profile')}><Avatar user={state.me} size={36} /></button></div></nav>
    <aside className="sidebar"><div className="workspace-heading"><div><h1 className="brand-title">虾扯蛋<span>.</span></h1><p className="brand-slogan">有事说事，没事虾扯蛋。</p><span className="workspace-name">{state.workspace.name}</span></div><IconButton icon={ChevronDown} label="空间设置" onClick={() => setModal('connection')} /></div><div className="sidebar-search"><Search size={16} /><input aria-label="搜索会话" placeholder="找个人，扯两句" value={search} onChange={event => setSearch(event.target.value)} />{search ? <IconButton icon={X} label="清空搜索" onClick={() => setSearch('')} /> : <span>⌕</span>}</div>
      <div className="conversation-scroll"><div className="section-label"><span>群聊</span><IconButton icon={Plus} label="新建群聊" onClick={() => setModal('group')} /></div>{filtered.filter(room => room.kind !== 'direct').map(roomButton)}<div className="section-label direct-label"><span>私聊</span><IconButton icon={Plus} label="发起私聊" onClick={() => setModal('members')} /></div>{filtered.filter(room => room.kind === 'direct').map(roomButton)}{!filtered.some(room => room.kind === 'direct') && <p className="sidebar-empty">{search ? '没有匹配的私聊' : '找到一位同事，聊点新鲜事。'}</p>}
      </div><div className="sidebar-online"><div className="section-label"><span>现在在线</span><span className="online-count">{online.length}</span></div><div className="online-avatars">{online.slice(0, 5).map(user => <button key={user.id} title={user.name} aria-label={`与${user.name}聊天`} onClick={() => directMessage(user)}><Avatar user={user} size={32} /></button>)}<button className="more-members" title="查看所有成员" aria-label="查看所有成员" onClick={() => setModal('members')}><Plus size={15} /></button></div></div><button className={`connection-status ${connected ? '' : 'disconnected'}`} onClick={() => setModal('connection')}>{connected ? <Wifi size={14} /> : <WifiOff size={14} />}<span>{connected ? '局域网已连接' : '正在重新连接…'}</span><i /></button></aside>
    <main className="chat-main"><header className="chat-header"><div className="chat-title-icon">{room.kind === 'public' ? <Hash size={25} /> : room.kind === 'group' ? <Users size={23} /> : <MessageCircle size={23} />}</div><div className="chat-heading"><h2>{room.name}{room.kind === 'public' && <span className="public-tag">公共空间</span>}</h2><p>{room.kind === 'public' ? '有空冒个泡，忙的时候安心潜水。' : room.kind === 'group' ? `${groupMembers.length} 位成员 · 你们的小天地` : userMap[room.members.find(id => id !== state.me.id)]?.online ? '在线 · 随时聊聊' : '当前离线 · 消息会在上线后送达'}</p></div><div className="chat-header-actions"><button className={`privacy-toggle ${privateMode ? 'enabled' : ''}`} onClick={() => changePrivacy(value => !value)} role="switch" aria-checked={privateMode} aria-label="隐私模式" title="隐私模式 · Command + Shift + P">{privateMode ? <EyeOff size={17} /> : <Eye size={17} />}<span>隐私模式</span><i className="toggle-track"><i /></i></button><span className="header-divider" /><button className={`member-count ${showMembers ? 'selected' : ''}`} onClick={() => setShowMembers(value => !value)} title="会话成员" aria-label="会话成员"><Users size={18} /><span>{groupMembers.length}</span></button></div></header>
      {privateMode && <div className="privacy-banner"><ShieldCheck size={16} /><span>放心聊，内容已经藏好了。</span><span className="privacy-example">****</span><small>悬停消息查看，移开即隐藏</small><kbd>⌘ ⇧ P</kbd></div>}
      {!connected && <div className="offline-banner"><WifiOff size={15} />正在重新连接，草稿会保留。请确认创建空间的 Mac 正在运行虾扯蛋。</div>}
      <div className="conversation-body"><section className="chat-column"><div className="message-scroll" ref={messageList} onScroll={event => { const node = event.currentTarget; sticky.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; setScrolledUp(!sticky.current); }} onLoad={() => { if (sticky.current && messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight; }}>
        {hasMore[selected] && <button className="load-older text-button" onClick={loadOlder} disabled={loading}>{loading ? '正在加载…' : '查看更早的消息'}</button>}
        {!hasMore[selected] && <div className={`channel-welcome ${currentMessages.length ? 'has-messages' : ''}`}><div className="welcome-channel-icon">{room.kind === 'public' ? <Hash size={31} /> : room.kind === 'group' ? <Users size={29} /> : <MessageCircle size={29} />}</div><span className="eyebrow">{room.kind === 'public' ? '每一段对话，从这里开始' : room.kind === 'group' ? '一群人，一些共同的话题' : '给熟悉的人，发个消息'}</span><h3>{room.kind === 'public' ? '同一个网络，随便扯两句。' : room.kind === 'group' ? `欢迎来到「${room.name}」` : `和${room.name}聊聊吧`}</h3><p>{room.kind === 'public' ? '工作、日常、好玩的，都可以往这里丢。' : room.kind === 'group' ? '文字、图片、视频，把想分享的都留在这里。' : '有些话，适合只对一个人说。'}</p>{room.kind === 'public' && !currentMessages.length && <button className="secondary-button" onClick={() => setModal('invite')}><UserPlus size={16} />邀请同事加入<ArrowDown size={14} className="rotate-arrow" /></button>}</div>}
        {!currentMessages.length && loading && <div className="messages-loading"><LoaderCircle className="spin" size={19} />正在加载消息…</div>}
        {currentMessages.map((message, index) => <React.Fragment key={message.id}>{(index === 0 || new Date(currentMessages[index - 1].createdAt).toDateString() !== new Date(message.createdAt).toDateString()) && <div className="date-divider"><span>{new Date(message.createdAt).toDateString() === new Date().toDateString() ? '今天' : new Date(message.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span></div>}<Message onContextMenu={(event, message) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, message }); }} message={message} user={userMap[message.senderId]} mine={message.senderId === state.me.id} privateMode={privateMode} onPreview={setPreview} viewerId={state.me.id} readingEnabled={windowActive && !modal && !removing && !recalling && !contextMenu && !preview && !loading} onRead={markMessageRead} recipients={groupMembers.filter(user => user.id !== state.me.id).map(user => user.id)} direct={room.kind === 'direct'} /></React.Fragment>)}
      </div>{scrolledUp && <button className="jump-to-latest" onClick={() => { sticky.current = true; messageList.current.scrollTo({ top: messageList.current.scrollHeight, behavior: 'smooth' }); }}><ArrowDown size={15} />回到最新消息</button>}
      <Composer room={room} connected={connected} privateMode={privateMode} onSent={message => { sticky.current = true; receive(message); }} notify={notify} /></section>
      {showMembers && <aside className="members-panel"><div className="members-panel-heading"><h3>会话成员 <small>{groupMembers.length}</small></h3><IconButton icon={X} label="关闭成员面板" onClick={() => setShowMembers(false)} /></div>{room.kind === 'group' && <button className="add-member-button" onClick={() => setModal('addMembers')}><UserPlus size={16} />邀请成员</button>}{groupMembers.map(user => <div className="managed-member" key={user.id}><button className="member-row" key={user.id} onClick={() => directMessage(user)}><Avatar user={user} size={36} online={user.online} /><span>{user.name}{user.id === state.me.id && <small>我</small>}<small>{user.online ? '在线' : '离线'}</small></span><ChevronRight size={14} /></button>{state.workspace.ownerId === state.me.id && user.id !== state.me.id && <button className="remove-member" onClick={() => setRemoving(user)} aria-label={`从空间移除${user.name}`}>移除</button>}</div>)}<div className="members-bottom-note"><Radio size={15} /><span>在同一个网络里，<br />也在同一个话题里。</span></div></aside>}</div>
    </main>
    {modal === 'profile' && <ProfileDialog me={state.me} onClose={() => setModal(null)} onUpdate={updateMe} notify={notify} />}
    {modal === 'invite' && <InviteDialog onClose={() => setModal(null)} notify={notify} />}
    {['group', 'addMembers'].includes(modal) && <GroupDialog users={state.users.filter(user => !user.removed)} me={state.me} room={modal === 'addMembers' ? room : null} onClose={() => setModal(null)} onCreated={async id => { await refresh(); setSelected(id); }} notify={notify} />}
    {modal === 'connection' && <ConnectionDialog connected={connected} me={state.me} workspace={state.workspace} onCleared={result => { syncHistory([], result.throughSeq); return refresh(); }} onClose={() => setModal(null)} notify={notify} />}
    {modal === 'members' && <Modal title="认识一下，你的邻居们" subtitle={`${state.users.filter(user => !user.removed).length} 位成员，${online.length} 人在线。点击一位成员开始私聊。`} onClose={() => setModal(null)}><div className="space-members">{state.users.filter(user => !user.removed).map(user => <div className="managed-member" key={user.id}><button className="member-row" key={user.id} onClick={() => directMessage(user)}><Avatar user={user} size={40} online={user.online} /><span>{user.name}{user.id === state.me.id && <small>我</small>}<small>{user.online ? '在线' : '离线'}</small></span><ChevronRight size={16} /></button>{state.workspace.ownerId === state.me.id && user.id !== state.me.id && <button className="remove-member" onClick={() => setRemoving(user)} aria-label={`从空间移除${user.name}`}>移除</button>}</div>)}</div><button className="secondary-button full" onClick={() => setModal('invite')}><UserPlus size={16} />邀请新同事</button></Modal>}
    {preview && !privateMode && <Modal title={preview.name} onClose={() => setPreview(null)} wide><img className="lightbox-image" src={mediaUrl(preview.id)} alt={preview.name} /></Modal>}
    {removing && <RemoveMemberDialog user={removing} onClose={() => setRemoving(null)} onRemoved={async () => { setRemoving(null); await refresh(); notify("成员已移除，邀请码已更新"); }} />}
    {contextMenu && <MessageContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} onRecall={() => { setRecalling(contextMenu.message); setContextMenu(null); }} />}
    {recalling && <RecallDialog message={recalling} onClose={() => setRecalling(null)} onRecalled={message => { syncHistory([message]); notify('消息已撤回'); }} />}
    {toastElement}
  </div>;
}

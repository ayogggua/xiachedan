import React, { useState } from 'react';
import { MessageCircle, Users, UserRound, Search, ChevronRight, Settings2, Bookmark, UserPlus, UserCheck, ShieldCheck, Server, LogOut } from 'lucide-react';
import { ArcadeIcon } from '../ArcadeEntry';
import { Avatar, BotTag, botStatusText } from '../components';
import { mobileClient, chooseServer } from './session';
import useUserSearch from '../useUserSearch';

export function MobileTabs({ tab, onChange, unread, friendBadge = 0 }) {
  return <nav className="mobile-tabs" aria-label="主导航">{[
    ['chats', '消息', MessageCircle, unread], ['contacts', '通讯录', Users, friendBadge], ['me', '我', UserRound, 0],
  ].map(([key, label, Icon, badge]) => <button key={key} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => onChange(key)}>
    <span className="mobile-tab-icon"><Icon size={23} strokeWidth={tab === key ? 2.2 : 1.7} />{badge > 0 && <span className="mobile-tab-badge">{badge > 99 ? '99+' : badge}</span>}</span><span>{label}</span>
  </button>)}</nav>;
}

// 和电脑上的通讯录一致：按部门分组，没填部门的排在最后。
// 机器人单独一组，排在最后。
const departments = users => Object.entries(users.reduce((groups, user) => { (groups[user.bot ? '机器人' : user.department || '未设置部门'] ||= []).push(user); return groups; }, {}))
  .sort(([a], [b]) => (a === '机器人') - (b === '机器人') || (a === '未设置部门') - (b === '未设置部门') || a.localeCompare(b, 'zh-Hans-CN'));

export function MobileHome({ tab, me, users, friendIds = [], friendRequests = { incoming: [], outgoing: [] }, canViewUserList = false, notes, connected, onDirect, onRequestFriend, onRespondFriend, onAction, isAdmin, loggingOut, onLogout }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState('friends');
  const friendSet = new Set(friendIds);
  const incomingPending = new Map((friendRequests.incoming || []).filter(item => item.status === 'pending').map(item => [item.fromUserId, item]));
  const outgoingPending = new Map((friendRequests.outgoing || []).filter(item => item.status === 'pending').map(item => [item.toUserId, item]));
  const pendingCount = incomingPending.size;
  const activeView = canViewUserList ? view : 'friends';
  const baseUsers = users.filter(user => !user.removed && user.id !== me.id && (activeView === 'all' || friendSet.has(user.id) || (user.bot && user.bot.status === 'enabled')));
  const search = useUserSearch(baseUsers, query, tab === 'contacts', notes);
  if (tab === 'chats') return null;
  if (tab === 'contacts') {
    const searching = Boolean(query.trim());
    const contacts = search.users.filter(user => user.id !== me.id).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const relationOf = user => user.bot ? 'bot' : friendSet.has(user.id) ? 'friend' : incomingPending.has(user.id) ? 'pending_incoming' : outgoingPending.has(user.id) ? 'pending_outgoing' : user.relation || 'none';
    const renderRow = user => {
      const relation = relationOf(user);
      const canMessage = canViewUserList || relation === 'friend' || relation === 'bot';
      if (canMessage) {
        return <button key={user.id} className="mobile-contact" onClick={() => onDirect(user)}>
          <Avatar user={user} size={44} />
          <span><b>{user.name}{user.bot && <BotTag />}</b><small>{user.bot ? botStatusText(user) || user.bio : user.online ? '在线' : '离线'}</small></span>
          {!user.bot && user.online && <i className="status-dot online" />}
          <ChevronRight size={16} />
        </button>;
      }
      return <div key={user.id} className="mobile-contact mobile-contact-stranger">
        <Avatar user={user} size={44} />
        <span><b>{user.name}</b><small>{user.department || user.bio || '非好友，添加后可私聊'}</small></span>
        {relation === 'pending_incoming'
          ? <button type="button" className="primary-button mobile-friend-action" onClick={() => onRespondFriend?.(incomingPending.get(user.id)?.id || user.requestId, 'accept')}>同意</button>
          : relation === 'pending_outgoing'
            ? <span className="mobile-friend-state">已申请</span>
            : <button type="button" className="secondary-button mobile-friend-action" onClick={() => onRequestFriend?.(user)}>添加好友</button>}
      </div>;
    };
    return <section className="mobile-home mobile-contacts"><header><h1>通讯录</h1><button aria-label="邀请同事" onClick={() => onAction('invite')}><UserPlus size={22} /></button></header>
      <label className="mobile-contact-search"><Search size={17} /><input type="search" aria-label="搜索成员" placeholder="搜索昵称、完整手机号或邮箱" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {canViewUserList && !searching && <div className="segmented-control mobile-contact-tabs" role="tablist" aria-label="通讯录视图">
        <button type="button" role="tab" aria-selected={activeView === 'friends'} className={activeView === 'friends' ? 'active' : ''} onClick={() => setView('friends')}>好友</button>
        <button type="button" role="tab" aria-selected={activeView === 'all'} className={activeView === 'all' ? 'active' : ''} onClick={() => setView('all')}>用户列表</button>
      </div>}
      {!searching && <>
        <button className="mobile-contact-group" onClick={() => onAction('friendRequests')}><span><UserCheck size={21} /></span><b>好友申请</b>{pendingCount > 0 && <span className="unread-badge">{pendingCount > 99 ? '99+' : pendingCount}</span>}<ChevronRight size={17} /></button>
        <button className="mobile-contact-group" onClick={() => onAction('group')}><span><Users size={21} /></span><b>发起群聊</b><ChevronRight size={17} /></button>
      </>}
      <p className="mobile-list-label">{searching ? `搜索结果（${contacts.length}）` : activeView === 'all' ? `${contacts.filter(user => !user.bot).length} 位成员` : `${contacts.filter(user => !user.bot).length} 位好友`}</p>
      <div className="mobile-contact-list">{searching ? contacts.map(renderRow) : departments(contacts).map(([department, members]) => <section key={department} aria-label={department}><h4 className="mobile-contact-department">{department}<small>{members.length}</small></h4>
        {members.map(renderRow)}</section>)}
        {search.error ? <p className="form-error" role="alert">{search.error}</p> : search.loading ? <p className="compact-empty">正在搜索用户…</p> : !contacts.length && <p className="compact-empty">{searching ? '没有找到相关用户' : activeView === 'all' ? '还没有其他成员' : '还没有好友，输入昵称、完整手机号或邮箱搜索并添加'}</p>}</div>
    </section>;
  }
  const actions = [
    ['saved', '我的收藏', Bookmark], ['connection', '设置', Settings2], ['invite', '邀请同事', UserPlus],
    ...(isAdmin ? [['admin', '用户管理', ShieldCheck]] : []),
    ...(mobileClient ? [['server', '连接服务器', Server]] : []),
    ['arcade', '游戏厅', ArcadeIcon],
  ];
  return <section className="mobile-home mobile-me"><header><h1>我</h1></header>
    <button className="mobile-profile" onClick={() => onAction('profile')}><Avatar user={me} size={68} /><span><b>{me.name}</b><small>{me.department || me.email || me.phone || '编辑个人资料'}</small></span><ChevronRight size={20} /></button>
    <p className="mobile-connection-status"><i className={`status-dot ${connected ? 'online' : ''}`} />{connected ? '已连接聊天空间' : '正在重新连接…'}</p>
    <div className="mobile-settings-list">{actions.map(([key, label, Icon]) => <button key={key} onClick={() => key === 'server' ? chooseServer() : onAction(key)}><Icon size={21} /><span>{label}</span><ChevronRight size={17} /></button>)}</div>
    <button className="mobile-signout" onClick={onLogout} disabled={loggingOut}><LogOut size={18} />{loggingOut ? '正在退出…' : '退出登录'}</button>
  </section>;
}

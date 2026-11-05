import React, { useState } from 'react';
import { MessageCircle, Users, UserRound, Search, ChevronRight, Settings2, Bookmark, UserPlus, ShieldCheck, Server, LogOut } from 'lucide-react';
import { Avatar } from '../components';
import { mobileClient, chooseServer } from './session';

export function MobileTabs({ tab, onChange, unread }) {
  return <nav className="mobile-tabs" aria-label="主导航">{[
    ['chats', '消息', MessageCircle], ['contacts', '通讯录', Users], ['me', '我', UserRound],
  ].map(([key, label, Icon]) => <button key={key} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => onChange(key)}>
    <span className="mobile-tab-icon"><Icon size={23} strokeWidth={tab === key ? 2.2 : 1.7} />{key === 'chats' && unread > 0 && <span className="mobile-tab-badge">{unread > 99 ? '99+' : unread}</span>}</span><span>{label}</span>
  </button>)}</nav>;
}

export function MobileHome({ tab, me, users, connected, onDirect, onAction, isAdmin, loggingOut, onLogout }) {
  const [query, setQuery] = useState('');
  if (tab === 'chats') return null;
  if (tab === 'contacts') {
    const contacts = users.filter(user => !user.removed && user.id !== me.id && `${user.name} ${user.department || ''}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return <section className="mobile-home mobile-contacts"><header><h1>通讯录</h1><button aria-label="邀请同事" onClick={() => onAction('invite')}><UserPlus size={22} /></button></header>
      <label className="mobile-contact-search"><Search size={17} /><input type="search" aria-label="搜索成员" placeholder="搜索名字或部门" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button className="mobile-contact-group" onClick={() => onAction('group')}><span><Users size={21} /></span><b>发起群聊</b><ChevronRight size={17} /></button>
      <p className="mobile-list-label">{contacts.length} 位联系人</p>
      <div className="mobile-contact-list">{contacts.map(user => <button key={user.id} className="mobile-contact" onClick={() => onDirect(user)}><Avatar user={user} size={44} /><span><b>{user.name}</b><small>{user.department || (user.online ? '在线' : '离线')}</small></span>{user.online && <i className="status-dot online" />}<ChevronRight size={16} /></button>)}{!contacts.length && <p className="compact-empty">{query ? '没有找到相关成员' : '还没有其他成员'}</p>}</div>
    </section>;
  }
  const actions = [
    ['saved', '我的收藏', Bookmark], ['connection', '设置', Settings2], ['invite', '邀请同事', UserPlus],
    ...(isAdmin ? [['admin', '用户管理', ShieldCheck]] : []),
    ...(mobileClient ? [['server', '连接服务器', Server]] : []),
  ];
  return <section className="mobile-home mobile-me"><header><h1>我</h1></header>
    <button className="mobile-profile" onClick={() => onAction('profile')}><Avatar user={me} size={68} /><span><b>{me.name}</b><small>{me.department || me.email || me.phone || '编辑个人资料'}</small></span><ChevronRight size={20} /></button>
    <p className="mobile-connection-status"><i className={`status-dot ${connected ? 'online' : ''}`} />{connected ? '已连接聊天空间' : '正在重新连接…'}</p>
    <div className="mobile-settings-list">{actions.map(([key, label, Icon]) => <button key={key} onClick={() => key === 'server' ? chooseServer() : onAction(key)}><Icon size={21} /><span>{label}</span><ChevronRight size={17} /></button>)}</div>
    <button className="mobile-signout" onClick={onLogout} disabled={loggingOut}><LogOut size={18} />{loggingOut ? '正在退出…' : '退出登录'}</button>
  </section>;
}

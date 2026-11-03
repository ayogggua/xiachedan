import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';

// ⌘K 快速切换会话：输入筛选，↑/↓ 选择，回车打开，Esc 关闭。
export default function QuickSwitcher({ rooms, icon, unread, onOpen, onClose }) {
  const dialog = useRef();
  const list = useRef();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const matches = rooms.filter(room => room.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 50);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => previous?.focus?.();
  }, []);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index]);
  function onKeyDown(event) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length) setIndex(value => (value + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
    } else if (event.key === 'Enter' && matches[index]) { event.preventDefault(); onOpen(matches[index].id); }
  }
  return <dialog ref={dialog} className="quick-switcher" aria-label="切换会话" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <label className="quick-search"><Search size={16} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="切换到会话…" aria-label="搜索会话"
      role="combobox" aria-expanded="true" aria-controls="quick-switcher-list" aria-activedescendant={matches[index] ? `quick-room-${matches[index].id}` : undefined} /></label>
    <div ref={list} id="quick-switcher-list" role="listbox" className="quick-list">
      {matches.map((room, position) => { const status = unread[room.id];
        return <button type="button" role="option" id={`quick-room-${room.id}`} key={room.id} aria-selected={position === index} className={position === index ? 'active' : ''}
          onPointerMove={() => setIndex(position)} onClick={() => onOpen(room.id)}>
          {icon(room)}<span className="quick-name">{room.name}</span>
          {status?.hasUnread && <span className="unread-badge">{status.exact ? status.count > 99 ? '99+' : status.count : '新'}</span>}
        </button>; })}
      {!matches.length && <p className="quick-empty">没有找到「{query.trim()}」</p>}
    </div>
  </dialog>;
}

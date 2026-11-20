import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { readStorage } from './history';
import { writeStorage } from './storage';
import { api, mediaUrl } from './api';
import { GROUPS } from './emojiShortcodes';
import { isTouchMobile } from './mobile/ui';

// 输入区的表情面板：常用（本机最近用过的）加几组常见表情，点击插入到光标处。
export { GROUPS };
const RECENT_KEY = 'linliao.recentEmoji';

export default function EmojiPicker({ onPick, onSticker, notify, onClose, docked = false }) {
  const ref = useRef();
  const bodyRef = useRef();
  const [activeTab, setActiveTab] = useState(() => onSticker ? 'stickers' : 'group-0');
  // 自己收藏的表情（存在服务端，换设备也在）：点一下直接发出去。
  const [stickers, setStickers] = useState(null);
  useEffect(() => { if (onSticker) api('stickers').then(result => setStickers(result.stickers)).catch(() => setStickers([])); }, []);
  async function removeSticker(sticker) {
    try { setStickers((await api('stickers/delete', { id: sticker.id })).stickers); } catch (error) { notify?.(error.message); }
  }
  const [recent] = useState(() => readStorage(RECENT_KEY, []).filter(item => typeof item === 'string').slice(0, 16));
  useEffect(() => {
    const dismiss = event => {
      if (docked) {
        if (!event.target.closest?.('.composer-area')) onClose();
        return;
      }
      if (!ref.current?.contains(event.target) && !event.target.closest?.('.emoji-button')) onClose();
    };
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key, true); };
  }, [onClose, docked]);
  function pick(emoji) {
    writeStorage(RECENT_KEY, JSON.stringify([emoji, ...recent.filter(item => item !== emoji)].slice(0, 16)));
    onPick(emoji);
  }
  const groups = recent.length ? [['常用', recent], ...GROUPS] : GROUPS;
  const stickerEmptyHint = isTouchMobile() ? '长按聊天里的图片，选「添加到表情」。' : '在聊天里的图片上点右键，选「添加到表情」。';
  const tabs = [
    ...(onSticker ? [['stickers', '表情包']] : []),
    ...groups.map(([name], index) => [`group-${index}`, name]),
  ];
  const jumpTab = id => {
    setActiveTab(id);
    const section = bodyRef.current?.querySelector(`[data-emoji-section="${id}"]`);
    section?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  return <div ref={ref} className={`emoji-picker ${docked ? 'docked' : ''}`} role="dialog" aria-label="选择表情">
    {docked && <div className="emoji-tabs" role="tablist" aria-label="表情分类">
      {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? 'active' : ''} onClick={() => jumpTab(id)}>{label}</button>)}
    </div>}
    <div ref={bodyRef} className={docked ? 'emoji-picker-body' : undefined}>
      {onSticker && <section data-emoji-section="stickers"><h4>我的表情</h4>{!stickers ? null : stickers.length ? <div className="sticker-grid">
        {stickers.map(sticker => <span className="sticker-tile" key={sticker.id}>
          <button type="button" aria-label="发送这个表情" onPointerDown={event => event.preventDefault()} onClick={() => onSticker(sticker)}><img src={mediaUrl(sticker.id)} alt="" loading="lazy" /></button>
          <button type="button" className="sticker-remove" aria-label="删除这个表情" onPointerDown={event => event.preventDefault()} onClick={() => removeSticker(sticker)}><X size={11} /></button>
        </span>)}</div> : <p className="sticker-empty">{stickerEmptyHint}</p>}</section>}
      {groups.map(([name, list], index) => <section key={name} data-emoji-section={`group-${index}`}><h4>{name}</h4><div className="emoji-grid">
        {list.map(emoji => <button type="button" key={emoji} aria-label={emoji} onPointerDown={event => event.preventDefault()} onClick={() => pick(emoji)}>{emoji}</button>)}
      </div></section>)}
    </div>
  </div>;
}

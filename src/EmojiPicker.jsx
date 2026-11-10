import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { readStorage } from './history';
import { api, mediaUrl } from './api';

// 输入区的表情面板：常用（本机最近用过的）加几组常见表情，点击插入到光标处。
export const GROUPS = [
  ['笑脸', '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 😎 🤓 🧐 🤔 🤨 😐 😑 😶 🙄 😏 😬 🤐 😴 😪 😮 😯 😲 🥱 😢 😭 😤 😡 🤯 😳 🥵 🥶 😱 😨 😰 😓 🤗 🤭 🫡 🤫 🤥 😷 🤒 🤕 🥳 🥺 🫠'],
  ['手势', '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 👏 🙌 👐 🤲 💪 ✍️ 🫶 👀 🧠'],
  ['心情', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💕 💯 💢 💥 💫 💦 💤 🔥 ✨ 🎉 🎊 🎈 🎁 🏆 🥇 ⭐ 🌟 ☀️ 🌈 ☔'],
  ['日常', '☕ 🍵 🧋 🍺 🍻 🍰 🎂 🍉 🍎 🍜 🍚 🍔 🍕 🍟 🍗 🥟 🍱 🚗 🚕 🚇 ✈️ 🏠 🏢 💻 ⌨️ 🖥️ 📱 📷 📅 📌 📎 📝 📚 💡 🔔 🔍 🔒 🔑 ⏰ ⏳ 💰 📈 📉 ✅ ❌ ⚠️ ❓ ❗ 🆗 🆕 🚀'],
].map(([name, list]) => [name, list.split(' ')]);
const RECENT_KEY = 'linliao.recentEmoji';

export default function EmojiPicker({ onPick, onSticker, notify, onClose }) {
  const ref = useRef();
  // 自己收藏的表情（存在服务端，换设备也在）：点一下直接发出去。
  const [stickers, setStickers] = useState(null);
  useEffect(() => { if (onSticker) api('stickers').then(result => setStickers(result.stickers)).catch(() => setStickers([])); }, []);
  async function removeSticker(sticker) {
    try { setStickers((await api('stickers/delete', { id: sticker.id })).stickers); } catch (error) { notify?.(error.message); }
  }
  const [recent] = useState(() => readStorage(RECENT_KEY, []).filter(item => typeof item === 'string').slice(0, 16));
  useEffect(() => {
    const dismiss = event => { if (!ref.current?.contains(event.target) && !event.target.closest?.('.emoji-button')) onClose(); };
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key, true); };
  }, [onClose]);
  function pick(emoji) {
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...recent.filter(item => item !== emoji)].slice(0, 16)));
    onPick(emoji);
  }
  const groups = recent.length ? [['常用', recent], ...GROUPS] : GROUPS;
  return <div ref={ref} className="emoji-picker" role="dialog" aria-label="选择表情">
    {onSticker && <section><h4>我的表情</h4>{!stickers ? null : stickers.length ? <div className="sticker-grid">
      {stickers.map(sticker => <span className="sticker-tile" key={sticker.id}>
        <button type="button" aria-label="发送这个表情" onPointerDown={event => event.preventDefault()} onClick={() => onSticker(sticker)}><img src={mediaUrl(sticker.id)} alt="" loading="lazy" /></button>
        <button type="button" className="sticker-remove" aria-label="删除这个表情" onPointerDown={event => event.preventDefault()} onClick={() => removeSticker(sticker)}><X size={11} /></button>
      </span>)}</div> : <p className="sticker-empty">在聊天里的图片上点右键，选「添加到表情」。</p>}</section>}
    {groups.map(([name, list]) => <section key={name}><h4>{name}</h4><div className="emoji-grid">
      {list.map(emoji => <button type="button" key={emoji} aria-label={emoji} onPointerDown={event => event.preventDefault()} onClick={() => pick(emoji)}>{emoji}</button>)}
    </div></section>)}
  </div>;
}

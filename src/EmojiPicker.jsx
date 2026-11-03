import React, { useEffect, useRef, useState } from 'react';
import { readStorage } from './history';

// 输入区的表情面板：常用（本机最近用过的）加几组常见表情，点击插入到光标处。
export const GROUPS = [
  ['笑脸', '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 😎 🤓 🧐 🤔 🤨 😐 😑 😶 🙄 😏 😬 🤐 😴 😪 😮 😯 😲 🥱 😢 😭 😤 😡 🤯 😳 🥵 🥶 😱 😨 😰 😓 🤗 🤭 🫡 🤫 🤥 😷 🤒 🤕 🥳 🥺 🫠'],
  ['手势', '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤝 🙏 👏 🙌 👐 🤲 💪 ✍️ 🫶 👀 🧠'],
  ['心情', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💕 💯 💢 💥 💫 💦 💤 🔥 ✨ 🎉 🎊 🎈 🎁 🏆 🥇 ⭐ 🌟 ☀️ 🌈 ☔'],
  ['日常', '☕ 🍵 🧋 🍺 🍻 🍰 🎂 🍉 🍎 🍜 🍚 🍔 🍕 🍟 🍗 🥟 🍱 🚗 🚕 🚇 ✈️ 🏠 🏢 💻 ⌨️ 🖥️ 📱 📷 📅 📌 📎 📝 📚 💡 🔔 🔍 🔒 🔑 ⏰ ⏳ 💰 📈 📉 ✅ ❌ ⚠️ ❓ ❗ 🆗 🆕 🚀'],
].map(([name, list]) => [name, list.split(' ')]);
const RECENT_KEY = 'linliao.recentEmoji';

export default function EmojiPicker({ onPick, onClose }) {
  const ref = useRef();
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
    {groups.map(([name, list]) => <section key={name}><h4>{name}</h4><div className="emoji-grid">
      {list.map(emoji => <button type="button" key={emoji} aria-label={emoji} onPointerDown={event => event.preventDefault()} onClick={() => pick(emoji)}>{emoji}</button>)}
    </div></section>)}
  </div>;
}

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Cat, Bird, Rabbit, Fish, Coffee, Mountain, Orbit, Sprout, X, EyeOff, Download, ArrowUpRight, Film, Image as ImageIcon, Shuffle, Check, Reply, FileText, SmilePlus } from 'lucide-react';
import { mediaUrl, formatTime, formatSize, randomName } from './api';
import { previewText } from './history';
import appIcon from './assets/brand/app-icon.svg';

export const PRESETS = ['cat', 'bird', 'rabbit', 'fish', 'coffee', 'mountain', 'planet', 'sprout'];
const avatarIcons = { cat: Cat, bird: Bird, rabbit: Rabbit, fish: Fish, coffee: Coffee, mountain: Mountain, planet: Orbit, sprout: Sprout };
const avatarNames = { cat: '小猫', bird: '小鸟', rabbit: '兔子', fish: '小鱼', coffee: '咖啡', mountain: '山峰', planet: '星球', sprout: '幼苗' };

export function Avatar({ user, size = 40, online, className = '' }) {
  const value = user?.avatar || 'cat';
  const Icon = avatarIcons[value] || Cat;
  return <span className={`avatar avatar-${value.startsWith('upload:') ? 'photo' : value} ${className}`} style={{ width: size, height: size }} aria-hidden="true">
    {value.startsWith('upload:') ? <img src={mediaUrl(value.slice(7))} alt="" /> : <Icon size={Math.round(size * .52)} strokeWidth={1.65} />}
    {online !== undefined && <i className={`presence-dot ${online ? 'online' : ''}`} />}
  </span>;
}

export function Logo({ small = false }) {
  return <img className={`logo-mark ${small ? 'small' : ''}`} src={appIcon} alt="" aria-hidden="true" draggable="false" />;
}

export function IconButton({ icon: Icon, label, className = '', size = 17, ...props }) {
  return <button type="button" title={label} aria-label={label} className={`icon-button ${className}`} {...props}><Icon size={size} strokeWidth={1.7} /></button>;
}

export function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const old = document.activeElement;
    ref.current?.showModal();
    return () => old?.focus?.();
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === ref.current) onClose(); }}>
    <div className="modal-content"><div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon={X} label="关闭" onClick={onClose} /></div>{children}</div>
  </dialog>;
}

export function IdentityFields({ name, setName, avatar, setAvatar }) {
  return <><label className="field-label" htmlFor="nickname">你的昵称</label><div className="input-with-action"><input id="nickname" value={name} onChange={event => setName(event.target.value)} placeholder="给自己起个名字" maxLength={24} required autoComplete="nickname" /><button type="button" className="random-button" onClick={() => setName(randomName())} title="随机生成有趣的昵称"><Shuffle size={16} />随机起名</button></div>
    <span className="field-label avatar-label">选一个头像</span><div className="avatar-picker">{PRESETS.map(preset => <button type="button" key={preset} className={avatar === preset ? 'selected' : ''} aria-label={`选择${avatarNames[preset]}头像`} aria-pressed={avatar === preset} onClick={() => setAvatar(preset)}><Avatar user={{ avatar: preset }} size={36} />{avatar === preset && <span className="avatar-check"><Check size={10} /></span>}</button>)}</div></>;
}

export function PrivatePreview({ privateMode, children }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setRevealed(false); const hide = () => setRevealed(false); window.addEventListener('blur', hide); return () => window.removeEventListener('blur', hide); }, [privateMode, children]);
  return <span className={`private-preview ${privateMode && !revealed ? 'masked-preview' : ''}`} onPointerEnter={() => setRevealed(true)} onPointerMove={() => setRevealed(true)} onPointerLeave={() => setRevealed(false)}>{privateMode && !revealed ? '****' : children}</span>;
}

// 普通文件：只显示名称和大小，点击下载，不在页面内打开。
function FileCard({ file }) {
  const extension = file.name.includes('.') ? file.name.split('.').pop().slice(0, 4).toUpperCase() : '';
  return <a className="file-card" href={mediaUrl(file.id, true)} download title={`下载 ${file.name}`}>
    <span className="file-icon"><FileText size={20} strokeWidth={1.6} />{extension && <small>{extension}</small>}</span>
    <span className="file-copy"><span>{file.name}</span><small>{formatSize(file.size)}</small></span><Download size={15} />
  </a>;
}

function Attachment({ file, privateMode, onPreview }) {
  const [failed, setFailed] = useState(false);
  if (!/^(image|video)\//.test(file.mime)) return <FileCard file={file} />;
  return <div className={`attachment ${file.mime.startsWith('image/') ? 'image-attachment' : 'video-attachment'}`}>
    {file.mime.startsWith('image/') ? <button className="image-button" type="button" onClick={() => !privateMode && onPreview(file)} aria-label={privateMode ? '图片内容' : '放大查看图片'}><img src={mediaUrl(file.id)} alt={file.name} loading="lazy" /></button> : <>
      {failed ? <div className="video-fallback"><Film size={26} /><p>这个视频格式暂时无法预览</p><a href={mediaUrl(file.id, true)} download>下载后播放<ArrowUpRight size={14} /></a></div> : <video src={mediaUrl(file.id)} controls preload="metadata" playsInline onError={() => setFailed(true)} />}
    </>}
    <div className="attachment-caption"><span>{file.mime.startsWith('image/') ? <ImageIcon size={13} /> : <Film size={13} />}{file.name}</span><small>{formatSize(file.size)}</small><a href={mediaUrl(file.id, true)} download title="下载文件" aria-label="下载文件"><Download size={14} /></a></div>
  </div>;
}

// 触屏没有右键：长按 500 毫秒触发 onLongPress，手指移动则取消；consumed() 用来吞掉长按后的那次点击。
export function longPressHandlers(state, onLongPress) {
  const cancel = () => clearTimeout(state.current.timer);
  return {
    onPointerDown: event => {
      if (event.pointerType !== 'touch') return;
      const { clientX, clientY } = event;
      state.current = { fired: false, timer: setTimeout(() => { state.current.fired = true; onLongPress(clientX, clientY); }, 500) };
    },
    onPointerUp: cancel, onPointerCancel: cancel,
    onPointerMove: event => { if (event.pointerType === 'touch' && (Math.abs(event.movementX) > 4 || Math.abs(event.movementY) > 4)) cancel(); },
  };
}
export const consumeLongPress = state => { const fired = state.current.fired; state.current.fired = false; return fired; };
// 长按时没有原生事件，给右键菜单处理器一个带坐标的替身。
export const pressEvent = (clientX, clientY) => ({ clientX, clientY, preventDefault() {}, stopPropagation() {} });

// 把正文里「@名字」高亮出来；@我和@所有人用更醒目的样式。
function MessageText({ text, mentions = [], nameOf, viewerId }) {
  const tokens = mentions.map(id => ({ id, label: `@${id === '*' ? '所有人' : nameOf?.(id) || ''}` })).filter(token => token.label.length > 1)
    .sort((a, b) => b.label.length - a.label.length);
  if (!tokens.length) return <p className="message-text">{text}</p>;
  const parts = [];
  for (let start = 0; start < text.length;) {
    let found = null;
    for (const token of tokens) { const index = text.indexOf(token.label, start); if (index >= 0 && (!found || index < found.index)) found = { ...token, index }; }
    if (!found) { parts.push(text.slice(start)); break; }
    parts.push(text.slice(start, found.index), <span key={found.index} className={`mention ${found.id === viewerId || found.id === '*' ? 'self' : ''}`}>{found.label}</span>);
    start = found.index + found.label.length;
  }
  return <p className="message-text">{parts}</p>;
}

// 引用块：原消息被撤回或清空时只说明状态；点击跳到原消息。
export function Quote({ reply, author, onOpen, className = '' }) {
  const unavailable = reply.recalled ? '引用的消息已撤回' : reply.missing ? '引用的消息已被清空' : '';
  const body = <><b>{author}</b><span>{unavailable || previewText(reply)}</span></>;
  return unavailable || !onOpen ? <div className={`message-quote ${unavailable ? 'unavailable' : ''} ${className}`}>{unavailable ? <span>{unavailable}</span> : body}</div>
    : <button type="button" className={`message-quote ${className}`} onClick={onOpen} title="查看原消息">{body}</button>;
}

// 表情选择条：Esc 或点到外面关闭，选完即关。
function ReactionPalette({ options, chosen, onPick, onClose }) {
  const ref = useRef();
  const [below, setBelow] = useState(false);
  // 消息列表会裁掉溢出部分，顶部还浮着工具栏：上方放不下时改为向下展开。
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect(), list = ref.current?.closest('.message-scroll')?.getBoundingClientRect();
    const toolbar = document.querySelector('.chat-toolbar')?.getBoundingClientRect();
    if (box && list && box.top < Math.max(list.top, toolbar?.bottom || 0) + 4) setBelow(true);
  }, []);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const dismiss = event => { if (!ref.current?.contains(event.target)) onClose(); };
    const key = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key); };
  }, [onClose]);
  return <div ref={ref} className={`reaction-palette ${below ? 'below' : ''}`} role="group" aria-label="选择表情">
    {options.map(emoji => <button type="button" key={emoji} aria-label={`回应 ${emoji}`} aria-pressed={chosen.includes(emoji)} className={chosen.includes(emoji) ? 'chosen' : ''} onClick={() => { onPick(emoji); onClose(); }}>{emoji}</button>)}
  </div>;
}

export function Message({ message, user, mine, continued = false, privateMode, onPreview, viewerId, readingEnabled, onRead, recipients = [], direct = false, onContextMenu, onReadDetail, onReply, onOpenQuote, nameOf, reactionOptions = [], onReact, picking = false, onPick, selecting = false, selected = false, onToggleSelect }) {
  const [revealed, setRevealed] = useState(false);
  const [visible, setVisible] = useState(false);
  const bubble = useRef(null);
  const press = useRef({ timer: 0, fired: false });
  const revealSize = useRef({});
  const reveal = event => {
    if (!privateMode || revealed) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    revealSize.current = { minWidth: bounds.width, minHeight: bounds.height };
    setRevealed(true);
  };
  useEffect(() => {
    setRevealed(false);
    const hide = () => setRevealed(false);
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', hide);
    return () => { window.removeEventListener('blur', hide); document.removeEventListener('visibilitychange', hide); };
  }, [privateMode]);
  const hidden = privateMode && !revealed;
  const alreadyRead = message.readBy?.includes(viewerId);
  useEffect(() => {
    if (mine || !bubble.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting && entry.intersectionRect.height >= Math.min(60, entry.boundingClientRect.height * .5));
    }, { threshold: [0, .05, .15, .5, 1] });
    observer.observe(bubble.current);
    return () => observer.disconnect();
  }, [message.id, mine, message.recalledAt]);
  useEffect(() => {
    if (message.recalledAt || mine || !readingEnabled || hidden || !visible || alreadyRead || !Array.isArray(message.readBy)) return;
    // 隐私模式下鼠标需停留 0.6 秒才算看过，划过不计。
    const timer = setTimeout(() => onRead?.(message.roomId, message.id), privateMode ? 600 : 350);
    return () => clearTimeout(timer);
  }, [message.recalledAt, mine, readingEnabled, hidden, visible, alreadyRead, message.id, message.roomId, message.readBy, onRead, privateMode]);
  const readCount = recipients.filter(id => message.readBy?.includes(id)).length;
  const readLabel = direct ? readCount ? '已读' : '未读' : readCount ? `${readCount}/${recipients.length} 人已读` : '未读';
  if (message.recalledAt) return <article className="recalled-message" data-message-id={message.id} data-seq={message.seq}>{mine ? '你撤回了一条消息' : `${user?.name || '成员'}撤回了一条消息`}</article>;
  const time = <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>;
  // 多选时整行可点：点哪里都只切换选中，不触发菜单。
  if (selecting) return <article className={`message-row selecting ${mine ? 'mine' : ''} ${continued ? 'continued' : ''} ${selected ? 'selected' : ''}`} data-message-id={message.id} data-seq={message.seq}
    onClick={() => onToggleSelect?.(message)}>
    <label className="select-check" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selected} onChange={() => onToggleSelect?.(message)} aria-label={`选择${user?.name || ''}的消息`} /><span>{selected && <Check size={12} />}</span></label>
    {!mine && (continued ? <span className="avatar-spacer" /> : <Avatar user={user} size={28} />)}
    <div className="message-column">{!mine && !continued && <div className="message-meta"><span>{user?.name || '成员'}</span>{time}</div>}
      <div className={`message-bubble ${hidden ? 'is-masked' : ''} ${message.attachments.length ? 'has-media' : ''}`}>{hidden ? <div className="masked-message"><span>****</span><EyeOff size={13} /></div> : <>
        {message.forwardedFrom && <div className="forward-label">转发自 {message.forwardedFrom.senderId === viewerId ? '我' : nameOf?.(message.forwardedFrom.senderId) || '成员'}</div>}
        {message.text && <MessageText text={message.text} mentions={message.mentions} nameOf={nameOf} viewerId={viewerId} />}{message.attachments.map(file => <Attachment key={file.id} file={file} privateMode={privateMode} onPreview={() => {}} />)}</>}</div>
    </div>
    {mine && <Avatar user={user} size={28} />}
  </article>;
  return <article onContextMenu={event => { if (consumeLongPress(press)) event.preventDefault(); else onContextMenu?.(event, message); }}
    {...longPressHandlers(press, (clientX, clientY) => onContextMenu?.(pressEvent(clientX, clientY), message))}
    className={`message-row ${mine ? 'mine' : ''} ${continued ? 'continued' : ''}`} data-message-id={message.id} data-seq={message.seq}>
    {!mine && (continued ? <span className="avatar-spacer" /> : <Avatar user={user} size={28} />)}
    <div className="message-column">{!mine && !continued && <div className="message-meta"><span>{user?.name || '成员'}</span>{time}</div>}
      <div className="bubble-line"><div ref={bubble} className={`message-bubble ${hidden ? 'is-masked' : ''} ${message.attachments.length ? 'has-media' : ''}`} tabIndex={privateMode ? 0 : undefined}
        style={privateMode && revealed ? revealSize.current : undefined}
        onPointerEnter={reveal} onPointerMove={reveal} onPointerLeave={() => setRevealed(false)} onBlur={() => setRevealed(false)}
        onKeyDown={event => { if (event.code === 'Space' && privateMode) { event.preventDefault(); setRevealed(true); } }} onKeyUp={event => { if (event.code === 'Space') setRevealed(false); }}
        aria-label={hidden ? '内容已隐藏，悬停或按住空格查看' : undefined}>
        {hidden ? <div className="masked-message"><span>****</span><EyeOff size={13} /></div> : <>{message.forwardedFrom && <div className="forward-label">转发自 {message.forwardedFrom.senderId === viewerId ? '我' : nameOf?.(message.forwardedFrom.senderId) || '成员'}</div>}{message.replyTo && <Quote reply={message.replyTo} author={message.replyTo.senderId === viewerId ? '我' : nameOf?.(message.replyTo.senderId) || '成员'} onOpen={() => onOpenQuote?.(message.replyTo)} />}{message.text && <MessageText text={message.text} mentions={message.mentions} nameOf={nameOf} viewerId={viewerId} />}{message.attachments.map(file => <Attachment key={file.id} file={file} privateMode={privateMode} onPreview={onPreview} />)}</>}
      </div>
      {onReply && <div className={`message-actions ${picking ? 'open' : ''}`}>
        {reactionOptions.length > 0 && <IconButton icon={SmilePlus} label="回应" size={14} aria-expanded={picking} onClick={() => onPick?.(picking ? null : message.id)} />}
        <IconButton icon={Reply} label="回复" size={14} onClick={() => onReply(message)} />
        {picking && <ReactionPalette options={reactionOptions} chosen={(message.reactions || []).filter(item => item.users.includes(viewerId)).map(item => item.emoji)} onPick={emoji => onReact?.(message, emoji)} onClose={() => onPick?.(null)} />}
      </div>}</div>
      {message.reactions?.length > 0 && <div className="reaction-chips">{message.reactions.map(item => { const reacted = item.users.includes(viewerId);
        const names = item.users.map(id => id === viewerId ? '我' : nameOf?.(id) || '成员').join('、');
        return <button type="button" key={item.emoji} className={reacted ? 'reacted' : ''} aria-pressed={reacted} title={`${names} 回应了 ${item.emoji}`} aria-label={`${item.emoji} ${item.users.length} 人：${names}`} onClick={() => onReact?.(message, item.emoji)}>
          <span aria-hidden="true">{item.emoji}</span><span aria-hidden="true">{item.users.length}</span></button>; })}</div>}
      {mine && <div className="message-status">{time}{recipients.length > 0 && Array.isArray(message.readBy) && (direct ? <span className={`message-read-status ${readCount ? 'is-read' : ''}`} data-read-count={readCount}>{readLabel}</span>
        : <button type="button" className={`message-read-status ${readCount ? 'is-read' : ''}`} data-read-count={readCount} aria-haspopup="dialog" title="查看已读成员" onClick={event => onReadDetail?.(event, message)}>{readLabel}</button>)}</div>}
    </div>
    {mine && <Avatar user={user} size={28} />}
  </article>;
}

export function ContextMenu({ menu, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const dismiss = event => { if (!ref.current?.contains(event.target)) onClose(); };
    const key = event => {
      if (event.key === 'Escape') onClose();
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...ref.current.querySelectorAll('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', onClose, true);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key); window.removeEventListener('blur', onClose); window.removeEventListener('resize', onClose); document.removeEventListener('scroll', onClose, true); };
  }, [onClose]);
  return <div ref={ref} role="menu" aria-label={menu.label} className="message-context-menu" onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} style={{ left: Math.max(8, Math.min(menu.x, innerWidth - 152)), top: Math.max(8, Math.min(menu.y, innerHeight - menu.items.length * 36 - 16)) }}>{menu.items.map((item, index) => <button key={item.id} autoFocus={index === 0} role="menuitem" onClick={() => { onClose(); item.action(); }}>{item.label}</button>)}</div>;
}

export function ReadDetail({ anchor, message, members, onClose }) {
  const ref = useRef();
  useEffect(() => {
    ref.current?.focus();
    // 点已读状态按钮由按钮自身切换开合，这里不重复关闭。
    const dismiss = event => { if (!ref.current?.contains(event.target) && !event.target.closest?.('.message-read-status')) onClose(); };
    const key = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  const read = members.filter(user => message.readBy?.includes(user.id));
  const unread = members.filter(user => !message.readBy?.includes(user.id));
  const list = users => users.map(user => <li key={user.id}><Avatar user={user} size={20} /><span>{user.name}</span></li>);
  return <div ref={ref} role="dialog" aria-label="已读详情" tabIndex={-1} className="read-detail"
    style={{ left: Math.max(8, Math.min(anchor.x - 240, innerWidth - 248)), bottom: Math.max(8, innerHeight - anchor.y + 6) }}>
    <section><h4>已读<small>{read.length}</small></h4>{read.length ? <ul>{list(read)}</ul> : <p>还没有人读</p>}</section>
    <section><h4>未读<small>{unread.length}</small></h4>{unread.length ? <ul>{list(unread)}</ul> : <p>全员已读</p>}</section>
  </div>;
}

import React, { useEffect, useRef, useState } from 'react';
import { Cat, Bird, Rabbit, Fish, Coffee, Mountain, Orbit, Sprout, X, EyeOff, Download, ArrowUpRight, Film, Image as ImageIcon, Shuffle, Check } from 'lucide-react';
import { mediaUrl, formatTime, formatSize, randomName } from './api';
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

function Attachment({ file, privateMode, onPreview }) {
  const [failed, setFailed] = useState(false);
  return <div className={`attachment ${file.mime.startsWith('image/') ? 'image-attachment' : 'video-attachment'}`}>
    {file.mime.startsWith('image/') ? <button className="image-button" type="button" onClick={() => !privateMode && onPreview(file)} aria-label={privateMode ? '图片内容' : '放大查看图片'}><img src={mediaUrl(file.id)} alt={file.name} loading="lazy" /></button> : <>
      {failed ? <div className="video-fallback"><Film size={26} /><p>这个视频格式暂时无法预览</p><a href={mediaUrl(file.id, true)} download>下载后播放<ArrowUpRight size={14} /></a></div> : <video src={mediaUrl(file.id)} controls preload="metadata" playsInline onError={() => setFailed(true)} />}
    </>}
    <div className="attachment-caption"><span>{file.mime.startsWith('image/') ? <ImageIcon size={13} /> : <Film size={13} />}{file.name}</span><small>{formatSize(file.size)}</small><a href={mediaUrl(file.id, true)} download title="下载文件" aria-label="下载文件"><Download size={14} /></a></div>
  </div>;
}

export function Message({ message, user, mine, continued = false, privateMode, onPreview, viewerId, readingEnabled, onRead, recipients = [], direct = false, onContextMenu }) {
  const [revealed, setRevealed] = useState(false);
  const [visible, setVisible] = useState(false);
  const bubble = useRef(null);
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
    const timer = setTimeout(() => onRead?.(message.roomId, message.id), 350);
    return () => clearTimeout(timer);
  }, [message.recalledAt, mine, readingEnabled, hidden, visible, alreadyRead, message.id, message.roomId, message.readBy, onRead]);
  const readCount = recipients.filter(id => message.readBy?.includes(id)).length;
  const readLabel = direct ? readCount ? '已读' : '未读' : readCount ? `${readCount}/${recipients.length} 人已读` : '未读';
  if (message.recalledAt) return <article className="recalled-message" data-message-id={message.id}>{mine ? '你撤回了一条消息' : `${user?.name || '成员'}撤回了一条消息`}</article>;
  const time = <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>;
  return <article onContextMenu={mine ? event => onContextMenu?.(event, message) : undefined} className={`message-row ${mine ? 'mine' : ''} ${continued ? 'continued' : ''}`} data-message-id={message.id}>
    {!mine && (continued ? <span className="avatar-spacer" /> : <Avatar user={user} size={28} />)}
    <div className="message-column">{!mine && !continued && <div className="message-meta"><span>{user?.name || '成员'}</span>{time}</div>}
      <div ref={bubble} className={`message-bubble ${hidden ? 'is-masked' : ''} ${message.attachments.length ? 'has-media' : ''}`} tabIndex={privateMode ? 0 : undefined}
        style={privateMode && revealed ? revealSize.current : undefined}
        onPointerEnter={reveal} onPointerMove={reveal} onPointerLeave={() => setRevealed(false)} onBlur={() => setRevealed(false)}
        onKeyDown={event => { if (event.code === 'Space' && privateMode) { event.preventDefault(); setRevealed(true); } }} onKeyUp={event => { if (event.code === 'Space') setRevealed(false); }}
        aria-label={hidden ? '内容已隐藏，悬停或按住空格查看' : undefined}>
        {hidden ? <div className="masked-message"><span>****</span><EyeOff size={13} /></div> : <>{message.text && <p className="message-text">{message.text}</p>}{message.attachments.map(file => <Attachment key={file.id} file={file} privateMode={privateMode} onPreview={onPreview} />)}</>}
      </div>
      {mine && <div className="message-status">{time}{recipients.length > 0 && Array.isArray(message.readBy) && <span className={`message-read-status ${readCount ? 'is-read' : ''}`} data-read-count={readCount} title={`${readCount} 人已读，${recipients.length - readCount} 人未读`}>{readLabel}</span>}</div>}
    </div>
  </article>;
}

export function MessageContextMenu({ menu, onClose, onRecall }) {
  const ref = useRef();
  useEffect(() => {
    const dismiss = event => { if (!ref.current?.contains(event.target)) onClose(); };
    const key = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key); window.removeEventListener('blur', onClose); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  return <div ref={ref} role="menu" aria-label="消息操作" className="message-context-menu" style={{ left: Math.max(8, Math.min(menu.x, innerWidth - 152)), top: Math.max(8, Math.min(menu.y, innerHeight - 62)) }}><button autoFocus role="menuitem" onClick={onRecall}>撤回消息</button></div>;
}

import React, { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Contact, Cat, Bird, Rabbit, Fish, Coffee, Mountain, Orbit, Sprout, X, EyeOff, Download, ArrowUpRight, Film, Image as ImageIcon, Shuffle, Check, Reply, FileText, SmilePlus, Bot, MessagesSquare, LoaderCircle, CircleAlert, MessageCircle, PencilLine, Search, ChevronRight, Hand, ListOrdered, Flame } from 'lucide-react';
import { mediaUrl, formatTime, formatSize, randomName, seenText } from './api';
import { burnDeadline, previewText } from './history';
import { FormattedText, LinkPreview, firstLink, plainText } from './markdown';
import { GROUPS as EMOJI_GROUPS } from './EmojiPicker';
import { disintegrate } from './dust';
import { readStorage } from './history';
import appIcon from './assets/brand/app-icon.svg';
import { PRESETS, HEXTECH_AVATARS, HEXTECH_TIERS, getHextechAvatar } from '../shared/avatars.js';
import { attachmentLabel } from '../shared/preview.js';
import { MediaAccessContext } from './mobile/MediaAccessContext';
import { previewKind } from './FilePreview';
import { haptic } from './chatPrefs';

export { PRESETS } from '../shared/avatars.js';
const avatarIcons = { cat: Cat, bird: Bird, rabbit: Rabbit, fish: Fish, coffee: Coffee, mountain: Mountain, planet: Orbit, sprout: Sprout, bot: Bot };
const avatarNames = { cat: '小猫', bird: '小鸟', rabbit: '兔子', fish: '小鱼', coffee: '咖啡', mountain: '山峰', planet: '星球', sprout: '幼苗', bot: '机器人' };

// 机器人账号：所有显示成员的地方都带「机器人」标记；状态文字代替在线、离线。
export const BotTag = () => <small className="bot-tag">机器人</small>;
export const botStatusText = user => user.bot.status === 'deleted' ? '已删除的机器人' : user.bot.status === 'enabled' ? '' : '已停用';

export function Avatar({ user, size = 40, online, className = '' }) {
  useContext(MediaAccessContext);
  const value = user?.avatar || 'cat';
  const hextech = getHextechAvatar(value);
  const Icon = avatarIcons[value] || Cat;
  return <span className={`avatar avatar-${hextech ? 'hextech' : value.startsWith('upload:') ? 'photo' : value} ${className}`} data-tier={hextech?.tier} style={{ width: size, height: size }} aria-hidden="true">
    {hextech ? <img src={hextech.icon} alt="" loading="lazy" decoding="async" draggable="false" /> : value.startsWith('upload:') ? <img src={mediaUrl(value.slice(7))} alt="" /> : <Icon size={Math.round(size * .52)} strokeWidth={1.65} />}
    {online !== undefined && <i className={`presence-dot ${online ? 'online' : ''}`} />}
  </span>;
}

export function Logo({ small = false }) {
  return <img className={`logo-mark ${small ? 'small' : ''}`} src={appIcon} alt="" aria-hidden="true" draggable="false" />;
}

export function IconButton({ icon: Icon, label, className = '', size = 17, ...props }) {
  return <button type="button" title={label} aria-label={label} className={`icon-button ${className}`} {...props}><Icon size={size} strokeWidth={1.7} /></button>;
}

export function Modal({ title, subtitle, children, onClose, wide = false, className = '' }) {
  const ref = useRef();
  const titleId = useId();
  useEffect(() => {
    const old = document.activeElement;
    ref.current?.showModal();
    return () => old?.focus?.();
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={`modal ${wide ? 'wide' : ''} ${className}`} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} onClick={event => { if (event.target === ref.current) onClose(); }}>
    <div className="modal-content"><div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon={X} label="关闭" onClick={onClose} /></div>{children}</div>
  </dialog>;
}

const hextechTierName = value => HEXTECH_TIERS.find(tier => tier.id === value)?.name;
const searchKey = value => value.normalize('NFKC').toLowerCase().replace(/[\s-]+/g, '');

function HextechAvatarLibrary({ avatar, onSelect, onClose, withName = false }) {
  const [tier, setTier] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => getHextechAvatar(avatar));
  const term = searchKey(query);
  const matches = HEXTECH_AVATARS.filter(item => searchKey(item.name).includes(term) || searchKey(item.slug).includes(term));
  const visible = matches.filter(item => tier === 'all' || item.tier === tier);
  const randomize = () => {
    const others = visible.filter(item => item.id !== selected?.id);
    const pool = others.length ? others : visible;
    if (pool.length) setSelected(pool[Math.floor(Math.random() * pool.length)]);
  };
  return createPortal(<Modal title="海克斯大乱斗头像库" className="hextech-library" onClose={onClose}>
    <div className="hextech-tools"><div className="search-input"><Search size={16} /><input type="search" aria-label="搜索海克斯名称" placeholder="搜索海克斯名称" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />{query && <IconButton icon={X} label="清空搜索" size={14} onClick={() => setQuery('')} />}</div><button type="button" className="secondary-button" onClick={randomize} disabled={!visible.length} title="从当前筛选结果中随机选择"><Shuffle size={15} />随机一个</button></div>
    <div className="hextech-tiers" role="group" aria-label="海克斯品阶">{[{ id: 'all', name: '全部' }, ...HEXTECH_TIERS].map(item => <button type="button" key={item.id} data-tier={item.id} aria-pressed={tier === item.id} onClick={() => setTier(item.id)}>{item.name}<span>{item.id === 'all' ? matches.length : matches.filter(avatar => avatar.tier === item.id).length}</span></button>)}</div>
    <div className="hextech-results" key={`${tier}:${query}`}>
      {visible.length ? <div className="hextech-grid" role="group" aria-label="海克斯头像">{visible.map(item => <button type="button" key={item.id} className="hextech-option" data-tier={item.tier} aria-label={`${item.name}，${hextechTierName(item.tier)}`} aria-pressed={selected?.id === item.id} title={`${item.name} · ${hextechTierName(item.tier)}`} onClick={() => setSelected(item)}><Avatar user={{ avatar: item.id }} size={52} /><span className="hextech-option-name">{item.name}</span><small>{hextechTierName(item.tier)}</small>{selected?.id === item.id && <span className="hextech-check"><Check size={12} /></span>}</button>)}</div> : <div className="hextech-empty" role="status"><Search size={24} /><p>没有找到匹配的海克斯</p><button type="button" className="text-button" onClick={() => { setQuery(''); setTier('all'); }}>清除筛选</button></div>}
    </div>
    <div className="hextech-footer"><div className="hextech-selection" aria-live="polite">{selected ? <><Avatar user={{ avatar: selected.id }} size={42} /><span><b>{selected.name}</b><small>{hextechTierName(selected.tier)}</small></span></> : <span className="hextech-placeholder">选择一个海克斯</span>}</div><button type="button" className="primary-button" disabled={!selected} onClick={() => { onSelect(selected); onClose(); }}>{withName ? '使用头像和名字' : '使用头像'}</button></div>
  </Modal>, document.body);
}

export function AvatarPicker({ avatar, setAvatar, onNameChange, extras = [] }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const hextech = getHextechAvatar(avatar);
  return <><span className="field-label avatar-label">选一个头像</span><div className="avatar-picker">{[...extras, ...PRESETS].map(preset => <button type="button" key={preset} className={avatar === preset ? 'selected' : ''} aria-label={`选择${avatarNames[preset]}头像`} aria-pressed={avatar === preset} onClick={() => setAvatar(preset)}><Avatar user={{ avatar: preset }} size={36} />{avatar === preset && <span className="avatar-check"><Check size={10} /></span>}</button>)}</div>
    <button type="button" className={`hextech-entry ${hextech ? 'selected' : ''}`} aria-haspopup="dialog" onClick={() => setLibraryOpen(true)}>{hextech ? <Avatar user={{ avatar }} size={42} /> : <span className="hextech-entry-icons">{HEXTECH_TIERS.map(tier => <Avatar key={tier.id} user={{ avatar: HEXTECH_AVATARS.find(item => item.tier === tier.id).id }} size={30} />)}</span>}<span className="hextech-entry-copy"><b>海克斯大乱斗</b><small>{hextech ? `${hextech.name} · ${hextechTierName(hextech.tier)}` : '白银阶 · 黄金阶 · 棱彩阶'}</small></span><ChevronRight size={17} /></button>
    {libraryOpen && <HextechAvatarLibrary avatar={avatar} withName={Boolean(onNameChange)} onSelect={item => { setAvatar(item.id); onNameChange?.(item.name); }} onClose={() => setLibraryOpen(false)} />}</>;
}

export function IdentityFields({ name, setName, avatar, setAvatar }) {
  return <><label className="field-label" htmlFor="nickname">你的昵称</label><div className="input-with-action"><input id="nickname" value={name} onChange={event => setName(event.target.value)} placeholder="给自己起个名字" maxLength={24} required autoComplete="nickname" /><button type="button" className="random-button" onClick={() => setName(randomName())} title="随机生成有趣的昵称"><Shuffle size={16} />随机起名</button></div><AvatarPicker avatar={avatar} setAvatar={setAvatar} onNameChange={setName} /></>;
}

export function PrivatePreview({ privateMode, children }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setRevealed(false); const hide = () => setRevealed(false); window.addEventListener('blur', hide); return () => window.removeEventListener('blur', hide); }, [privateMode, children]);
  return <span className={`private-preview ${privateMode && !revealed ? 'masked-preview' : ''}`} onPointerEnter={() => setRevealed(true)} onPointerMove={() => setRevealed(true)} onPointerLeave={() => setRevealed(false)}>{privateMode && !revealed ? '****' : children}</span>;
}

// 加载占位：超过 150 毫秒还没加载完才出现，快的时候不闪；色块按真实的行排，内容到了位置不跳。
// 读屏只念一次「正在加载…」，色块本身对读屏隐藏。kind：message 消息、result 搜索结果、file 文件、media 图片网格。
// 放在已有 aria-live 区域里时传 live={false}，由外层区域播报，免得念两遍。
const SKELETON_WIDTHS = ['62%', '38%', '74%', '50%', '28%', '66%'];
export function Skeleton({ kind = 'result', rows = 4, label = '正在加载…', live = true }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setShown(true), 150); return () => clearTimeout(timer); }, []);
  const width = index => ({ width: SKELETON_WIDTHS[index % SKELETON_WIDTHS.length] });
  const items = Array.from({ length: rows }, (_, index) => kind === 'media' ? <i key={index} className="skeleton-block skeleton-tile" />
    : kind === 'message' ? <div key={index} className={`skeleton-row ${index % 3 === 2 ? 'mine' : ''}`}><i className="skeleton-block skeleton-avatar" /><i className="skeleton-block skeleton-bubble" style={width(index)} /></div>
    : <div key={index} className="skeleton-row"><i className="skeleton-block skeleton-icon" /><span className="skeleton-lines"><i className="skeleton-block" style={width(index + 3)} /><i className="skeleton-block" style={width(index)} /></span></div>);
  return <div className={`skeleton skeleton-${kind}`} role={live ? 'status' : undefined}>{shown && <><span className="visually-hidden">{label}</span><div className={`skeleton-rows ${kind === 'media' ? 'media-grid' : ''}`} aria-hidden="true">{items}</div></>}</div>;
}

// 普通文件：只显示名称和大小，点击下载，不在页面内打开。
export function FileCard({ file }) {
  const extension = file.name.includes('.') ? file.name.split('.').pop().slice(0, 4).toUpperCase() : '';
  const body = <><span className="file-icon"><FileText size={20} strokeWidth={1.6} />{extension && <small>{extension}</small>}</span>
    <span className="file-copy"><span>{file.name}</span><small>{formatSize(file.size)}</small></span></>;
  // 文本、代码和 PDF 可以直接预览；点下载图标照常下载。
  if (previewKind(file)) return <div className="file-card previewable">
    <button type="button" className="file-open" title={`预览 ${file.name}`} onClick={() => window.dispatchEvent(new CustomEvent('linliao:open-file', { detail: file }))}>{body}<small className="file-open-hint">预览</small></button>
    <a href={mediaUrl(file.id, true)} download={file.name} title={`下载 ${file.name}`} aria-label={`下载 ${file.name}`}><Download size={15} /></a>
  </div>;
  return <a className="file-card" href={mediaUrl(file.id, true)} download={file.name} title={`下载 ${file.name}`}>{body}<Download size={15} /></a>;
}

// 合并转发的聊天记录卡片：显示前三条，点开看全部。
function BundleCard({ message, onOpen }) {
  const { bundle } = message;
  return <button type="button" className="bundle-card" onClick={() => onOpen?.(message)}>
    <b>{bundle.title}</b>
    {bundle.items.slice(0, 3).map((item, index) => <span key={index}>{item.senderName}：{item.text ? plainText(item.text).replace(/\s+/g, ' ') : attachmentLabel(item.attachments)}</span>)}
    <small><MessagesSquare size={12} />聊天记录 · 共 {bundle.items.length} 条</small>
  </button>;
}

// 投票卡片：选中即投，多选可勾多个；结果对所有人公开，悬停能看到投票人。
// 名片：头像、名字和部门，点开是这位成员的资料卡。
function ContactCard({ userId, userOf, onOpen }) {
  const user = userOf?.(userId);
  return <button type="button" className="contact-card" disabled={!onOpen || !user} onClick={event => user && onOpen?.(user, event.currentTarget)}>
    <Avatar user={user} size={40} /><span className="contact-card-copy"><b>{user?.name || '成员'}</b><small>{user?.removed ? '已离开空间' : user?.department || '个人名片'}</small></span>
    <span className="contact-card-label"><Contact size={12} />名片</span>
  </button>;
}

function PollCard({ message, viewerId, nameOf, onVote, onClosePoll }) {
  const { poll } = message;
  const mine = poll.options.map((option, index) => option.voters.includes(viewerId) ? index : -1).filter(index => index >= 0);
  const voters = new Set(poll.options.flatMap(option => option.voters));
  const top = Math.max(1, ...poll.options.map(option => option.voters.length));
  // 投过票就不能再改：单选点一下就投；多选先勾好再点「投票」。
  const voted = mine.length > 0, locked = voted || Boolean(poll.closedAt);
  const [picked, setPicked] = useState([]);
  const toggle = index => { if (locked) return; if (poll.multiple) setPicked(previous => previous.includes(index) ? previous.filter(item => item !== index) : [...previous, index]); else onVote?.(message, [index]); };
  const marked = index => voted ? mine.includes(index) : picked.includes(index);
  return <div className="poll-card">
    <div className="poll-question">{message.text}</div>
    <small className="poll-kind">{poll.closedAt ? '投票已结束' : poll.multiple ? '多选投票' : '单选投票'}</small>
    {poll.options.map((option, index) => <button type="button" key={index} className={`poll-option ${marked(index) ? 'chosen' : ''}`} disabled={locked} aria-pressed={marked(index)}
      title={option.voters.map(id => id === viewerId ? '我' : nameOf?.(id) || '成员').join('、') || '还没有人选'} onClick={() => toggle(index)}>
      <i style={{ transform: `scaleX(${option.voters.length / top})` }} aria-hidden="true" /><span>{marked(index) && <Check size={13} />}{option.text}</span><b>{option.voters.length}</b>
    </button>)}
    {poll.multiple && !locked && <button type="button" className="secondary-button poll-submit" disabled={!picked.length} onClick={() => onVote?.(message, picked)}>{picked.length ? `投票（已选 ${picked.length} 项）` : '选好后投票'}</button>}
    <div className="poll-footer"><span>{voters.size} 人参与{voted && ' · 你已投票'}</span>{onClosePoll && !poll.closedAt && <button type="button" className="text-button" onClick={() => onClosePoll(message)}>结束投票</button>}</div>
  </div>;
}

// 接龙卡片：一条消息原地更新，每人一行、按加入先后编号；超过 10 行先收起。加入、修改、退出在弹窗里做（onEntry），
// 发起人、群主和管理员（大厅是空间管理者）可以结束；结束后只剩名单。
const CHAIN_FOLD = 10;
function ChainCard({ message, viewerId, nameOf, canClose, blocked, onEntry, onClose }) {
  const { chain } = message;
  const [expanded, setExpanded] = useState(false);
  const entries = chain.entries, closed = Boolean(chain.closedAt);
  const joined = entries.some(entry => entry.userId === viewerId);
  const shown = expanded ? entries : entries.slice(0, CHAIN_FOLD);
  return <div className="chain-card">
    <div className="chain-title"><ListOrdered size={15} aria-hidden="true" /><span>{message.text}</span></div>
    {chain.description && <p className="chain-description">{chain.description}</p>}
    {chain.example && <p className="chain-example">例：{chain.example}</p>}
    {entries.length ? <ol className="chain-entries" aria-label="接龙名单">{shown.map((entry, index) => <li key={entry.userId} className={entry.userId === viewerId ? 'own' : undefined}>
      <span className="chain-number">{index + 1}.</span><span className="chain-line"><b>{entry.userId === viewerId ? '我' : nameOf?.(entry.userId) || '成员'}</b>{entry.text}</span>
    </li>)}</ol> : <p className="chain-empty">{closed ? '没有人参加' : '还没有人接龙'}</p>}
    {entries.length > CHAIN_FOLD && <button type="button" className="text-button chain-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : `展开全部（共 ${entries.length} 条）`}</button>}
    <div className="chain-footer"><span>{closed ? '接龙已结束 · ' : ''}{entries.length} 人参加{joined && ' · 你已参加'}</span>
      {!closed && <span className="chain-actions">
        {canClose && onClose && <button type="button" className="text-button" onClick={() => onClose(message)}>结束接龙</button>}
        {onEntry && <button type="button" className="secondary-button chain-join" disabled={Boolean(blocked)} title={blocked || undefined} onClick={() => onEntry(message)}>{joined ? '修改我的' : '接龙'}</button>}
      </span>}
    </div>
  </div>;
}

// 阅后即焚的倒计时：剩余毫秒数（没开始计时为 null）；每 250 毫秒走一次，到 0 停下。窗口在后台时浏览器会放慢计时器，回到前台立刻按真实时间算。
function useCountdown(deadline) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now());
    const timer = setInterval(() => { const current = Date.now(); setNow(current); if (current >= deadline) clearInterval(timer); }, 250);
    const wake = () => setNow(Date.now());
    document.addEventListener('visibilitychange', wake);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', wake); };
  }, [deadline]);
  return deadline ? Math.max(0, deadline - now) : null;
}
// 剩余秒数和一圈进度环；减少动效时只留数字（环由 CSS 隐藏）。读屏念「N 秒后销毁」，不逐秒播报。
function BurnTimer({ remaining, total }) {
  const seconds = Math.ceil(remaining / 1000), circumference = 2 * Math.PI * 7;
  return <span className="burn-timer" role="timer" aria-label={`${seconds} 秒后销毁`}>
    <svg className="burn-ring" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" /><circle className="burn-ring-left" cx="9" cy="9" r="7" style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - Math.min(1, remaining / (total * 1000))) }} /></svg>
    <b aria-hidden="true">{seconds}</b></span>;
}
const burnSpan = seconds => seconds >= 60 ? `${seconds / 60} 分钟` : `${seconds} 秒`;
// 阅后即焚的图片和视频：只能在页面里看。没有下载链接、不能拖出去、不弹右键或长按菜单；视频不给原生下载、画中画和投屏。
// 销毁时整个元素被换掉，正在放的视频随之停止。
const keepInside = event => event.preventDefault();
function BurnMedia({ file, onPreview }) {
  const mediaVersion = useContext(MediaAccessContext);
  const src = React.useMemo(() => mediaUrl(file.id), [file.id, mediaVersion]);
  if (file.mime.startsWith('video/')) return <div className="attachment video-attachment burn-media">
    <video src={src} controls controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback playsInline preload="metadata" onContextMenu={keepInside} onDragStart={keepInside} /></div>;
  return <div className="attachment image-attachment burn-media"><button className="image-button" type="button" aria-label="放大查看图片" onClick={() => onPreview?.(file)} onContextMenu={keepInside}>
    <img src={mediaUrl(file.thumbId || file.id)} alt="" draggable={false} onDragStart={keepInside} onContextMenu={keepInside} /></button></div>;
}
// 阅后即焚消息的气泡内容。接收人没拿到内容时是一张遮住的卡片，点了才向服务器要内容（并开始计时）；
// 拿到之后显示内容和倒计时。发送人看得到自己的内容和对方有没有打开。内容不可选中、不出链接预览。
function BurnBody({ message, mine, content, remaining, onOpen, onPreview, privateMode, nameOf, viewerId, colorOf, longPressShown }) {
  const { burn } = message;
  const [opening, setOpening] = useState(false);
  // 轻点才打开（会开始不可逆的倒计时）；这一次触摸已经弹出长按菜单（删除、撤回）的，抬手时不打开。
  // 判断只看菜单有没有弹出，和弹菜单用同一个时刻，中间没有「既不打开也不弹菜单」的空档。键盘回车、空格照常打开；菜单键只弹菜单。
  const pressed = useRef(null);
  const counting = remaining !== null;
  if (!mine && !content) return <button type="button" className="burn-cover" disabled={opening} aria-busy={opening}
    onPointerDown={event => { pressed.current = { type: event.pointerType, at: event.timeStamp }; }}
    onClick={async event => {
      const press = pressed.current;
      pressed.current = null;
      if (event.detail !== 0 && press?.type === 'touch' && longPressShown?.()) return;
      setOpening(true); try { await onOpen?.(message); } finally { setOpening(false); }
    }}>
    <span className="burn-cover-icon" aria-hidden="true">{opening ? <LoaderCircle className="spin" size={18} /> : <Flame size={18} />}</span>
    <span className="burn-cover-copy"><b>阅后即焚消息</b><small>{counting ? `已打开，点击再看` : `点击查看，${burnSpan(burn.seconds)}后销毁`}</small></span>
    {counting && <BurnTimer remaining={remaining} total={burn.seconds} />}
  </button>;
  const text = mine ? message.text : content.text, files = mine ? message.attachments : content.attachments, reply = mine ? message.replyTo : content.replyTo;
  return <div className="burn-body">
    <div className="burn-head"><Flame size={13} aria-hidden="true" /><span>{mine ? counting ? '对方已查看' : `阅后即焚 · 对方查看后 ${burnSpan(burn.seconds)}销毁` : '阅后即焚'}</span>{counting && <BurnTimer remaining={remaining} total={burn.seconds} />}</div>
    {reply && <Quote color={reply.senderId ? colorOf?.(reply.senderId) : undefined} reply={reply} author={reply.senderId === viewerId ? '我' : nameOf?.(reply.senderId) || '成员'} />}
    {text && <FormattedText text={text} />}
    {files.filter(file => /^(image|video)\//.test(file.mime)).map(file => <BurnMedia key={file.id} file={file} onPreview={privateMode ? undefined : item => onPreview?.({ ...item, burnId: message.id })} />)}
  </div>;
}

// 发送时标成剧透的图片、视频：先模糊遮住、不显示文件名，点一下才显示。揭开过的记在这里（只在本次打开期间），
// 看大图时左右翻页只翻揭开过的，没揭开的剧透图不会被翻出来。
export const revealedMedia = new Set();
export const coveredMedia = file => Boolean(file.spoiler) && !revealedMedia.has(file.id);
export const SpoilerBadge = () => <span className="spoiler-badge" aria-hidden="true"><EyeOff size={14} />剧透</span>;

export function Attachment({ file, privateMode, onPreview }) {
  const mediaVersion = useContext(MediaAccessContext);
  const [covered, setCovered] = useState(() => coveredMedia(file));
  const reveal = event => { event.stopPropagation(); revealedMedia.add(file.id); setCovered(false); };
  const [failed, setFailed] = useState(false);
  const [videoSource, setVideoSource] = useState(() => mediaUrl(file.id));
  const video = useRef(null), playback = useRef(null);
  useEffect(() => {
    if (!file.mime.startsWith('video/')) return;
    const next = mediaUrl(file.id);
    if (next === videoSource) return;
    playback.current = video.current ? { time: video.current.currentTime, playing: !video.current.paused } : null;
    setFailed(false); setVideoSource(next);
  }, [file.id, mediaVersion]);
  const restorePlayback = () => {
    if (!playback.current || !video.current) return;
    video.current.currentTime = playback.current.time;
    if (playback.current.playing) video.current.play().catch(() => {});
    playback.current = null;
  };
  if (!/^(image|video)\//.test(file.mime)) return <FileCard file={file} />;
  if (covered) return <div className={`attachment ${file.mime.startsWith('image/') ? 'image-attachment' : 'video-attachment'} spoiler-covered`}>
    <button className="image-button" type="button" onClick={reveal} aria-label={file.mime.startsWith('image/') ? '剧透图片，按下显示' : '剧透视频，按下显示'}>
      {file.mime.startsWith('image/') ? <img src={mediaUrl(file.thumbId || file.id)} alt="" loading="lazy" /> : <span className="spoiler-video"><Film size={26} /></span>}<SpoilerBadge /></button>
  </div>;
  return <div className={`attachment ${file.mime.startsWith('image/') ? 'image-attachment' : 'video-attachment'} ${file.sticker ? 'sticker-attachment' : ''}`}>
    {file.mime.startsWith('image/') ? <button className="image-button" type="button" onClick={() => !privateMode && onPreview(file)} aria-label={privateMode ? '图片内容' : '放大查看图片'}><img src={mediaUrl(file.thumbId || file.id)} alt={file.name} loading="lazy" /></button> : <>
      {failed ? <div className="video-fallback"><Film size={26} /><p>这个视频格式暂时无法预览</p><a href={mediaUrl(file.id, true)} download={file.name}>下载后播放<ArrowUpRight size={14} /></a></div> : <video ref={video} src={videoSource} controls preload="metadata" playsInline onLoadedMetadata={restorePlayback} onError={() => setFailed(true)} />}
    </>}
    {!file.sticker && <div className="attachment-caption"><span>{file.mime.startsWith('image/') ? <ImageIcon size={13} /> : <Film size={13} />}{file.name}</span><small>{formatSize(file.size)}</small><a href={mediaUrl(file.id, true)} download={file.name} title="下载文件" aria-label="下载文件"><Download size={14} /></a></div>}
  </div>;
}

// 触屏没有右键：长按 500 毫秒触发 onLongPress，手指移动则取消；consumed() 用来吞掉长按后的那次点击。
export function longPressHandlers(state, onLongPress) {
  const cancel = () => clearTimeout(state.current.timer);
  return {
    onPointerDown: event => {
      if (event.pointerType !== 'touch') return;
      const { clientX, clientY } = event;
      // menuShown：这一次按压弹出过菜单（consumeLongPress 只清 fired，不清它），阅后即焚的卡片据此不在抬手时打开。
      state.current = { fired: false, timer: setTimeout(() => { state.current.fired = true; state.current.menuShown = true; haptic(); onLongPress(clientX, clientY); }, 500) };
    },
    onPointerUp: cancel, onPointerCancel: cancel,
    onPointerMove: event => { if (event.pointerType === 'touch' && (Math.abs(event.movementX) > 4 || Math.abs(event.movementY) > 4)) cancel(); },
  };
}
export const consumeLongPress = state => { const fired = state.current.fired; state.current.fired = false; return fired; };
// 长按时没有原生事件，给右键菜单处理器一个带坐标的替身。
export const pressEvent = (clientX, clientY) => ({ clientX, clientY, preventDefault() {}, stopPropagation() {} });

// 触屏左滑消息回复（Telegram 式）：气泡带阻力跟手，右侧露出回复图标，拉过阈值时轻震一下，松手才回复；没到阈值松手就弹回。
// 行上设了 touch-action: pan-y，竖向滑动由浏览器滚动列表（并发 pointercancel 结束这里），横向的才交给这里；
// 代码块、表格这些自己能横向滚动的区域，以及视频、输入框上不接管；离屏幕左右边缘太近的让给系统的返回手势。
const SWIPE_TRIGGER = 56;
const SWIPE_SKIP = 'video, audio, input, textarea, select, [contenteditable="true"], .code-block, .table-scroll';
const swipeDistance = pull => { const follow = pull * .75; return follow <= SWIPE_TRIGGER ? follow : Math.min(96, SWIPE_TRIGGER + (follow - SWIPE_TRIGGER) * .3); };
function scrollsSideways(node, row) {
  for (let element = node; element && element !== row; element = element.parentElement) {
    if (element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(element).overflowX)) return true;
  }
  return false;
}
function useSwipeReply(enabled, onTrigger, press) {
  const row = useRef(null);
  const gesture = useRef(null);
  const settleTimer = useRef(0);
  const [phase, setPhase] = useState('');
  const [armed, setArmed] = useState(false);
  useEffect(() => () => clearTimeout(settleTimer.current), []);
  const setPull = distance => { row.current?.style.setProperty('--swipe-x', String(distance)); row.current?.style.setProperty('--swipe-p', String(Math.min(1, distance / SWIPE_TRIGGER))); };
  const settle = () => {
    setPull(0); setArmed(false);
    clearTimeout(settleTimer.current);
    // 减少动效时不做回弹，直接归位。
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setPhase('');
    setPhase('settling');
    settleTimer.current = setTimeout(() => setPhase(''), 260);
  };
  const finish = (event, cancelled) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    if (current.state !== 'drag') return;
    settle();
    if (!cancelled && current.armed) onTrigger();
  };
  return { row, phase, armed, handlers: {
    onPointerDown: event => {
      gesture.current = null;
      if (!enabled || event.pointerType !== 'touch' || !event.isPrimary) return;
      if (event.clientX < 24 || event.clientX > innerWidth - 24) return;
      if (event.target.closest(SWIPE_SKIP) || scrollsSideways(event.target, row.current)) return;
      // 正在选文字时拖动是在调整选区。
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && row.current?.contains(selection.anchorNode)) return;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, state: 'pending', armed: false };
    },
    onPointerMove: event => {
      const current = gesture.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      if (current.state === 'pending') {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // 方向一开始就定下：偏竖向或往右的都不算，交还给滚动。
        if (dx > 0 || Math.abs(dy) * 1.2 >= Math.abs(dx)) { gesture.current = null; return; }
        current.state = 'drag'; current.x = event.clientX;
        clearTimeout(press.current.timer);
        clearTimeout(settleTimer.current);
        try { row.current?.setPointerCapture(event.pointerId); } catch {}
        setPhase('swiping');
      }
      const distance = swipeDistance(Math.max(0, current.x - event.clientX));
      setPull(distance);
      const reached = distance >= SWIPE_TRIGGER;
      if (reached && !current.armed) haptic();
      if (reached !== current.armed) { current.armed = reached; setArmed(reached); }
    },
    onPointerUp: event => finish(event, false),
    onPointerCancel: event => finish(event, true),
  } };
}

// 正文：简单格式与 @提及高亮；@我和@所有人用更醒目的样式。
function MessageText({ text, mentions = [], nameOf, viewerId, meta = null }) {
  return <FormattedText text={text} mentions={mentions} nameOf={nameOf} viewerId={viewerId} tail={meta} />;
}

// 群聊里按成员给昵称着色：同一个人颜色固定。
// 自己选了颜色就用选的，否则按身份固定分配。
// 自定义状态：过期的不显示（成员列表要等下一次推送才更新，这里再判断一次）。
export const activeStatus = user => user?.status && (!user.status.until || user.status.until > Date.now()) ? user.status : null;
const StatusEmoji = ({ user }) => { const status = activeStatus(user); return status?.emoji ? <span className="status-emoji" title={status.text || undefined}>{status.emoji}</span> : null; };
export { StatusEmoji };
export const nameColor = (id, user) => `var(--name-${Number.isInteger(user?.nameColor) ? user.nameColor : [...(id || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7})`;

// 引用块：原消息被撤回或清空时只说明状态；点击跳到原消息。
// 引用块的竖条和名字用被引用者的名字颜色（Telegram 式）。
export function Quote({ reply, author, onOpen, className = '', color }) {
  const unavailable = reply.recalled ? '引用的消息已撤回' : reply.missing ? '引用的消息已被清空' : '';
  const body = <><b>{author}</b><span className={reply.quote ? 'quote-excerpt' : undefined}>{unavailable || (reply.quote ? `“${reply.quote}”` : previewText(reply))}</span></>;
  const style = color ? { '--quote-color': color } : undefined;
  return unavailable || !onOpen ? <div className={`message-quote ${unavailable ? 'unavailable' : ''} ${className}`} style={style}>{unavailable ? <span>{unavailable}</span> : body}</div>
    : <button type="button" className={`message-quote ${className}`} style={style} onClick={onOpen} title="查看原消息">{body}</button>;
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
  // 最常使用：本机按次数排前 8 个，不够时用默认的几个补齐；「更多」展开全部表情。
  const [expanded, setExpanded] = useState(false);
  const usage = readStorage('linliao.reactionUse', {});
  const frequent = [...new Set([...Object.keys(usage).sort((a, b) => usage[b] - usage[a]), ...options])].slice(0, 8);
  const pick = emoji => { localStorage.setItem('linliao.reactionUse', JSON.stringify({ ...usage, [emoji]: (usage[emoji] || 0) + 1 })); onPick(emoji); onClose(); };
  const button = emoji => <button type="button" key={emoji} aria-label={`回应 ${emoji}`} aria-pressed={chosen.includes(emoji)} className={chosen.includes(emoji) ? 'chosen' : ''} onClick={() => pick(emoji)}>{emoji}</button>;
  return <div ref={ref} className={`reaction-palette ${below ? 'below' : ''} ${expanded ? 'expanded' : ''}`} role="group" aria-label="选择表情">
    {expanded ? <div className="reaction-all"><h4>最常使用</h4><div className="reaction-grid">{frequent.map(button)}</div>
      {EMOJI_GROUPS.map(([name, list]) => <React.Fragment key={name}><h4>{name}</h4><div className="reaction-grid">{list.map(button)}</div></React.Fragment>)}</div>
      : <>{frequent.map(button)}<button type="button" className="reaction-more" aria-label="更多表情" onClick={() => setExpanded(true)}><SmilePlus size={17} /></button></>}
  </div>;
}

// 回应少时直接显示回应者头像，多了显示人数。新增回应时弹一下并迸出几颗同样的表情。
const BURST = Array.from({ length: 7 }, (_, index) => { const angle = (index / 7) * Math.PI * 2 - Math.PI / 2; return { x: Math.cos(angle) * 26, y: Math.sin(angle) * 20 }; });
function ReactionChip({ item, viewerId, nameOf, userOf, live, onToggle }) {
  const reacted = item.users.includes(viewerId);
  const count = item.users.length;
  const previous = useRef(live ? 0 : count);
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (count > previous.current) setBurst(value => value + 1);
    previous.current = count;
  }, [count]);
  useEffect(() => { if (!burst) return; const timer = setTimeout(() => setBurst(0), 700); return () => clearTimeout(timer); }, [burst]);
  const names = item.users.map(id => id === viewerId ? '我' : nameOf?.(id) || '成员').join('、');
  return <button type="button" className={`reaction-chip ${reacted ? 'reacted' : ''} ${burst ? 'popped' : ''}`} aria-pressed={reacted} disabled={!onToggle}
    title={`${names} 回应了 ${item.emoji}`} aria-label={`${item.emoji} ${count} 人：${names}`} onClick={event => { event.stopPropagation(); onToggle?.(); }}>
    <span className="reaction-emoji" aria-hidden="true">{item.emoji}</span>
    {count <= 3 ? <span className="reaction-people" aria-hidden="true">{item.users.map(id => <Avatar key={id} user={userOf?.(id)} size={18} />)}</span>
      : <span aria-hidden="true">{count}</span>}
    {burst > 0 && <span className="reaction-burst" aria-hidden="true">{BURST.map((point, index) => <i key={index} style={{ '--dx': `${point.x}px`, '--dy': `${point.y}px` }}>{item.emoji}</i>)}</span>}
  </button>;
}

// users 只用来在成员资料变化时让消息重新渲染（引用里的名字、回应者头像都取自成员资料）。
export const Message = React.memo(function Message({ message, user, mine, continued = false, privateMode, onPreview, viewerId, readingEnabled, onRead, recipients = [], direct = false, onContextMenu, onReadDetail, onReply, swipeReply = false, onOpenQuote, nameOf, reactionOptions = [], onReact, picking = false, onPick, selecting = false, selected = false, onToggleSelect, last = true, onVote, onClosePoll, onOpenThread, grouped = false, colorOf, onOpenBundle, userOf, onOpenProfile, showName: nameShown, reEditable = false, onReEdit, quickReact = false, onShowHistory, onChainEntry, onCloseChain, chainManager = false, voiceBlocked = '', burnContent, onOpenBurn }) {
  const [revealed, setRevealed] = useState(false);
  const [visible, setVisible] = useState(false);
  const bubble = useRef(null);
  const press = useRef({ timer: 0, fired: false });
  // 阅后即焚：不能回复、回应、多选；销毁（服务器通知或本机倒计时到点）后只剩一行。
  const burn = message.burn && !message.recalledAt ? message.burn : null;
  const remaining = useCountdown(burn && !burn.destroyedAt ? burnDeadline(burn) : null);
  const burnGone = Boolean(burn && (burn.destroyedAt || remaining === 0));
  const swipe = useSwipeReply(Boolean(swipeReply && onReply && !message.recalledAt && !message.nudge && !burn), () => onReply?.(message), press);
  const lastTap = useRef(null);
  // 有的手机浏览器在两次轻点后还会发出双击事件：短时间内只点一次 👍，避免点上又被取消。
  const reactedAt = useRef(0);
  const thumbsUp = () => {
    if (Date.now() - reactedAt.current < 600) return;
    reactedAt.current = Date.now();
    if (!(message.reactions || []).some(item => item.emoji === '👍' && item.users.includes(viewerId))) onReact?.(message, '👍');
  };
  const mounted = useRef(false);
  // 刚被撤回的那一刻气泡还在页面上，趁换成提示行之前让它粉碎。
  const recalledBefore = useRef(Boolean(message.recalledAt));
  if (message.recalledAt && !recalledBefore.current) { recalledBefore.current = true; disintegrate(bubble.current); }
  useEffect(() => { mounted.current = true; }, []);
  // 只给刚收到/刚发出的消息做入场动效，翻历史时不动。
  const [fresh] = useState(() => Date.now() - message.createdAt < 4000);
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
  if (message.nudge && !message.recalledAt) return <NudgeLine message={message} mine={mine} user={user} viewerId={viewerId} nameOf={nameOf} fresh={fresh} onContextMenu={onContextMenu} />;
  // 系统提示（机器人加入、开关「接收全部消息」）：居中一行，正文在服务器生成。
  if (message.notice && !message.recalledAt) return <article className="recalled-message notice-message" data-message-id={message.id} data-seq={message.seq} onContextMenu={event => onContextMenu?.(event, message)}><Bot size={12} aria-hidden="true" />{message.text}</article>;
  if (burnGone) return <article className="recalled-message burn-destroyed" data-message-id={message.id} data-seq={message.seq}><Flame size={12} aria-hidden="true" />阅后即焚消息已销毁</article>;
  if (message.recalledAt) return <article className="recalled-message" data-message-id={message.id} data-seq={message.seq}>{message.removedBy ? '管理员删除了一条消息' : mine ? '你撤回了一条消息' : `${user?.name || '成员'}撤回了一条消息`}
    {reEditable && <button type="button" className="text-button" onClick={() => onReEdit?.(message)}>重新编辑</button>}</article>;
  const time = <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>;
  // 时间与已读状态放在气泡右下角（Telegram 式）；自己的群消息点「x/n 人已读」查看名单。
  const readNode = mine && recipients.length > 0 && Array.isArray(message.readBy) && (direct
    ? <span className={`message-read-status ${readCount ? 'is-read' : ''}`} data-read-count={readCount}>{readLabel}</span>
    : <button type="button" className={`message-read-status ${readCount ? 'is-read' : ''}`} data-read-count={readCount} aria-haspopup="dialog" title="查看已读成员" onClick={event => onReadDetail?.(event, message)}>{readLabel}</button>);
  const meta = <span className="bubble-meta">{message.editedAt && (hidden || !onShowHistory ? <span className="edited-mark" title={`编辑于 ${formatTime(message.editedAt)}`}>已编辑</span>
    : <button type="button" className="edited-mark" title={`编辑于 ${formatTime(message.editedAt)}，点击查看编辑历史`} onClick={event => { event.stopPropagation(); onShowHistory(message); }}>已编辑</button>)}{time}</span>;
  const reactions = message.reactions || [];
  // 有表情回应时，回应和时间一起放在气泡底部同一行（Telegram 式）。
  const reactionRow = reactions.length > 0 && <div className="bubble-reactions">
    {reactions.map(item => <ReactionChip key={item.emoji} item={item} viewerId={viewerId} nameOf={nameOf} userOf={userOf} live={mounted.current}
      onToggle={selecting ? undefined : () => onReact?.(message, item.emoji)} />)}
    {meta}</div>;
  const lastFile = message.attachments.at(-1);
  const mediaLast = !message.text && lastFile && /^(image|video)\//.test(lastFile.mime);
  const showName = nameShown ?? (!mine && !direct && !continued);
  // 两个及以上的图片或视频排成相册网格，其他文件照常列在下面。
  const media = message.attachments.filter(file => /^(image|video)\//.test(file.mime));
  const album = media.length > 1;
  // 话题入口放在气泡里，宽度跟着气泡走。
  const threadLink = message.thread && onOpenThread && <button type="button" className="thread-link" onClick={() => onOpenThread(message)}><MessagesSquare size={13} />{message.thread.count} 条回复<time>最后 {formatTime(message.thread.lastAt)}</time></button>;
  // 只有一个表情、没有文字时，不画气泡底色。
  const stickerOnly = !message.text && message.attachments.length === 1 && Boolean(message.attachments[0].sticker);
  const bubbleClass = burn ? `message-bubble burn-bubble ${hidden ? 'is-masked' : ''}` : `message-bubble ${stickerOnly ? 'sticker-bubble' : ''} ${hidden ? 'is-masked' : ''} ${message.attachments.length ? 'has-media' : ''} ${mediaLast ? 'media-last' : ''} ${album ? 'has-album' : ''}`;
  const content = hidden ? <div className="masked-message"><span>****</span><EyeOff size={13} />{meta}</div> : burn ? <>
    <BurnBody message={message} mine={mine} content={burnContent} remaining={remaining} onOpen={selecting ? undefined : onOpenBurn} longPressShown={() => Boolean(press.current.menuShown)} onPreview={selecting ? () => {} : onPreview} privateMode={privateMode} nameOf={nameOf} viewerId={viewerId} colorOf={colorOf} />
    <div className="bubble-meta-row">{meta}</div></> : <>
    {showName && <div className="bubble-name" style={mine ? undefined : { color: nameColor(message.senderId, user) }}>{user && !message.bot && onOpenProfile && !selecting
      ? <button type="button" className="name-button" onClick={event => onOpenProfile(user, event.currentTarget)}>{user.name}</button> : user?.name || '成员'}{!mine && <StatusEmoji user={user} />}{(message.bot || user?.bot) && <BotTag />}</div>}
    {message.forwardedFrom && <div className="forward-label">转发自 {message.forwardedFrom.senderId === viewerId ? '我' : nameOf?.(message.forwardedFrom.senderId) || '成员'}</div>}
    {message.replyTo && <Quote color={message.replyTo.senderId ? colorOf?.(message.replyTo.senderId) : undefined} reply={message.replyTo} author={message.replyTo.senderId === viewerId ? '我' : nameOf?.(message.replyTo.senderId) || '成员'} onOpen={selecting ? undefined : () => onOpenQuote?.(message.replyTo, message)} />}
    {message.card ? <ContactCard userId={message.card.userId} userOf={userOf} onOpen={selecting ? undefined : onOpenProfile} /> : message.bundle ? <><BundleCard message={message} onOpen={onOpenBundle} />{!reactionRow && <div className="bubble-meta-row">{meta}</div>}</> : message.poll ? <><PollCard message={message} viewerId={viewerId} nameOf={nameOf} onVote={onVote} onClosePoll={mine ? onClosePoll : undefined} />{!reactionRow && <div className="bubble-meta-row">{meta}</div>}</>
      : message.chain ? <><ChainCard message={message} viewerId={viewerId} nameOf={nameOf} canClose={mine || chainManager} blocked={voiceBlocked} onEntry={selecting ? undefined : onChainEntry} onClose={selecting ? undefined : onCloseChain} />{!reactionRow && <div className="bubble-meta-row">{meta}</div>}</>
      : message.text && <MessageText text={message.text} mentions={message.mentions} nameOf={nameOf} viewerId={viewerId} meta={reactionRow ? null : meta} />}
    {message.text && !message.poll && !message.chain && !message.bundle && firstLink(message.text) && <LinkPreview url={firstLink(message.text)} />}
    {album && <div className={`album album-${media.length}`}>{media.map(file => <Attachment key={file.id} file={file} privateMode={privateMode} onPreview={selecting ? () => {} : onPreview} />)}</div>}
    {message.attachments.filter(file => !album || !media.includes(file)).map(file => <Attachment key={file.id} file={file} privateMode={privateMode} onPreview={selecting ? () => {} : onPreview} />)}
    {!message.text && !reactionRow && (mediaLast ? <span className="bubble-meta-overlay">{meta}</span> : <div className="bubble-meta-row">{meta}</div>)}
    {reactionRow}
  </>;
  // 群聊里头像放在一组连续消息的最后一条旁边（自己的在右侧），这一条带「尾巴」圆角；私聊不显示头像。
  const avatar = !grouped && !direct && (last ? <Avatar user={user} size={32} /> : <span className="avatar-spacer" />);
  const rowClass = `message-row ${mine ? 'mine' : ''} ${continued ? 'continued' : ''} ${last ? 'last' : ''} ${fresh ? 'fresh' : ''}`;
  // 多选时整行可点：点哪里都只切换选中，不触发菜单。按住 Shift 点击或触屏长按是连选到这一条；
  // 安卓长按会先发 contextmenu 再取消触摸，计时器可能等不到，这里一并当作长按。
  const selectRange = () => onToggleSelect?.(message, true);
  if (selecting) return <article className={`${rowClass} selecting ${selected ? 'selected' : ''}`} data-message-id={message.id} data-seq={message.seq}
    onClick={event => { if (!consumeLongPress(press)) onToggleSelect?.(message, event.shiftKey); }} {...longPressHandlers(press, selectRange)}
    onContextMenu={event => { if (press.current.fired) return event.preventDefault(); if (event.nativeEvent.pointerType !== 'touch') return; event.preventDefault(); clearTimeout(press.current.timer); press.current.fired = true; selectRange(); }}>
    <label className="select-check" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selected} disabled={Boolean(burn)} onChange={event => { if (!consumeLongPress(press)) onToggleSelect?.(message, event.nativeEvent.shiftKey); }} aria-label={`选择${user?.name || ''}的消息`} /><span>{selected && <Check size={12} />}</span></label>
    {!mine && avatar}
    <div className="message-column"><div className={bubbleClass}>{content}</div></div>
    {mine && avatar}
  </article>;
  const pressing = longPressHandlers(press, (clientX, clientY) => onContextMenu?.(pressEvent(clientX, clientY), message));
  const swiping = swipe.handlers;
  return <article ref={swipe.row} onContextMenu={event => { if (consumeLongPress(press)) event.preventDefault(); else onContextMenu?.(event, message); }}
    onPointerDown={event => { pressing.onPointerDown(event); swiping.onPointerDown(event); }} onPointerMove={event => { pressing.onPointerMove(event); swiping.onPointerMove(event); }}
    onPointerUp={event => { pressing.onPointerUp(event); swiping.onPointerUp(event); }} onPointerCancel={event => { pressing.onPointerCancel(event); swiping.onPointerCancel(event); }}
    className={`${rowClass} ${swipeReply && onReply ? 'swipeable' : ''} ${swipe.phase}`} data-message-id={message.id} data-seq={message.seq}>
    {swipe.phase && <span className={`swipe-reply-cue ${swipe.armed ? 'armed' : ''}`} aria-hidden="true"><Reply size={16} /></span>}
    {!mine && avatar}
    <div className="message-column">
      <div className="bubble-line"><div ref={bubble} className={bubbleClass} tabIndex={privateMode ? 0 : undefined}
        style={privateMode && revealed ? revealSize.current : undefined}
        onDoubleClick={quickReact && reactionOptions.length > 0 && !burn ? event => {
          // 双击气泡点 👍；双击链接、按钮、图片和附件时照常。
          if (event.target.closest('a, button, input, img, video, .attachment, .code-block, .spoiler')) return;
          window.getSelection()?.removeAllRanges();
          thumbsUp();
        } : undefined}
        onPointerUp={quickReact && reactionOptions.length > 0 && !burn ? event => {
          // 触屏上手机浏览器不一定发出双击事件：自己判断两次轻点（300 毫秒内、位置相近）。
          if (event.pointerType !== 'touch' || event.target.closest('a, button, input, img, video, .attachment, .code-block, .spoiler')) return;
          const last = lastTap.current, now = { time: event.timeStamp, x: event.clientX, y: event.clientY };
          lastTap.current = now;
          if (last && now.time - last.time < 300 && Math.hypot(now.x - last.x, now.y - last.y) < 24) { lastTap.current = null; thumbsUp(); }
        } : undefined}
        onPointerEnter={reveal} onPointerMove={reveal} onPointerLeave={() => setRevealed(false)} onBlur={() => setRevealed(false)}
        onKeyDown={event => { if (event.code === 'Space' && privateMode) { event.preventDefault(); setRevealed(true); } }} onKeyUp={event => { if (event.code === 'Space') setRevealed(false); }}
        aria-label={hidden ? '内容已隐藏，悬停或按住空格查看' : undefined}>{content}{threadLink}</div>
      {(onReply || onPick) && !burn && <div className={`message-actions ${picking ? 'open' : ''}`} onMouseDown={event => { if (event.target.closest('.icon-button')) event.preventDefault(); }}>
        {reactionOptions.length > 0 && <IconButton icon={SmilePlus} label="回应" size={14} aria-expanded={picking} onClick={() => onPick?.(picking ? null : message.id)} />}
        {onReply && <IconButton icon={Reply} label="回复" size={14} onClick={() => onReply(message)} />}
        {picking && <ReactionPalette options={reactionOptions} chosen={(message.reactions || []).filter(item => item.users.includes(viewerId)).map(item => item.emoji)} onPick={emoji => onReact?.(message, emoji)} onClose={() => onPick?.(null)} />}
      </div>}</div>
      {readNode && <div className="read-line">{readNode}</div>}
    </div>
    {mine && avatar}
  </article>;
});

// 发件箱里还没发出去的消息：发送中半透明，失败的在下方给出原因和「重试 / 删除」。
export function OutboxMessage({ item, avatarColumn, onRetry, onDiscard }) {
  const status = item.status === 'sending' ? <><LoaderCircle className="spin" size={12} />发送中…</>
    : item.status === 'waiting' && !item.error ? <><LoaderCircle className="spin" size={12} />等待网络…</>
    : <><CircleAlert size={12} /><span>{item.error || '发送失败'}</span>
      <button type="button" onClick={() => onRetry(item.clientId)}>重试</button><button type="button" onClick={() => onDiscard(item.clientId)}>删除</button></>;
  return <div className={`message-group mine outbox-message ${item.status} ${item.error || item.status === 'failed' ? 'has-error' : ''}`} data-client-id={item.clientId}>
    <div className="group-rows"><article className="message-row mine last"><div className="message-column">
      <div className="bubble-line"><div className="message-bubble">
        {item.payload.burn && <div className="burn-head"><Flame size={13} aria-hidden="true" /><span>阅后即焚 · 对方查看后 {burnSpan(item.payload.burn)}销毁</span></div>}
        {item.preview.text && <FormattedText text={item.preview.text} />}
        {item.preview.files.map((name, index) => <div className="outbox-file" key={index}><FileText size={14} />{name}</div>)}
      </div></div>
      <div className="read-line outbox-status" role="status">{status}</div>
    </div></article></div>
    {avatarColumn && <div className="group-avatar" />}
  </div>;
}

// 菜单项只认「菜单打开之后、在菜单里按下过」的点击：触屏长按弹出菜单时第一项正好在手指下，松手时浏览器补发的那次点击不能算数。
// 键盘（回车、空格）和读屏触发的点击 detail 为 0，照常执行；鼠标点菜单项之前必然先在菜单里按下。
export function ContextMenu({ menu, onClose }) {
  const ref = useRef();
  const armed = useRef(false);
  const smallScreen = matchMedia('(max-width: 760px)').matches;
  const menuWidth = smallScreen ? 220 : 152;
  const viewportHeight = window.visualViewport?.height || innerHeight;
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
  return <div ref={ref} role="menu" aria-label={menu.label} className="message-context-menu" onPointerDown={() => { armed.current = true; }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} style={{ left: Math.max(8, Math.min(menu.x, innerWidth - menuWidth - 8)), top: Math.max(8, Math.min(menu.y, viewportHeight - menu.items.length * (smallScreen ? 44 : 36) - 16)), maxHeight: viewportHeight - 16, overflowY: 'auto' }}>{menu.items.map((item, index) => <button key={item.id} autoFocus={index === 0} role="menuitem" onClick={event => { if (event.detail !== 0 && !armed.current) return; onClose(); item.action(); }}>{item.label}</button>)}</div>;
}

// 资料卡：点头像或名字弹出，显示在线状态、部门、签名；可以直接发消息（自己的卡片是编辑资料）。
// 拍一拍：居中一行「A 拍了拍 B」；刚收到时被拍的人在屏幕上的头像抖一下。
function NudgeLine({ message, mine, user, viewerId, nameOf, fresh, onContextMenu }) {
  const target = message.nudge.targetId;
  useEffect(() => {
    if (!fresh) return;
    const avatars = document.querySelectorAll(`[data-user-id="${CSS.escape(target)}"]`);
    avatars.forEach(element => { element.classList.remove('nudged'); void element.offsetWidth; element.classList.add('nudged'); });
    const timer = setTimeout(() => avatars.forEach(element => element.classList.remove('nudged')), 800);
    return () => clearTimeout(timer);
  }, []);
  const actor = mine ? '我' : user?.name || '成员';
  const targetName = target === message.senderId ? '自己' : target === viewerId ? '我' : nameOf?.(target) || '成员';
  return <article className="recalled-message nudge-message" data-message-id={message.id} data-seq={message.seq} onContextMenu={event => onContextMenu?.(event, message)}>{actor} 拍了拍 {targetName}</article>;
}

export function ProfileCard({ user, anchor, self, note = '', onSaveNote, onMessage, onEdit, onClose, onNudge, onShare, onSetStatus, onSetDepartment, groupActions = [], groupNickname }) {
  const [department, setDepartment] = useState(null);
  const ref = useRef();
  const [editingNote, setEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState(note);
  const [savingNote, setSavingNote] = useState(false);
  const saveNote = async event => {
    event.preventDefault();
    setSavingNote(true);
    try { await onSaveNote(draftNote); setEditingNote(false); } catch {} finally { setSavingNote(false); }
  };
  const [top, setTop] = useState(anchor.y);
  useLayoutEffect(() => { const height = ref.current?.offsetHeight || 0; setTop(Math.max(8, Math.min(anchor.y, innerHeight - height - 8))); }, [anchor.y]);
  useEffect(() => {
    ref.current?.focus();
    const dismiss = event => { if (!ref.current?.contains(event.target)) onClose(); };
    // 在弹窗里打开时，Esc 只关资料卡，不连带关掉弹窗。
    const key = event => {
      if (event.key !== 'Escape' || (ref.current?.contains(event.target) && event.target.tagName === 'INPUT')) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  const status = user.bot ? botStatusText(user) : user.removed ? '已离开空间' : user.online ? '在线' : user.lastSeen ? seenText(user.lastSeen) : '离线';
  return <div ref={ref} role="dialog" aria-label={`${user.name}的资料`} tabIndex={-1} className="profile-card"
    style={{ left: Math.max(8, Math.min(anchor.x, innerWidth - 268)), top }}>
    <Avatar user={user} size={64} online={user.removed || user.bot ? undefined : user.online} />
    <h3 style={{ color: nameColor(user.id, user) }}>{user.name}{self && <small className="me-tag">我</small>}{user.bot && <BotTag />}</h3>
    {groupNickname && <p className="profile-status">群昵称：{groupNickname}</p>}
    {status && <p className={`profile-status ${user.online ? 'online' : ''}`}>{status}</p>}
    {user.bot?.receiveAll && !user.removed && <p className="profile-status bot-listening">接收它所在群聊和大厅的全部消息</p>}
    {activeStatus(user) && <p className="profile-custom-status">{activeStatus(user).emoji} {activeStatus(user).text}{activeStatus(user).until && <small>到 {new Date(activeStatus(user).until).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>}</p>}
    {department !== null ? <form className="profile-note editing" onSubmit={async event => { event.preventDefault(); try { await onSetDepartment(department.trim()); setDepartment(null); } catch {} }}>
      <input autoFocus aria-label={`设置${user.name}的部门`} placeholder="部门，如：研发部" maxLength={40} value={department} onChange={event => setDepartment(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDepartment(null); } }} />
      <span><button type="button" className="secondary-button" onClick={() => setDepartment(null)}>取消</button><button className="primary-button">保存</button></span></form>
    : (user.department || user.bio || onSetDepartment) && <dl>
      {(user.department || onSetDepartment) && <><dt>部门{onSetDepartment && <button type="button" className="text-button dept-edit" onClick={() => setDepartment(user.department || '')}>{user.department ? '修改' : '设置'}</button>}</dt><dd>{user.department || '未设置'}</dd></>}
      {user.bio && <><dt>{user.bot ? '简介' : '签名'}</dt><dd>{user.bio}</dd></>}
    </dl>}
    {/* 备注只有自己看得到，也只显示在资料卡里 */}
    {!self && (editingNote ? <form className="profile-note editing" onSubmit={saveNote}>
      <input autoFocus aria-label={`给${user.name}写备注`} placeholder="只有你自己能看到" maxLength={200} value={draftNote} disabled={savingNote}
        onChange={event => setDraftNote(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraftNote(note); setEditingNote(false); } }} />
      <span><button type="button" className="secondary-button" onClick={() => { setDraftNote(note); setEditingNote(false); }}>取消</button><button className="primary-button" disabled={savingNote}>保存</button></span>
    </form> : <button type="button" className={`profile-note ${note ? '' : 'empty'}`} onClick={() => { setDraftNote(note); setEditingNote(true); }} title="只有你自己能看到备注">
      <small>备注</small><span>{note || '添加备注'}</span><PencilLine size={13} />
    </button>)}
    {self && onSetStatus && <button type="button" className="secondary-button" onClick={onSetStatus}>{activeStatus(user) ? '修改状态' : '设置状态'}</button>}
    {self ? <button type="button" className="secondary-button" onClick={onEdit}>编辑资料</button>
      : !user.removed && <button type="button" className="primary-button" onClick={onMessage}><MessageCircle size={15} />发送消息</button>}
    {onNudge && <button type="button" className="secondary-button" onClick={onNudge}><Hand size={15} />{self ? '拍拍自己' : '拍一拍'}</button>}
    {onShare && !user.removed && <button type="button" className="secondary-button" onClick={onShare}><Contact size={15} />推荐给别人</button>}
    {groupActions.length > 0 && <div className="profile-group-actions">{groupActions.map(item => <button type="button" key={item.label} className={`text-button ${item.danger ? 'danger-text' : ''}`} onClick={item.action}>{item.label}</button>)}</div>}
  </div>;
}

export function ReadDetail({ anchor, message, members, onClose, onOpenProfile }) {
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
  const list = users => users.map(user => <li key={user.id}><button type="button" title="查看资料" onClick={event => onOpenProfile?.(user, event.currentTarget)}><Avatar user={user} size={20} /><span>{user.name}</span></button></li>);
  return <div ref={ref} role="dialog" aria-label="已读详情" tabIndex={-1} className="read-detail"
    style={{ left: Math.max(8, Math.min(anchor.x - 240, innerWidth - 248)), bottom: Math.max(8, innerHeight - anchor.y + 6) }}>
    <section><h4>已读<small>{read.length}</small></h4>{read.length ? <ul>{list(read)}</ul> : <p>还没有人读</p>}</section>
    <section><h4>未读<small>{unread.length}</small></h4>{unread.length ? <ul>{list(unread)}</ul> : <p>全员已读</p>}</section>
  </div>;
}

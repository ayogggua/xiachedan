import React, { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, Search, X } from 'lucide-react';
import { api, formatTime } from './api';
import { Avatar, IconButton, PrivatePreview, Skeleton } from './components';
import { plainText } from './markdown';
import { attachmentLabel } from '../shared/preview.js';

// 标成剧透的图片和视频不显示文件名。
// 接龙和预览一样带「[接龙]」。
const searchText = message => (message.chain && `[接龙] ${message.text}`) || (message.text && plainText(message.text).replace(/\s+/g, ' ')) || message.attachments.map(file => file.spoiler ? attachmentLabel([file]) : file.name).join('、');
const stamp = timestamp => new Date(timestamp).toDateString() === new Date().toDateString() ? formatTime(timestamp)
  : `${new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${formatTime(timestamp)}`;

function Highlight({ text, query }) {
  if (!query) return text;
  const lower = text.toLowerCase(), needle = query.toLowerCase(), parts = [];
  for (let start = 0, index; start < text.length; start = index + needle.length) {
    index = lower.indexOf(needle, start);
    if (index < 0) { parts.push(text.slice(start)); break; }
    parts.push(text.slice(start, index), <mark key={index}>{text.slice(index, index + needle.length)}</mark>);
  }
  return parts;
}

// 输入停顿 250 毫秒后检索；roomId 为空时检索自己能访问的全部会话。
// filters 可选：{ sender, type, from }，有筛选时关键词可以为空。
export function useMessageSearch(term, roomId, historyVersion, enabled = true, filters = {}) {
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  // 请求真正发出之后才算「正在搜索」：停顿等待的 250 毫秒不算，加载占位从这里开始计时。
  const [pending, setPending] = useState(false);
  const filterKey = JSON.stringify(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)));
  useEffect(() => {
    setResults(null); setError(''); setPending(false);
    const extra = JSON.parse(filterKey);
    if ((!term && !Object.keys(extra).length) || !enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setPending(true);
      api(`search?${new URLSearchParams({ ...(roomId ? { roomId } : {}), q: term, ...extra })}`)
        .then(result => { if (!cancelled) setResults(result.messages); })
        .catch(failure => { if (!cancelled) setError(failure.message); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, roomId, historyVersion, enabled, filterKey]);
  return { results, error, pending };
}

export function SearchResult({ message, term, avatar, title, prefix = '', privateMode, onJump, at }) {
  const text = prefix + searchText(message);
  return <button type="button" className="history-result" onClick={() => onJump(message)}>
    {avatar}
    <span className="history-copy"><span className="history-meta"><b>{title}</b><time>{stamp(at || message.createdAt)}</time></span>
      <span className="history-text">{privateMode ? <PrivatePreview privateMode>{text}</PrivatePreview> : <Highlight text={text} query={term} />}</span></span>
  </button>;
}

export function SearchStatus({ term, results, error, scope, pending }) {
  if (error) return <p className="form-error" role="alert">{error}</p>;
  // 搜索结果都放在 aria-live 区域里，加载占位不再自带 status。
  if (results === null) return pending ? <Skeleton rows={3} label="正在搜索…" live={false} /> : null;
  if (!results.length) return <p className="history-empty">{term ? `${scope || ''}没有找到包含「${term}」的消息。` : '没有符合筛选条件的消息。'}</p>;
  if (results.length === 50) return <p className="history-empty">只显示最近 50 条结果，换个更具体的关键词试试。</p>;
  return null;
}

const RANGES = [['', '不限时间'], ['1', '今天'], ['7', '最近 7 天'], ['30', '最近 30 天']];
const TYPES = [['', '全部类型'], ['image', '图片'], ['video', '视频'], ['file', '文件'], ['link', '链接']];

export default function HistorySearch({ room, userMap, members = [], privateMode, historyVersion, onBack, onJump }) {
  const [query, setQuery] = useState('');
  const [sender, setSender] = useState('');
  const [type, setType] = useState('');
  const [range, setRange] = useState('');
  const term = query.trim();
  const from = range ? String((() => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - Number(range) + 1); return date.getTime(); })()) : '';
  const filtered = Boolean(sender || type || range);
  const { results, error, pending } = useMessageSearch(term, room.id, historyVersion, true, { sender, type, from });
  // 跳到某一天：找那天（或之后最近一天）的第一条消息。
  const [dateNote, setDateNote] = useState('');
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  async function jumpToDate(value) {
    if (!value) return;
    const [year, month, day] = value.split('-').map(Number), start = new Date(year, month - 1, day).getTime();
    try {
      const target = await api(`message-at?roomId=${encodeURIComponent(room.id)}&time=${start}`);
      const found = new Date(target.createdAt);
      setDateNote(found.getTime() - start >= 86400000 ? `那天没有消息，已跳到 ${found.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} 的第一条` : '');
      onJump(target);
    } catch (failure) { setDateNote(failure.message); }
  }
  return <>
    <div className="members-panel-heading"><IconButton icon={ChevronLeft} label="返回会话成员" size={16} onClick={onBack} /><h3 className="history-title">聊天记录</h3></div>
    <label className="sidebar-search history-search"><Search size={14} /><input autoFocus aria-label="搜索聊天记录" placeholder={`搜索「${room.name}」`} value={query} maxLength={100} onChange={event => setQuery(event.target.value)} />{query && <IconButton icon={X} label="清空搜索" size={14} onClick={() => setQuery('')} />}</label>
    <div className="search-filters">
      <select aria-label="发送人" value={sender} onChange={event => setSender(event.target.value)}><option value="">所有人</option>{members.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
      <select aria-label="类型" value={type} onChange={event => setType(event.target.value)}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="时间" value={range} onChange={event => setRange(event.target.value)}>{RANGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    <label className="jump-date"><CalendarDays size={14} /><span>跳到日期</span><input type="date" aria-label="跳到日期" max={today} onChange={event => jumpToDate(event.target.value)} /></label>
    {dateNote && <p className="inline-note jump-date-note" role="status">{dateNote}</p>}
    <div className="history-results" aria-live="polite">
      {!term && !filtered ? <p className="history-empty">输入关键词，或按发送人、类型、时间筛选这个会话里的消息。</p> : <>
        {results?.map(message => <SearchResult key={message.id} message={message} term={term} avatar={<Avatar user={userMap[message.senderId]} size={24} />}
          title={userMap[message.senderId]?.name || message.bot || '成员'} privateMode={privateMode} onJump={onJump} />)}
        <SearchStatus term={term} results={results} error={error} pending={pending} />
      </>}
    </div>
  </>;
}

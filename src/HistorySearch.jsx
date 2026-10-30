import React, { useEffect, useState } from 'react';
import { ChevronLeft, Search, X, LoaderCircle } from 'lucide-react';
import { api, formatTime } from './api';
import { Avatar, IconButton, PrivatePreview } from './components';

const searchText = message => message.text || message.attachments.map(file => file.name).join('、');
const stamp = timestamp => new Date(timestamp).toDateString() === new Date().toDateString() ? formatTime(timestamp)
  : `${new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${formatTime(timestamp)}`;

function Highlight({ text, query }) {
  const lower = text.toLowerCase(), needle = query.toLowerCase(), parts = [];
  for (let start = 0, index; start < text.length; start = index + needle.length) {
    index = lower.indexOf(needle, start);
    if (index < 0) { parts.push(text.slice(start)); break; }
    parts.push(text.slice(start, index), <mark key={index}>{text.slice(index, index + needle.length)}</mark>);
  }
  return parts;
}

export default function HistorySearch({ room, userMap, privateMode, historyVersion, onBack, onJump }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const term = query.trim();
  useEffect(() => {
    setResults(null); setError('');
    if (!term) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api(`search?roomId=${encodeURIComponent(room.id)}&q=${encodeURIComponent(term)}`)
        .then(result => { if (!cancelled) setResults(result.messages); })
        .catch(failure => { if (!cancelled) setError(failure.message); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, room.id, historyVersion]);
  return <>
    <div className="members-panel-heading"><IconButton icon={ChevronLeft} label="返回会话成员" size={16} onClick={onBack} /><h3 className="history-title">聊天记录</h3></div>
    <label className="sidebar-search history-search"><Search size={14} /><input autoFocus aria-label="搜索聊天记录" placeholder={`搜索「${room.name}」`} value={query} maxLength={100} onChange={event => setQuery(event.target.value)} />{query && <IconButton icon={X} label="清空搜索" size={14} onClick={() => setQuery('')} />}</label>
    <div className="history-results" aria-live="polite">
      {!term ? <p className="history-empty">输入关键词，搜索这个会话里的文字和文件名。</p>
        : error ? <p className="form-error" role="alert">{error}</p>
        : results === null ? <p className="history-empty"><LoaderCircle className="spin" size={14} />正在搜索…</p>
        : !results.length ? <p className="history-empty">没有找到包含「{term}」的消息。</p>
        : results.map(message => <button type="button" className="history-result" key={message.id} onClick={() => onJump(message)}>
          <Avatar user={userMap[message.senderId]} size={24} />
          <span className="history-copy"><span className="history-meta"><b>{userMap[message.senderId]?.name || '成员'}</b><time>{stamp(message.createdAt)}</time></span>
            <span className="history-text">{privateMode ? <PrivatePreview privateMode>{searchText(message)}</PrivatePreview> : <Highlight text={searchText(message)} query={term} />}</span></span>
        </button>)}
      {results?.length === 50 && <p className="history-empty">只显示最近 50 条结果，换个更具体的关键词试试。</p>}
    </div>
  </>;
}

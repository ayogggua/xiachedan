import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ArrowUp, LoaderCircle } from 'lucide-react';
import { api, formatTime, uid } from './api';
import { Avatar, IconButton, PrivatePreview } from './components';
import { FormattedText } from './markdown';

// 话题面板：根消息在上，回复按时间排在下面，底部可以直接在话题里回复。
export default function ThreadPanel({ rootId, userMap, viewerId, privateMode, threadTick, onBack, notify }) {
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef();
  useEffect(() => {
    let alive = true;
    api(`thread?rootId=${encodeURIComponent(rootId)}`).then(result => { if (alive) setThread(result); }).catch(error => notify(error.message));
    return () => { alive = false; };
  }, [rootId, threadTick.rootId === rootId ? threadTick.n : 0]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [thread?.replies.length]);
  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const { message } = await api('messages', { roomId: thread.root.roomId, text: text.trim(), clientId: uid(), threadOf: rootId });
      setThread(previous => ({ ...previous, replies: [...previous.replies.filter(item => item.id !== message.id), message] }));
      setText('');
    } catch (error) { notify(error.message); } finally { setSending(false); }
  }
  const row = (message, root = false) => {
    const user = userMap[message.senderId] || (message.bot ? { name: message.bot, avatar: 'bot' } : null);
    return <article key={message.id} className={`thread-message ${root ? 'root' : ''}`}><Avatar user={user} size={26} />
      <div><div className="thread-meta"><b>{message.senderId === viewerId ? '我' : user?.name || '成员'}</b><time>{formatTime(message.createdAt)}</time></div>
        {message.recalledAt ? <p className="thread-recalled">消息已撤回</p> : <PrivatePreview privateMode={privateMode}><FormattedText text={message.text || message.attachments.map(file => `[${file.name}]`).join(' ')} mentions={message.mentions} nameOf={id => userMap[id]?.name} viewerId={viewerId} /></PrivatePreview>}</div>
    </article>;
  };
  return <>
    <div className="members-panel-heading"><IconButton icon={ChevronLeft} label="返回" size={16} onClick={onBack} /><h3 className="history-title">话题{thread ? ` · ${thread.replies.filter(item => !item.recalledAt).length} 条回复` : ''}</h3></div>
    <div className="thread-list" ref={list}>{!thread ? <p className="history-empty"><LoaderCircle className="spin" size={14} />正在加载…</p> : <>{row(thread.root, true)}{thread.replies.map(message => row(message))}</>}</div>
    <div className="thread-composer"><textarea aria-label="在话题中回复" placeholder="在话题中回复" rows={2} value={text} maxLength={10000} onChange={event => setText(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
      <button type="button" className="send-button round-button" aria-label="发送到话题" disabled={!text.trim() || sending || !thread} onClick={send}>{sending ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={17} strokeWidth={2.2} />}</button></div>
  </>;
}

import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, LoaderCircle } from 'lucide-react';
import { api } from './api';
import { IconButton, Message, OutboxMessage } from './components';
import Composer from './Composer';

// 话题面板：根消息在上，回复按时间排在下面。消息和输入框与主聊天共用组件：右键菜单、资料卡、回应、
// 「/」格式菜单、快捷键、@ 成员、附件和发件箱都一样。
export default function ThreadPanel({ rootId, room, viewerId, privateMode, threadTick, onBack, notify, onLoaded, handlers, userOf, reactionOptions, reactingTo, quickReact,
  composer, blocked, outbox, editing, onCancelEdit, onEdited, onEditLast }) {
  const [thread, setThread] = useState(null);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const list = useRef();
  const stick = useRef(true);
  const tick = threadTick.rootId === rootId || threadTick.rootId === '*' ? threadTick.n : 0;
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setError('');
    api(`thread?rootId=${encodeURIComponent(rootId)}`, undefined, { signal: controller.signal })
      .then(result => { if (alive) { setThread(result); setError(''); } })
      .catch(failure => { if (alive && !controller.signal.aborted) setError(failure.message); });
    return () => { alive = false; controller.abort(); };
  }, [rootId, tick, retryCount]);
  useEffect(() => { if (thread) onLoaded?.([thread.root, ...thread.replies]); }, [thread]);
  useEffect(() => () => onLoaded?.([]), []);
  const pending = outbox.items.filter(item => item.payload.threadOf === rootId);
  // 新回复到达时，原本就在底部才跟着滚到底，正在往上翻时不打扰。
  useEffect(() => { if (stick.current) list.current?.scrollTo({ top: list.current.scrollHeight }); }, [thread?.replies.length, pending.length]);
  const replies = thread?.replies || [];
  const row = (message, index, items) => {
    const previous = items[index - 1], next = items[index + 1];
    const continued = Boolean(previous && previous.senderId === message.senderId && !previous.recalledAt);
    const last = !next || next.senderId !== message.senderId;
    return <Message {...handlers} key={message.id} message={message} user={userOf(message)} mine={message.senderId === viewerId} continued={continued} last={last}
      viewerId={viewerId} privateMode={privateMode} direct={room.kind === 'direct'} reactionOptions={reactionOptions} picking={reactingTo === message.id} quickReact={quickReact}
      onReply={undefined} onOpenThread={undefined} onRead={undefined} readingEnabled={false} />;
  };
  const count = replies.filter(item => !item.recalledAt).length;
  return <div className="thread-panel">
    <div className="members-panel-heading"><IconButton icon={ChevronLeft} label="返回" size={16} onClick={onBack} /><h3 className="history-title">话题{thread ? ` · ${count} 条回复` : ''}</h3></div>
    <div className="thread-list" ref={list} onScroll={event => { const node = event.currentTarget; stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40; }}>
      {!thread ? (error ? <div className="inline-error-row" role="alert"><p className="form-error">{error}</p><button type="button" className="secondary-button" onClick={() => setRetryCount(c => c + 1)}>重试</button></div> : <p className="history-empty"><LoaderCircle className="spin" size={14} />正在加载…</p>) : <>
        {error && <div className="inline-error-row" role="alert"><p className="form-error">{error}</p><button type="button" className="secondary-button" onClick={() => setRetryCount(c => c + 1)}>重试</button></div>}
        <div className="thread-root">{row({ ...thread.root, thread: undefined }, 0, [thread.root])}</div>
        <div className="date-divider thread-divider"><span>{count ? `${count} 条回复` : '还没有回复'}</span></div>
        {replies.map((message, index) => row(message, index, replies))}
        {pending.map(item => <OutboxMessage key={item.clientId} item={item} avatarColumn={false} onRetry={outbox.retry} onDiscard={outbox.discard} />)}
      </>}
    </div>
    <div className="thread-composer-area">{blocked ? <div className="muted-notice" role="status">{blocked}</div>
      : thread && <Composer {...composer} room={room} placeholder="在话题中回复" onQueue={(payload, preview) => outbox.send({ ...payload, threadOf: rootId }, preview)}
        editing={editing} onCancelEdit={onCancelEdit} onEdited={onEdited} onEditLast={onEditLast} />}</div>
  </div>;
}

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
  const list = useRef();
  const stick = useRef(true);
  const tick = threadTick.rootId === rootId || threadTick.rootId === '*' ? threadTick.n : 0;
  useEffect(() => {
    let alive = true;
    api(`thread?rootId=${encodeURIComponent(rootId)}`).then(result => { if (alive) setThread(result); }).catch(error => notify(error.message));
    return () => { alive = false; };
  }, [rootId, tick]);
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
      {!thread ? <p className="history-empty"><LoaderCircle className="spin" size={14} />正在加载…</p> : <>
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

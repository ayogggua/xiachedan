import React, { useEffect, useState } from 'react';
import { ChevronLeft, Film, FileText, Download } from 'lucide-react';
import { api, mediaUrl, formatSize } from './api';
import { IconButton } from './components';

// 会话里发过的图片、视频和文件：图片网格点开大图，文件可以直接下载或跳回原消息。
export default function RoomFiles({ room, userMap, privateMode, historyVersion, onBack, onPreview, onJump }) {
  const [kind, setKind] = useState('media');
  const [items, setItems] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const load = (before, append) => api(`room-files?roomId=${encodeURIComponent(room.id)}&kind=${kind}${before ? `&before=${before}` : ''}`)
    .then(result => { setItems(previous => append ? [...previous, ...result.items] : result.items); setHasMore(result.hasMore); })
    .catch(failure => setError(failure.message));
  useEffect(() => { setItems(null); setError(''); load(); }, [room.id, kind, historyVersion]);
  const day = time => new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  return <>
    <div className="members-panel-heading"><IconButton icon={ChevronLeft} label="返回会话成员" size={16} onClick={onBack} /><h3 className="history-title">图片与文件</h3></div>
    <div className="segmented-control files-tabs" role="group" aria-label="类型">{[['media', '图片和视频'], ['file', '文件']].map(([key, label]) =>
      <button key={key} type="button" className={kind === key ? 'active' : ''} aria-pressed={kind === key} onClick={() => setKind(key)}>{label}</button>)}</div>
    <div className="history-results">
      {error && <p className="form-error" role="alert">{error}</p>}
      {!items ? <p className="history-empty">正在加载…</p> : !items.length ? <p className="history-empty">{kind === 'media' ? '这里还没有发过图片或视频。' : '这里还没有发过文件。'}</p>
        : kind === 'media' ? <div className="media-grid">{items.map(item => <button type="button" key={`${item.messageId}-${item.file.id}`} className={`media-tile ${privateMode ? 'masked' : ''}`}
          title={`${userMap[item.senderId]?.name || '成员'} · ${day(item.createdAt)}`} aria-label={item.file.name}
          onClick={() => item.file.mime.startsWith('image/') && !privateMode ? onPreview(item.file) : onJump({ id: item.messageId, seq: item.seq, roomId: room.id })}>
          {item.file.mime.startsWith('image/') ? <img src={mediaUrl(item.file.thumbId || item.file.id)} alt="" loading="lazy" /> : <span className="media-video"><Film size={20} /></span>}
        </button>)}</div>
        : <ul className="file-list">{items.map(item => <li key={`${item.messageId}-${item.file.id}`}>
          <button type="button" className="file-jump" onClick={() => onJump({ id: item.messageId, seq: item.seq, roomId: room.id })}><FileText size={18} />
            <span><b>{item.file.name}</b><small>{formatSize(item.file.size)} · {userMap[item.senderId]?.name || '成员'} · {day(item.createdAt)}</small></span></button>
          <a href={mediaUrl(item.file.id, true)} download aria-label={`下载 ${item.file.name}`} title="下载"><Download size={15} /></a>
        </li>)}</ul>}
      {hasMore && <button type="button" className="secondary-button load-more" onClick={() => load(items.at(-1).seq, true)}>加载更多</button>}
    </div>
  </>;
}

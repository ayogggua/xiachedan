import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Film, Send, X, LoaderCircle, RotateCcw, Paperclip, ShieldCheck } from 'lucide-react';
import { api, upload, uid, formatSize } from './api';
import { IconButton } from './components';

const empty = { text: '', files: [] };
export default function Composer({ room, connected, privateMode, onSent, notify }) {
  const [drafts, setDrafts] = useState({});
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef();
  const videoInput = useRef();
  const textarea = useRef();
  const draftsRef = useRef(drafts);
  const attempts = useRef({});
  const draft = drafts[room.id] || empty;
  draftsRef.current = drafts;
  const update = (id, fn) => setDrafts(previous => ({ ...previous, [id]: fn(previous[id] || empty) }));
  useEffect(() => () => { for (const draft of Object.values(draftsRef.current)) for (const item of draft.files) URL.revokeObjectURL(item.url); }, []);
  async function uploadItem(item, roomId) {
    update(roomId, state => ({ ...state, files: state.files.map(file => file.id === item.id ? { ...file, error: '', progress: 0 } : file) }));
    try {
      const { attachment } = await upload(item.file, { roomId }, progress => update(roomId, state => ({ ...state, files: state.files.map(file => file.id === item.id ? { ...file, progress } : file) })));
      update(roomId, state => ({ ...state, files: state.files.map(file => file.id === item.id ? { ...file, attachment, progress: 100 } : file) }));
    } catch (error) { update(roomId, state => ({ ...state, files: state.files.map(file => file.id === item.id ? { ...file, error: error.message } : file) })); notify(error.message); }
  }
  function addFiles(files) {
    if (!connected) return notify('连接恢复后再发送文件');
    const roomId = room.id;
    const existing = draftsRef.current[roomId]?.files.length || 0;
    const available = 6 - existing;
    if (files.length > available) notify('每条消息最多 6 个附件');
    const items = Array.from(files).slice(0, available).filter(file => {
      if (file.size > 100 * 1024 * 1024) { notify(`${file.name} 超过 100 MB`); return false; }
      if (!/\.(jpe?g|png|gif|webp|mp4|mov|webm)$/i.test(file.name) && !/^(image\/(png|jpeg|gif|webp)|video\/(mp4|quicktime|webm))$/.test(file.type)) { notify('请选择图片或视频文件'); return false; }
      return true;
    }).map(file => ({ id: uid(), file, url: URL.createObjectURL(file), progress: 0 }));
    update(roomId, state => ({ ...state, files: [...state.files, ...items] }));
    for (const item of items) uploadItem(item, roomId);
  }
  function removeFile(item) {
    URL.revokeObjectURL(item.url);
    update(room.id, state => ({ ...state, files: state.files.filter(file => file.id !== item.id) }));
  }
  async function send() {
    if (sending || !connected || (!draft.text.trim() && !draft.files.length) || draft.files.some(file => !file.attachment)) return;
    const roomId = room.id;
    const snapshot = draft;
    const signature = JSON.stringify([snapshot.text, snapshot.files.map(file => file.attachment.id)]);
    const attempt = attempts.current[roomId];
    const clientId = attempt?.signature === signature ? attempt.clientId : uid();
    attempts.current[roomId] = { signature, clientId };
    textarea.current?.focus({ preventScroll: true });
    setSending(true);
    try {
      const { message } = await api('messages', { roomId, text: snapshot.text, attachmentIds: snapshot.files.map(file => file.attachment.id), clientId });
      onSent(message);
      for (const file of snapshot.files) URL.revokeObjectURL(file.url);
      update(roomId, () => ({ text: '', files: [] }));
      delete attempts.current[roomId];
    } catch (error) { notify(`${error.message}，草稿已保留`); } finally { setSending(false); }
  }
  const ready = connected && !sending && (draft.text.trim() || draft.files.length) && draft.files.every(file => file.attachment);
  return <div className="composer-area"><div className={`composer ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (!sending) addFiles(event.dataTransfer.files); }}>
    {dragging && <div className="drop-overlay"><Paperclip size={26} /><span>松开鼠标，分享图片或视频</span></div>}
    {draft.files.length > 0 && <div className="attachment-queue">{draft.files.map(item => <div className={`queued-file ${item.error ? 'failed' : ''}`} key={item.id}>
      {item.file.type.startsWith('image/') ? <img src={item.url} alt="待发送图片" /> : <span className="queued-video"><Film size={22} /></span>}
      <div><span>{item.file.name}</span><small>{item.error ? '上传失败' : item.attachment ? formatSize(item.file.size) : `上传 ${item.progress}%`}</small></div>
      {item.error && <IconButton icon={RotateCcw} label="重试上传" onClick={() => uploadItem(item, room.id)} />}
      <IconButton icon={X} label="移除附件" onClick={() => removeFile(item)} disabled={sending} />
    </div>)}</div>}
    <textarea ref={textarea} aria-label="消息内容" placeholder={`发送消息到 ${room.name}…`} value={draft.text} readOnly={sending} aria-busy={sending} maxLength={10000} rows={3} onChange={event => update(room.id, state => ({ ...state, text: event.target.value }))}
      onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); if (!sending) addFiles(event.clipboardData.files); } }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } }} />
    <div className="composer-bottom"><div className="composer-tools"><IconButton icon={ImageIcon} label="发送图片" disabled={sending || !connected} onClick={() => input.current.click()} /><IconButton icon={Film} label="发送视频" disabled={sending || !connected} onClick={() => videoInput.current.click()} /><span className="composer-divider" /><span className="attachment-hint">拖入文件，或粘贴图片</span></div><div className="send-actions"><span>Enter 发送 · Shift + Enter 换行</span><button className="send-button" onClick={send} disabled={!ready} aria-label="发送消息">{sending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}<span>发送</span></button></div></div>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }} /><input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm,.mov" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
  </div><div className="composer-footnote"><ShieldCheck size={12} /><span>{privateMode ? '隐私模式已开启 · 鼠标移开即隐藏内容' : '有事说事，没事虾扯蛋。'}</span><span className="file-limit">单个文件最大 100 MB</span></div></div>;
}

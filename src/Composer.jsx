import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Film, ArrowUp, X, LoaderCircle, RotateCcw, Paperclip, Users, FileText } from 'lucide-react';
import { api, upload, uid, formatSize } from './api';
import { Avatar, IconButton, PrivatePreview } from './components';
import { previewText } from './history';

const empty = { text: '', files: [], mentions: [] };
const EVERYONE = { id: '*', name: '所有人' };
export default function Composer({ room, connected, onSent, notify, reply, replyAuthor, onCancelReply, privateMode, members = [], canMentionAll = false }) {
  const [picker, setPicker] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef();
  const videoInput = useRef();
  const fileInput = useRef();
  const textarea = useRef();
  const draftsRef = useRef(drafts);
  const attempts = useRef({});
  const draft = drafts[room.id] || empty;
  draftsRef.current = drafts;
  const update = (id, fn) => setDrafts(previous => ({ ...previous, [id]: fn(previous[id] || empty) }));
  // 输入「@」后列出会话成员；只看光标前紧挨着的这一段。
  const candidates = picker ? [...(canMentionAll ? [EVERYONE] : []), ...members]
    .filter(user => user.name.toLowerCase().includes(picker.query.toLowerCase())).slice(0, 8) : [];
  function detectMention(node) {
    const match = (members.length || canMentionAll) && node.selectionStart === node.selectionEnd && node.value.slice(0, node.selectionStart).match(/@([^\s@]{0,24})$/);
    setPicker(match ? { start: node.selectionStart - match[1].length - 1, query: match[1], index: 0 } : null);
  }
  function chooseMention(user) {
    const insert = `@${user.name} `, start = picker.start;
    update(room.id, state => ({ ...state, text: state.text.slice(0, start) + insert + state.text.slice(start + 1 + picker.query.length),
      mentions: [...new Set([...(state.mentions || []), user.id])] }));
    setPicker(null);
    requestAnimationFrame(() => { const node = textarea.current; node?.focus(); node?.setSelectionRange(start + insert.length, start + insert.length); });
  }
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
      if (!file.size) { notify(`${file.name} 是空文件`); return false; }
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
    const replyTo = reply?.id || null;
    // 只保留正文里仍写着「@名字」的提及。
    const nameOf = id => id === '*' ? EVERYONE.name : members.find(user => user.id === id)?.name;
    const mentions = (snapshot.mentions || []).filter(id => nameOf(id) && snapshot.text.includes(`@${nameOf(id)}`));
    const signature = JSON.stringify([snapshot.text, snapshot.files.map(file => file.attachment.id), replyTo, mentions]);
    const attempt = attempts.current[roomId];
    const clientId = attempt?.signature === signature ? attempt.clientId : uid();
    attempts.current[roomId] = { signature, clientId };
    textarea.current?.focus({ preventScroll: true });
    setSending(true);
    try {
      const { message } = await api('messages', { roomId, text: snapshot.text, attachmentIds: snapshot.files.map(file => file.attachment.id), clientId, ...(replyTo ? { replyTo } : {}), ...(mentions.length ? { mentions } : {}) });
      onSent(message);
      if (replyTo) onCancelReply?.();
      for (const file of snapshot.files) URL.revokeObjectURL(file.url);
      update(roomId, () => empty);
      delete attempts.current[roomId];
    } catch (error) { notify(`${error.message}，草稿已保留`); } finally { setSending(false); }
  }
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, [draft.text, room.id]);
  const ready = connected && !sending && (draft.text.trim() || draft.files.length) && draft.files.every(file => file.attachment);
  // 选择回复时把焦点交给输入框。
  useEffect(() => { if (reply) textarea.current?.focus({ preventScroll: true }); }, [reply?.id]);
  useEffect(() => setPicker(null), [room.id]);
  return <div className="composer-area">
    {picker && candidates.length > 0 && <div className="mention-picker" role="listbox" id="mention-picker" aria-label="选择要提及的成员">
      {candidates.map((user, index) => <button type="button" role="option" id={`mention-option-${index}`} key={user.id} aria-selected={index === picker.index} className={index === picker.index ? 'active' : ''}
        onPointerDown={event => { event.preventDefault(); chooseMention(user); }}>
        {user.id === '*' ? <span className="mention-everyone"><Users size={13} /></span> : <Avatar user={user} size={22} />}<span>{user.name}</span>{user.id === '*' && <small>提醒会话里的每个人</small>}
      </button>)}
    </div>}
    {reply && <div className="reply-bar" role="status"><span className="reply-copy"><b>回复 {replyAuthor}</b><PrivatePreview privateMode={privateMode}>{previewText(reply)}</PrivatePreview></span><IconButton icon={X} label="取消回复" size={14} onClick={onCancelReply} /></div>}
    {draft.files.length > 0 && <div className="attachment-queue">{draft.files.map(item => <div className={`queued-file ${item.error ? 'failed' : ''}`} key={item.id}>
      {item.file.type.startsWith('image/') ? <img src={item.url} alt="待发送图片" /> : <span className="queued-video">{item.file.type.startsWith('video/') ? <Film size={18} /> : <FileText size={18} />}</span>}
      <div><span>{item.file.name}</span><small>{item.error ? '上传失败' : item.attachment ? formatSize(item.file.size) : `上传 ${item.progress}%`}</small></div>
      {item.error && <IconButton icon={RotateCcw} label="重试上传" size={15} onClick={() => uploadItem(item, room.id)} />}
      <IconButton icon={X} label="移除附件" size={15} onClick={() => removeFile(item)} disabled={sending} />
    </div>)}</div>}
    <div className={`composer ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (!sending) addFiles(event.dataTransfer.files); }}>
      {dragging && <div className="drop-overlay"><Paperclip size={18} /><span>松开鼠标，发送文件</span></div>}
      <IconButton icon={ImageIcon} label="发送图片（也可拖入或粘贴）" className="composer-tool" disabled={sending || !connected} onClick={() => input.current.click()} />
      <IconButton icon={Film} label="发送视频（单个文件最大 100 MB）" className="composer-tool" disabled={sending || !connected} onClick={() => videoInput.current.click()} />
      <IconButton icon={Paperclip} label="发送文件（单个文件最大 100 MB）" className="composer-tool" disabled={sending || !connected} onClick={() => fileInput.current.click()} />
      <textarea ref={textarea} aria-label="消息内容" placeholder={`发消息到 ${room.name}`} value={draft.text} readOnly={sending} aria-busy={sending} maxLength={10000} rows={1}
        aria-autocomplete="list" aria-controls="mention-picker" aria-expanded={Boolean(picker && candidates.length)} aria-activedescendant={picker && candidates.length ? `mention-option-${picker.index}` : undefined}
        onChange={event => { update(room.id, state => ({ ...state, text: event.target.value })); detectMention(event.target); }} onSelect={event => detectMention(event.currentTarget)} onBlur={() => setPicker(null)}
        onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); if (!sending) addFiles(event.clipboardData.files); } }}
        onKeyDown={event => {
          if (picker && candidates.length && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const step = event.key === 'ArrowDown' ? 1 : candidates.length - 1; setPicker(value => ({ ...value, index: (value.index + step) % candidates.length })); return; }
            if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); chooseMention(candidates[picker.index]); return; }
            if (event.key === 'Escape') { event.preventDefault(); setPicker(null); return; }
          }
          if (event.key === 'Escape' && reply) { event.preventDefault(); onCancelReply?.(); }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); }
        }} />
      <button className="send-button" onClick={send} disabled={!ready} aria-label="发送消息" title="Enter 发送 · Shift + Enter 换行">{sending ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={17} strokeWidth={2.2} />}</button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }} /><input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm,.mov" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
      <input ref={fileInput} type="file" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
    </div>
  </div>;
}

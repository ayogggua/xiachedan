import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Film, ArrowUp, X, LoaderCircle, RotateCcw, Paperclip, Users, FileText, Smile, Crop } from 'lucide-react';
import EmojiPicker from './EmojiPicker';
import { api, upload, uid, formatSize } from './api';
import { Avatar, IconButton, PrivatePreview, ContextMenu } from './components';
import { previewText } from './history';
import { matchFormats, applyFormat, insideCodeFence } from './slashCommands';
import { isSendKey, modKey } from './chatPrefs';
import { htmlToMarkdown } from './htmlToMarkdown';
import { compressImage } from './imageTools';
import ImageEditor from './ImageEditor';

const empty = { text: '', files: [], mentions: [] };
const EVERYONE = { id: '*', name: '所有人' };
export default function Composer({ room, connected, onQueue, notify, reply, replyAuthor, onCancelReply, privateMode, members = [], canMentionAll = false, onTyping, editing, onCancelEdit, onEdited, onEditLast, onCreatePoll, onSchedule, notice, sendKey = 'enter', onDraft, injectDraft }) {
  const typedAt = useRef(0);
  const [attachMenu, setAttachMenu] = useState(null);
  const [picker, setPicker] = useState(null);
  const [slash, setSlash] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // 发图默认压缩大图，勾选「原图」时按原文件上传；选择记在本机。
  const [sendOriginal, setSendOriginal] = useState(() => localStorage.getItem('linliao.sendOriginal') === '1');
  const [editingImage, setEditingImage] = useState(null);
  // 编辑时输入框临时换成这条消息的正文，草稿原样保留，退出编辑后恢复。
  const [editText, setEditText] = useState('');
  const input = useRef();
  const fileInput = useRef();
  const textarea = useRef();
  const draftsRef = useRef(drafts);
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
  // 行首或空格后输入「/」弹出格式菜单，「/」后的文字用来筛选（中文名、英文或拼音首字母）。
  const POLL = { id: 'poll', label: '投票', sample: '', keys: 'poll vote toupiao tp' };
  const slashOptions = slash ? [...matchFormats(slash.query), ...(onCreatePoll && !editing && (!slash.query || POLL.label.includes(slash.query) || POLL.keys.split(' ').some(key => key.startsWith(slash.query.toLowerCase()))) ? [POLL] : [])] : [];
  function detectSlash(node) {
    const match = node.selectionStart === node.selectionEnd && node.value.slice(0, node.selectionStart).match(/(?:^|\s)\/([^\s/]{0,12})$/);
    setSlash(match ? { start: node.selectionStart - match[1].length - 1, query: match[1], index: 0 } : null);
  }
  // 改写正文后要放的光标位置：等新内容提交到输入框后再设置，否则会被挪到末尾。
  const pendingSelection = useRef(null);
  useLayoutEffect(() => {
    const node = textarea.current, selection = pendingSelection.current;
    if (!node || !selection) return;
    pendingSelection.current = null;
    node.focus({ preventScroll: true });
    node.setSelectionRange(...selection);
  });
  function setText(next, selection) {
    pendingSelection.current = selection;
    if (editing) setEditText(next); else update(room.id, state => ({ ...state, text: next }));
  }
  function chooseFormat(item) {
    const current = editing ? editText : draft.text, start = slash.start, end = start + 1 + slash.query.length;
    setSlash(null);
    if (item.id === 'poll') { setText(current.slice(0, start) + current.slice(end), [start, start]); onCreatePoll(); return; }
    const result = applyFormat(current, start, end, item);
    setText(result.text, result.selection);
  }
  function chooseMention(user) {
    const insert = `@${user.name} `, start = picker.start;
    update(room.id, state => ({ ...state, text: state.text.slice(0, start) + insert + state.text.slice(start + 1 + picker.query.length),
      mentions: [...new Set([...(state.mentions || []), user.id])] }));
    setPicker(null);
    requestAnimationFrame(() => { const node = textarea.current; node?.focus(); node?.setSelectionRange(start + insert.length, start + insert.length); });
  }
  useEffect(() => () => { for (const draft of Object.values(draftsRef.current)) for (const item of draft.files) URL.revokeObjectURL(item.url); }, []);
  // 较大的静态图片在本机缩成长边 720 像素的小图一起上传，聊天里先显示小图；失败时照常只用原图。
  async function makeThumbnail(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 150 * 1024 || !window.createImageBitmap) return null;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
    return blob && blob.size < file.size ? new File([blob], 'thumbnail.webp', { type: blob.type }) : null;
  }
  async function uploadItem(item, roomId) {
    update(roomId, state => ({ ...state, files: state.files.map(file => file.id === item.id ? { ...file, error: '', progress: 0 } : file) }));
    try {
      const { attachment } = await upload(item.file, { roomId }, progress => update(roomId, state => ({ ...state, files: state.files.map(file => file.id === item.id ? { ...file, progress: Math.min(progress, 99) } : file) })));
      try { const thumbnail = await makeThumbnail(item.file); if (thumbnail) await upload(thumbnail, { roomId, thumbnailFor: attachment.id }); } catch {}
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
    }).map(file => ({ id: uid(), original: file, file, url: URL.createObjectURL(file), progress: 0 }));
    update(roomId, state => ({ ...state, files: [...state.files, ...items] }));
    for (const item of items) chooseVersion(item.original, sendOriginal).then(file => sendVersion(item, roomId, file));
  }
  const compressible = file => /^image\/(jpeg|png|webp)$/.test(file.type);
  const chooseVersion = (original, keepOriginal) => keepOriginal || !compressible(original) ? Promise.resolve(original) : compressImage(original).catch(() => original);
  // 换成另一个版本（压缩、原图或编辑后的）再上传。
  function sendVersion(item, roomId, file) {
    let next = item;
    if (file !== item.file) {
      URL.revokeObjectURL(item.url);
      next = { ...item, file, url: URL.createObjectURL(file), attachment: null, progress: 0, error: '' };
      update(roomId, state => ({ ...state, files: state.files.map(entry => entry.id === item.id ? { ...entry, file: next.file, url: next.url, attachment: null, progress: 0, error: '', edited: next.edited } : entry) }));
    }
    uploadItem(next, roomId);
  }
  async function toggleOriginal(value) {
    setSendOriginal(value);
    try { localStorage.setItem('linliao.sendOriginal', value ? '1' : '0'); } catch {}
    const roomId = room.id;
    for (const item of draftsRef.current[roomId]?.files || []) {
      if (item.edited || !item.original || !compressible(item.original)) continue;
      const file = await chooseVersion(item.original, value);
      if (file !== item.file) sendVersion(item, roomId, file);
    }
  }
  function removeFile(item) {
    URL.revokeObjectURL(item.url);
    update(room.id, state => ({ ...state, files: state.files.filter(file => file.id !== item.id) }));
  }
  // ⌘B 粗体、⌘I 斜体、⌘E 代码、⌘⇧X 删除线（Windows 用 Ctrl）：给选中的文字加上格式符号。
  function wrapSelection(event) {
    // Cmd/Ctrl+K：把选中的文字做成链接，选中网址部分方便直接粘贴。
    if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      const node = event.currentTarget, { selectionStart: start, selectionEnd: end, value } = node;
      const label = value.slice(start, end) || '文字', next = value.slice(0, start) + `[${label}](https://)` + value.slice(end);
      setText(next, [start + label.length + 3, start + label.length + 11]);
      return true;
    }
    const mark = { b: '**', i: '*', e: '`', x: event.shiftKey ? '~~' : null }[event.key.toLowerCase()];
    if (!mark || !(event.metaKey || event.ctrlKey) || event.altKey || (event.shiftKey && mark !== '~~')) return false;
    event.preventDefault();
    const node = event.currentTarget, { selectionStart: start, selectionEnd: end, value } = node;
    setText(value.slice(0, start) + mark + value.slice(start, end) + mark + value.slice(end), [start + mark.length, end + mark.length]);
    return true;
  }
  // 在光标处插入表情，编辑和普通输入都适用。
  function insertText(value) {
    const node = textarea.current;
    const current = editing ? editText : draft.text;
    const start = node?.selectionStart ?? current.length, end = node?.selectionEnd ?? current.length;
    setText(current.slice(0, start) + value + current.slice(end), [start + value.length, start + value.length]);
  }
  async function saveEdit() {
    const text = editText.trim();
    if (sending || !connected) return;
    if (text === editing.text) return onCancelEdit();
    if (!text && !editing.attachments.length) return notify('消息不能为空');
    setSending(true);
    try { onEdited((await api('edit-message', { messageId: editing.id, text })).message); }
    catch (error) { notify(error.message); } finally { setSending(false); }
  }
  async function send() {
    if (editing) return saveEdit();
    if ((!draft.text.trim() && !draft.files.length) || draft.files.some(file => !file.attachment)) return;
    const roomId = room.id;
    const snapshot = draft;
    const replyTo = reply?.id || null;
    // 只保留正文里仍写着「@名字」的提及。
    const nameOf = id => id === '*' ? EVERYONE.name : members.find(user => user.id === id)?.name;
    const mentions = (snapshot.mentions || []).filter(id => nameOf(id) && snapshot.text.includes(`@${nameOf(id)}`));
    textarea.current?.focus({ preventScroll: true });
    // 交给发件箱发送，输入框立即清空；失败的消息留在会话底部，可重试或删除。
    onQueue({ roomId, text: snapshot.text, attachmentIds: snapshot.files.map(file => file.attachment.id), clientId: uid(), ...(replyTo ? { replyTo, ...(reply.quote ? { replyQuote: reply.quote } : {}) } : {}), ...(mentions.length ? { mentions } : {}) },
      { text: snapshot.text, files: snapshot.files.map(file => file.file.name) });
    if (replyTo) onCancelReply?.();
    for (const file of snapshot.files) URL.revokeObjectURL(file.url);
    update(roomId, () => empty);
  }
  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, [draft.text, editText, editing?.id, room.id]);
  // 新消息断网时也能发，先进发件箱排队；编辑仍需在线。
  const ready = !sending && (editing ? connected : (draft.text.trim() || draft.files.length) && draft.files.every(file => file.attachment));
  // 选择回复时把焦点交给输入框。
  useEffect(() => { if (reply) textarea.current?.focus({ preventScroll: true }); }, [reply?.id]);
  useEffect(() => {
    if (!editing) return;
    setEditText(editing.text);
    requestAnimationFrame(() => { const node = textarea.current; node?.focus({ preventScroll: true }); node?.setSelectionRange(node.value.length, node.value.length); });
  }, [editing?.id]);
  useEffect(() => { setPicker(null); setSlash(null); }, [room.id]);
  // 撤回后「重新编辑」：原文放回对应会话的输入框，已有草稿时接在后面。
  useEffect(() => {
    if (!injectDraft) return;
    const current = draftsRef.current[injectDraft.roomId]?.text || '';
    const next = current ? `${current}\n${injectDraft.text}` : injectDraft.text;
    if (injectDraft.roomId === room.id) pendingSelection.current = [next.length, next.length];
    update(injectDraft.roomId, state => ({ ...state, text: next }));
  }, [injectDraft?.nonce]);
  // 离开会话时把剩下的草稿交给侧栏，显示「[草稿]」。
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  useEffect(() => { const id = room.id; return () => onDraftRef.current?.(id, draftsRef.current[id]?.text.trim() || ''); }, [room.id]);
  return <div className="composer-area">
    {slashOptions.length > 0 && <div className="mention-picker slash-picker" role="listbox" id="slash-picker" aria-label="插入格式">
      {slashOptions.map((item, index) => <button type="button" role="option" id={`slash-option-${index}`} key={item.id} aria-selected={index === slash.index} className={index === slash.index ? 'active' : ''}
        onPointerDown={event => { event.preventDefault(); chooseFormat(item); }}><span>{item.label}</span>{item.sample && <code>{item.sample}</code>}</button>)}
    </div>}
    {picker && candidates.length > 0 && <div className="mention-picker" role="listbox" id="mention-picker" aria-label="选择要提及的成员">
      {candidates.map((user, index) => <button type="button" role="option" id={`mention-option-${index}`} key={user.id} aria-selected={index === picker.index} className={index === picker.index ? 'active' : ''}
        onPointerDown={event => { event.preventDefault(); chooseMention(user); }}>
        {user.id === '*' ? <span className="mention-everyone"><Users size={13} /></span> : <Avatar user={user} size={22} />}<span>{user.name}</span>{user.id === '*' && <small>提醒会话里的每个人</small>}
      </button>)}
    </div>}
    {notice}
    {editing && <div className="reply-bar editing-bar" role="status"><span className="reply-copy"><b>编辑消息</b><PrivatePreview privateMode={privateMode}>{previewText(editing)}</PrivatePreview></span><IconButton icon={X} label="取消编辑" size={14} onClick={onCancelEdit} /></div>}
    {reply && !editing && <div className="reply-bar" role="status"><span className="reply-copy"><b>回复 {replyAuthor}</b><PrivatePreview privateMode={privateMode}>{reply.quote ? `“${reply.quote}”` : previewText(reply)}</PrivatePreview></span><IconButton icon={X} label="取消回复" size={14} onClick={onCancelReply} /></div>}
    {draft.files.length > 0 && !editing && <div className="attachment-queue">{draft.files.map(item => <div className={`queued-file ${item.error ? 'failed' : ''}`} key={item.id}>
      {item.file.type.startsWith('image/') ? <img src={item.url} alt="待发送图片" /> : <span className="queued-video">{item.file.type.startsWith('video/') ? <Film size={18} /> : <FileText size={18} />}</span>}
      <div><span>{item.file.name}</span><small>{item.error ? '上传失败' : item.attachment ? formatSize(item.file.size) : `上传 ${item.progress}%`}</small></div>
      {item.error && <IconButton icon={RotateCcw} label="重试上传" size={15} onClick={() => uploadItem(item, room.id)} />}
      {compressible(item.file) && item.attachment && <IconButton icon={Crop} label="裁剪或标注图片" size={15} onClick={() => setEditingImage(item)} disabled={sending} />}
      <IconButton icon={X} label="移除附件" size={15} onClick={() => removeFile(item)} disabled={sending} />
    </div>)}
      {draft.files.some(item => item.original && compressible(item.original)) && <label className="original-toggle" title="不勾选时，大图会压缩后再发送"><input type="checkbox" checked={sendOriginal} onChange={event => toggleOriginal(event.target.checked)} />原图</label>}
    </div>}
    {editingImage && <ImageEditor file={editingImage.file} onClose={() => setEditingImage(null)} onDone={file => { const item = editingImage; setEditingImage(null); sendVersion({ ...item, edited: true }, room.id, file); }} />}
    <div className="composer-row">
    {/* 附件统一收进回形针菜单：图片或视频、文件 */}
    <button type="button" className="round-button glass attach-button" aria-label="添加附件" title="添加附件（也可拖入或粘贴）" aria-haspopup="menu" aria-expanded={Boolean(attachMenu)} disabled={sending || !connected}
      onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setAttachMenu(attachMenu ? null : { x: rect.left, y: rect.top - 16 - (2 + Boolean(onCreatePoll) + Boolean(onSchedule)) * 36, label: '添加附件', items: [
        { id: 'media', label: '图片或视频', action: () => input.current.click() },
        { id: 'file', label: '文件（最大 100 MB）', action: () => fileInput.current.click() },
        ...(onCreatePoll ? [{ id: 'poll', label: '投票', action: onCreatePoll }] : []),
        ...(onSchedule ? [{ id: 'schedule', label: '定时发送…', action: () => onSchedule(draft.text) }] : []),
      ] }); }}><Paperclip size={19} strokeWidth={1.7} /></button>
    {attachMenu && <ContextMenu menu={attachMenu} onClose={() => setAttachMenu(null)} />}
    {emojiOpen && <EmojiPicker onPick={insertText} onClose={() => setEmojiOpen(false)} />}
    <div className={`composer ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (!sending) addFiles(event.dataTransfer.files); }}>
      {dragging && <div className="drop-overlay"><Paperclip size={18} /><span>松开鼠标，发送文件</span></div>}
      <textarea ref={textarea} aria-label="消息内容" placeholder={`发消息到 ${room.name}`} value={editing ? editText : draft.text} readOnly={sending} aria-busy={sending} maxLength={10000} rows={1}
        aria-autocomplete="list" aria-controls={slashOptions.length ? 'slash-picker' : 'mention-picker'} aria-expanded={Boolean(slashOptions.length || (picker && candidates.length))}
        aria-activedescendant={slashOptions.length ? `slash-option-${slash.index}` : picker && candidates.length ? `mention-option-${picker.index}` : undefined}
        onChange={event => {
          detectSlash(event.target);
          if (editing) { setEditText(event.target.value); return; }
          update(room.id, state => ({ ...state, text: event.target.value })); detectMention(event.target);
          // 有内容时每 3 秒最多告诉别人一次「正在输入」。
          if (event.target.value.trim() && Date.now() - typedAt.current > 3000) { typedAt.current = Date.now(); onTyping?.(room.id); }
        }} onSelect={event => { detectMention(event.currentTarget); detectSlash(event.currentTarget); }} onBlur={() => { setPicker(null); setSlash(null); }}
        onPaste={event => {
          if (event.clipboardData.files.length) { event.preventDefault(); if (!sending) addFiles(event.clipboardData.files); return; }
          // 从网页、文档复制的带格式内容转成 Markdown 再粘贴；没有格式时照常粘贴纯文本。
          const markdown = htmlToMarkdown(event.clipboardData.getData('text/html'));
          if (markdown && markdown !== event.clipboardData.getData('text/plain').trim()) { event.preventDefault(); insertText(markdown); }
        }}
        onKeyDown={event => {
          if (slashOptions.length && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const step = event.key === 'ArrowDown' ? 1 : slashOptions.length - 1; setSlash(value => ({ ...value, index: (value.index + step) % slashOptions.length })); return; }
            if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); chooseFormat(slashOptions[slash.index]); return; }
            if (event.key === 'Escape') { event.preventDefault(); setSlash(null); return; }
          }
          if (picker && candidates.length && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const step = event.key === 'ArrowDown' ? 1 : candidates.length - 1; setPicker(value => ({ ...value, index: (value.index + step) % candidates.length })); return; }
            if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); chooseMention(candidates[picker.index]); return; }
            if (event.key === 'Escape') { event.preventDefault(); setPicker(null); return; }
          }
          if (wrapSelection(event)) return;
          if (event.key === 'Escape' && editing) { event.preventDefault(); onCancelEdit?.(); return; }
          if (event.key === 'Escape' && reply) { event.preventDefault(); onCancelReply?.(); }
          // 输入框为空时按 ↑ 编辑自己最近发的一条消息。
          if (event.key === 'ArrowUp' && !editing && !draft.text && !draft.files.length && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onEditLast?.(); }
          // Enter 发送模式下，在没闭合的 ``` 代码块里回车是换行；⌘Enter 发送模式下回车本来就是换行。
          if (isSendKey(event, sendKey) && !(sendKey === 'enter' && insideCodeFence(event.currentTarget.value, event.currentTarget.selectionStart))) { event.preventDefault(); send(); }
        }} />
      <IconButton icon={Smile} label="表情" className={`emoji-button ${emojiOpen ? 'selected' : ''}`} aria-expanded={emojiOpen} disabled={sending} onClick={() => setEmojiOpen(value => !value)} />
    </div>
    <button className="send-button round-button" onClick={send} disabled={!ready} aria-label={editing ? '保存修改' : '发送消息'} title={editing ? `${sendKey === 'enter' ? 'Enter' : `${modKey} Enter`} 保存 · Esc 取消` : `${sendKey === 'enter' ? 'Enter 发送 · Shift + Enter 换行' : `${modKey} Enter 发送 · Enter 换行`} · 输入 / 插入格式，支持 Markdown`}>{sending ? <LoaderCircle size={19} className="spin" /> : <ArrowUp size={19} strokeWidth={2.2} />}</button>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm,.mov" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
    <input ref={fileInput} type="file" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
    </div>
  </div>;
}

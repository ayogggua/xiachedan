import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Copy, Download } from 'lucide-react';
import { mediaUrl } from './api';
import { IconButton } from './components';

const MAX_SCALE = 6;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// 剪贴板只稳定支持 PNG：其他格式先画到画布上转成 PNG。
async function copyImage(file) {
  const blob = await (await fetch(mediaUrl(file.id), { credentials: 'include' })).blob();
  let png = blob;
  if (blob.type !== 'image/png') {
    const bitmap = await createImageBitmap(blob);
    const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    png = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片转换失败')), 'image/png'));
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

// 看图：←/→ 切换同一会话里的图片，滚轮或双指缩放，放大后拖动查看，+/-/0 调整缩放，Esc 关闭。
export default function ImageViewer({ images, index, onIndex, onClose, notify }) {
  const dialog = useRef();
  const stage = useRef();
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const file = images[index];
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => previous?.focus?.();
  }, []);
  useEffect(() => setView({ scale: 1, x: 0, y: 0 }), [index]);
  // 以 (px, py)（相对舞台中心）为锚点缩放，锚点下的像素保持不动。
  const zoomAt = useCallback((factor, px = 0, py = 0) => setView(current => {
    const scale = clamp(current.scale * factor, 1, MAX_SCALE);
    if (scale === 1) return { scale: 1, x: 0, y: 0 };
    const ratio = scale / current.scale;
    return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
  }), []);
  const relative = event => {
    const box = stage.current.getBoundingClientRect();
    return [event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2];
  };
  const go = step => { if (images.length > 1) onIndex((index + step + images.length) % images.length); };
  function onKeyDown(event) {
    if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
    else if (event.key === '+' || event.key === '=') zoomAt(1.25);
    else if (event.key === '-') zoomAt(0.8);
    else if (event.key === '0') setView({ scale: 1, x: 0, y: 0 });
  }
  function onPointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    const points = [...pointers.current.values()];
    gesture.current = points.length === 2
      ? { kind: 'pinch', distance: Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) }
      : { kind: 'pan', x: event.clientX, y: event.clientY };
  }
  function onPointerMove(event) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    const points = [...pointers.current.values()];
    if (gesture.current?.kind === 'pinch' && points.length === 2) {
      const distance = Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]);
      const [px, py] = relative({ clientX: (points[0][0] + points[1][0]) / 2, clientY: (points[0][1] + points[1][1]) / 2 });
      zoomAt(distance / gesture.current.distance, px, py);
      gesture.current.distance = distance;
    } else if (gesture.current?.kind === 'pan') {
      const dx = event.clientX - gesture.current.x, dy = event.clientY - gesture.current.y;
      gesture.current = { kind: 'pan', x: event.clientX, y: event.clientY };
      setView(current => current.scale > 1 ? { ...current, x: current.x + dx, y: current.y + dy } : current);
    }
  }
  function onPointerUp(event) {
    pointers.current.delete(event.pointerId);
    gesture.current = pointers.current.size ? { kind: 'pan', x: [...pointers.current.values()][0][0], y: [...pointers.current.values()][0][1] } : null;
  }
  async function copy() {
    try { await copyImage(file); notify('图片已复制'); }
    catch { notify('无法复制这张图片，可以下载后使用'); }
  }
  if (!file) return null;
  return <dialog ref={dialog} className="image-viewer" aria-label={`查看图片：${file.name}`} onKeyDown={onKeyDown} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="viewer-bar">
      <span className="viewer-title"><span className="viewer-name">{file.name}</span>{images.length > 1 && <small>{index + 1} / {images.length}</small>}</span>
      <IconButton icon={ZoomOut} label="缩小（-）" onClick={() => zoomAt(0.8)} disabled={view.scale <= 1} />
      <button type="button" className="viewer-scale" onClick={() => setView({ scale: 1, x: 0, y: 0 })} title="适应窗口（0）">{Math.round(view.scale * 100)}%</button>
      <IconButton icon={ZoomIn} label="放大（+）" onClick={() => zoomAt(1.25)} disabled={view.scale >= MAX_SCALE} />
      <IconButton icon={Copy} label="复制图片" onClick={copy} />
      <a className="icon-button" href={mediaUrl(file.id, true)} download title="下载图片" aria-label="下载图片"><Download size={17} strokeWidth={1.7} /></a>
      <IconButton icon={X} label="关闭（Esc）" onClick={onClose} />
    </header>
    <div ref={stage} className={`viewer-stage ${view.scale > 1 ? 'zoomed' : ''}`}
      onWheel={event => { const [px, py] = relative(event); zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, px, py); }}
      onDoubleClick={event => { const [px, py] = relative(event); view.scale > 1 ? setView({ scale: 1, x: 0, y: 0 }) : zoomAt(2.5, px, py); }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <img src={mediaUrl(file.id)} alt={file.name} draggable={false} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
    </div>
    {images.length > 1 && <>
      <IconButton icon={ChevronLeft} label="上一张（←）" className="viewer-nav previous" onClick={() => go(-1)} />
      <IconButton icon={ChevronRight} label="下一张（→）" className="viewer-nav next" onClick={() => go(1)} />
    </>}
  </dialog>;
}

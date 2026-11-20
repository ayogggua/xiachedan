import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Copy, Download, Share2 } from 'lucide-react';
import { mediaUrl } from './api';
import { IconButton } from './components';
import { mobileClient, nativeMobile, mobileHeaders } from './mobile/session';
import { saveDownload } from './mobile/runtime';
import { isTouchMobile, useIsMobile } from './mobile/ui';

const MAX_SCALE = 6;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// 剪贴板只稳定支持 PNG：其他格式先画到画布上转成 PNG。
async function fetchImageBlob(file) {
  const response = await fetch(mediaUrl(file.id), { credentials: mobileClient ? 'omit' : 'include', headers: mobileHeaders() });
  if (!response.ok) throw new Error('图片读取失败');
  return response.blob();
}

async function copyImage(file) {
  const blob = await fetchImageBlob(file);
  let png = blob;
  if (blob.type !== 'image/png') {
    const bitmap = await createImageBitmap(blob);
    const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    png = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('图片转换失败')), 'image/png'));
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

async function shareImagePwa(file) {
  const blob = await fetchImageBlob(file);
  const shareFile = new File([blob], file.name || 'image.png', { type: blob.type || 'image/png' });
  if (navigator.canShare?.({ files: [shareFile] })) {
    await navigator.share({ files: [shareFile], title: file.name || '图片' });
    return true;
  }
  return false;
}

// 看图：←/→ 切换同一会话里的图片，滚轮或双指缩放，放大后拖动查看，+/-/0 调整缩放，Esc 关闭；移动端支持左右滑切图、下拉关闭、轻点隐藏顶栏与双击缩放。
export default function ImageViewer({ images, index, onIndex, onClose, notify }) {
  const dialog = useRef();
  const stage = useRef();
  const mobile = useIsMobile();
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [chromeHidden, setChromeHidden] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const tapRef = useRef({ time: 0, x: 0, y: 0, timer: 0 });
  const file = images[index];
  const canWebShare = !nativeMobile && isTouchMobile() && typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { clearTimeout(tapRef.current.timer); previous?.focus?.(); };
  }, []);
  useEffect(() => { setView({ scale: 1, x: 0, y: 0 }); setDrag({ x: 0, y: 0, active: false }); }, [index]);
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
    if (points.length === 2) {
      setDrag({ x: 0, y: 0, active: false });
      gesture.current = { kind: 'pinch', distance: Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) };
    } else if (event.pointerType === 'touch' && viewRef.current.scale <= 1) {
      gesture.current = { kind: 'touch', mode: 'pending', startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, lastTime: event.timeStamp, vx: 0, vy: 0, moved: false };
    } else {
      gesture.current = { kind: 'pan', x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, touch: event.pointerType === 'touch' };
    }
  }
  function onPointerMove(event) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    const points = [...pointers.current.values()];
    if (gesture.current?.kind === 'pinch' && points.length === 2) {
      const distance = Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]);
      if (gesture.current.distance > 0) {
        const [px, py] = relative({ clientX: (points[0][0] + points[1][0]) / 2, clientY: (points[0][1] + points[1][1]) / 2 });
        zoomAt(distance / gesture.current.distance, px, py);
      }
      gesture.current.distance = distance;
    } else if (gesture.current?.kind === 'touch') {
      const g = gesture.current;
      const dx = event.clientX - g.startX, dy = event.clientY - g.startY;
      const dt = Math.max(1, event.timeStamp - g.lastTime);
      g.vx = (event.clientX - g.lastX) / dt;
      g.vy = (event.clientY - g.lastY) / dt;
      g.lastX = event.clientX; g.lastY = event.clientY; g.lastTime = event.timeStamp;
      if (Math.hypot(dx, dy) > 8) g.moved = true;
      if (g.mode === 'pending' && Math.hypot(dx, dy) > 10) {
        if (Math.abs(dx) > Math.abs(dy) * 1.15 && images.length > 1) g.mode = 'swipe';
        else if (dy > 0 && dy > Math.abs(dx) * 1.15) g.mode = 'dismiss';
      }
      if (g.mode === 'swipe') setDrag({ x: dx, y: 0, active: true });
      else if (g.mode === 'dismiss') setDrag({ x: dx * 0.25, y: Math.max(0, dy), active: true });
    } else if (gesture.current?.kind === 'pan') {
      const dx = event.clientX - gesture.current.x, dy = event.clientY - gesture.current.y;
      if (Math.hypot(event.clientX - gesture.current.startX, event.clientY - gesture.current.startY) > 8) gesture.current.moved = true;
      gesture.current.x = event.clientX; gesture.current.y = event.clientY;
      setView(current => current.scale > 1 ? { ...current, x: current.x + dx, y: current.y + dy } : current);
    }
  }
  function onPointerUp(event, cancelled = false) {
    const current = gesture.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 1) {
      const [x, y] = [...pointers.current.values()][0];
      gesture.current = { kind: 'pan', x, y, startX: x, startY: y, moved: true, touch: event.pointerType === 'touch' };
      return;
    }
    gesture.current = null;
    if (current?.kind === 'touch') {
      const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
      if (!cancelled && current.mode === 'swipe' && (Math.abs(dx) > 64 || Math.abs(current.vx) > 0.45)) {
        setDrag({ x: 0, y: 0, active: false });
        go(dx < 0 ? 1 : -1);
        return;
      }
      if (!cancelled && current.mode === 'dismiss' && (dy > 100 || current.vy > 0.55)) {
        onClose();
        return;
      }
      setDrag({ x: 0, y: 0, active: false });
      if (!cancelled && !current.moved) {
        handleTouchTap(event);
      }
      return;
    }
    if (!cancelled && current?.kind === 'pan' && current.touch && !current.moved) {
      handleTouchTap(event);
    }
  }
  function handleTouchTap(event) {
    const now = event.timeStamp, prev = tapRef.current;
    if (prev.time && now - prev.time < 260 && Math.hypot(event.clientX - prev.x, event.clientY - prev.y) < 32) {
      clearTimeout(prev.timer);
      tapRef.current = { time: 0, x: 0, y: 0, timer: 0 };
      const [px, py] = relative(event);
      if (viewRef.current.scale > 1) setView({ scale: 1, x: 0, y: 0 });
      else zoomAt(2.5, px, py);
    } else {
      clearTimeout(prev.timer);
      const timer = setTimeout(() => { setChromeHidden(value => !value); tapRef.current.time = 0; }, 260);
      tapRef.current = { time: now, x: event.clientX, y: event.clientY, timer };
    }
  }
  async function copy() {
    try {
      if (nativeMobile) { await saveDownload(mediaUrl(file.id), file.name); return; }
      if (canWebShare && await shareImagePwa(file)) return;
      await copyImage(file); notify('图片已复制');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      notify('无法复制这张图片，可以下载后使用');
    }
  }
  if (!file) return null;
  const dismissProgress = drag.y > 0 ? clamp(drag.y / 320, 0, 1) : 0;
  const dragScale = drag.y > 0 ? clamp(1 - drag.y / 1100, 0.82, 1) : 1;
  const stageStyle = drag.active || drag.x || drag.y ? {
    transform: `translate3d(${drag.x}px, ${drag.y}px, 0) scale(${dragScale})`,
    transition: drag.active ? 'none' : 'transform 220ms cubic-bezier(.23, 1, .32, 1)',
  } : undefined;
  const dialogBg = dismissProgress > 0 ? { background: `rgba(10, 10, 12, ${(0.92 * (1 - dismissProgress * 0.72)).toFixed(3)})` } : undefined;
  return <dialog ref={dialog} className={`image-viewer ${chromeHidden ? 'chrome-hidden' : ''}`} style={dialogBg} aria-label={`查看图片：${file.burnId ? '阅后即焚图片' : file.name}`} onKeyDown={onKeyDown} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="viewer-bar">
      <span className="viewer-title"><span className="viewer-name">{file.burnId ? '阅后即焚图片' : file.name}</span>{images.length > 1 && <small>{index + 1} / {images.length}</small>}</span>
      <IconButton icon={ZoomOut} label="缩小（-）" onClick={() => zoomAt(0.8)} disabled={view.scale <= 1} />
      <button type="button" className="viewer-scale" onClick={() => setView({ scale: 1, x: 0, y: 0 })} title="适应窗口（0）">{Math.round(view.scale * 100)}%</button>
      <IconButton icon={ZoomIn} label="放大（+）" onClick={() => zoomAt(1.25)} disabled={view.scale >= MAX_SCALE} />
      {/* 阅后即焚的图片不提供复制、分享和下载 */}
      {!file.burnId && <IconButton icon={nativeMobile || canWebShare ? Share2 : Copy} label={nativeMobile || canWebShare ? '分享图片' : '复制图片'} onClick={copy} />}
      {!file.burnId && <a className="icon-button" href={mediaUrl(file.id, true)} download={file.name} title="下载图片" aria-label="下载图片"><Download size={17} strokeWidth={1.7} /></a>}
      <IconButton icon={X} label="关闭（Esc）" onClick={onClose} />
    </header>
    <div ref={stage} className={`viewer-stage ${view.scale > 1 ? 'zoomed' : ''}`} style={stageStyle}
      onWheel={event => { const [px, py] = relative(event); zoomAt(event.deltaY < 0 ? 1.15 : 1 / 1.15, px, py); }}
      onDoubleClick={event => { if (mobile) return; const [px, py] = relative(event); view.scale > 1 ? setView({ scale: 1, x: 0, y: 0 }) : zoomAt(2.5, px, py); }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={event => onPointerUp(event, false)} onPointerCancel={event => onPointerUp(event, true)}>
      <img src={mediaUrl(file.id)} alt={file.burnId ? '' : file.name} draggable={false} onContextMenu={file.burnId ? event => event.preventDefault() : undefined} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
    </div>
    {images.length > 1 && <>
      <IconButton icon={ChevronLeft} label="上一张（←）" className="viewer-nav previous" onClick={() => go(-1)} />
      {mobile && <span className="viewer-counter" aria-hidden="true">{index + 1} / {images.length}</span>}
      <IconButton icon={ChevronRight} label="下一张（→）" className="viewer-nav next" onClick={() => go(1)} />
    </>}
  </dialog>;
}

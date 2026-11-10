import React, { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Modal } from './components';

// 头像裁剪：拖动移动、滑块或滚轮缩放，圆形框里的部分保存成 512×512 的正方形图片。
const VIEW = 280, OUTPUT = 512;

export default function AvatarCropper({ file, title = '裁剪头像', onCancel, onDone }) {
  const [image, setImage] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');
  const drag = useRef(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => setError('这张图片打不开，换一张试试');
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // 最小缩放让图片刚好盖满裁剪框；偏移量限制在不露出空白的范围内。
  const base = image ? VIEW / Math.min(image.naturalWidth, image.naturalHeight) : 1;
  const scale = base * zoom;
  const clamp = (next, currentScale = scale) => {
    if (!image) return next;
    const maxX = Math.max(0, (image.naturalWidth * currentScale - VIEW) / 2), maxY = Math.max(0, (image.naturalHeight * currentScale - VIEW) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
  };
  const changeZoom = value => { const next = Math.min(4, Math.max(1, value)); setZoom(next); setOffset(previous => clamp(previous, base * next)); };
  function save() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = OUTPUT;
    const size = VIEW / scale;
    const sx = (image.naturalWidth - size) / 2 - offset.x / scale, sy = (image.naturalHeight - size) / 2 - offset.y / scale;
    canvas.getContext('2d').drawImage(image, sx, sy, size, size, 0, 0, OUTPUT, OUTPUT);
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    canvas.toBlob(blob => blob ? onDone(new File([blob], type === 'image/jpeg' ? 'avatar.jpg' : 'avatar.png', { type })) : setError('裁剪失败，请重试'), type, 0.92);
  }
  return <Modal title={title} subtitle="拖动调整位置，滑动缩放。" onClose={onCancel}>
    <div className="avatar-cropper">
      <div className="cropper-stage" style={{ width: VIEW, height: VIEW }}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, start: offset }; }}
        onPointerMove={event => { if (drag.current) setOffset(clamp({ x: drag.current.start.x + event.clientX - drag.current.x, y: drag.current.start.y + event.clientY - drag.current.y })); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onWheel={event => changeZoom(zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08))}>
        {image && <img src={image.src} alt="" draggable={false} style={{ width: image.naturalWidth * scale, height: image.naturalHeight * scale,
          transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }} />}
        <span className="cropper-mask" aria-hidden="true" />
      </div>
      <label className="cropper-zoom"><ZoomOut size={15} /><input type="range" aria-label="缩放" min="1" max="4" step="0.01" value={zoom} onChange={event => changeZoom(Number(event.target.value))} /><ZoomIn size={15} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <div className="modal-footer">
      {file.type === 'image/gif' && <button type="button" className="text-button" onClick={() => onDone(file)}>不裁剪（保留动图）</button>}
      <button type="button" className="secondary-button" onClick={onCancel}>取消</button>
      <button type="button" className="primary-button" disabled={!image} onClick={save}>使用</button>
    </div>
  </Modal>;
}

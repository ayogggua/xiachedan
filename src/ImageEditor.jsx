import React, { useEffect, useRef, useState } from 'react';
import { Crop, Pencil, Undo2 } from 'lucide-react';
import { Modal } from './components';

// 发图前的简单编辑：裁剪和画笔标注。所有操作按原图坐标记录，导出时才合成，所以撤销很简单。
const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#1c1c1e'];
const MAX_SIDE = 4096;

export default function ImageEditor({ file, onDone, onClose }) {
  const canvas = useRef();
  const [image, setImage] = useState(null);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [actions, setActions] = useState([]);
  const drawing = useRef(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    createImageBitmap(file).then(bitmap => {
      if (!alive) return bitmap.close();
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      setImage({ bitmap, width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
    }).catch(() => onClose());
    return () => { alive = false; };
  }, [file]);
  useEffect(() => () => image?.bitmap.close(), [image]);

  const strokes = actions.filter(action => action.type === 'stroke');
  const crop = actions.findLast(action => action.type === 'crop');
  const paintStroke = (context, stroke) => {
    context.strokeStyle = stroke.color; context.lineWidth = stroke.width; context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath(); stroke.points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y)); context.stroke();
  };
  const render = (extra = null) => {
    const node = canvas.current;
    if (!node || !image) return;
    node.width = image.width; node.height = image.height;
    const context = node.getContext('2d');
    context.drawImage(image.bitmap, 0, 0, image.width, image.height);
    for (const stroke of strokes) paintStroke(context, stroke);
    if (extra?.type === 'stroke') paintStroke(context, extra);
    const box = extra?.type === 'crop' ? extra : crop;
    if (box) {
      // 裁剪框外面压暗，框内保持原样。
      context.fillStyle = 'rgba(0, 0, 0, .5)';
      context.beginPath(); context.rect(0, 0, image.width, image.height); context.rect(box.x, box.y, box.w, box.h); context.fill('evenodd');
      context.strokeStyle = '#fff'; context.lineWidth = Math.max(2, image.width / 400); context.strokeRect(box.x, box.y, box.w, box.h);
    }
  };
  useEffect(() => { render(); }, [image, actions]);

  const point = event => {
    const rect = canvas.current.getBoundingClientRect();
    return [(event.clientX - rect.left) * image.width / rect.width, (event.clientY - rect.top) * image.height / rect.height];
  };
  const down = event => {
    if (!image || event.button > 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = point(event);
    drawing.current = tool === 'pen' ? { type: 'stroke', color, width: Math.max(4, image.width / 160), points: [[x, y]] } : { type: 'crop', startX: x, startY: y, x, y, w: 0, h: 0 };
  };
  const move = event => {
    const current = drawing.current;
    if (!current) return;
    const [x, y] = point(event);
    if (current.type === 'stroke') current.points.push([x, y]);
    else Object.assign(current, { x: Math.max(0, Math.min(current.startX, x)), y: Math.max(0, Math.min(current.startY, y)), w: Math.min(image.width, Math.max(current.startX, x)) - Math.max(0, Math.min(current.startX, x)), h: Math.min(image.height, Math.max(current.startY, y)) - Math.max(0, Math.min(current.startY, y)) });
    render(current);
  };
  const up = () => {
    const current = drawing.current;
    drawing.current = null;
    if (!current) return;
    if (current.type === 'crop' && (current.w < 16 || current.h < 16)) { render(); return; }
    setActions(previous => [...previous, current]);
  };

  async function finish() {
    if (!image || !actions.length) return onClose();
    setBusy(true);
    const box = crop || { x: 0, y: 0, w: image.width, h: image.height };
    const output = document.createElement('canvas');
    output.width = Math.round(box.w); output.height = Math.round(box.h);
    const context = output.getContext('2d');
    context.translate(-box.x, -box.y);
    context.drawImage(image.bitmap, 0, 0, image.width, image.height);
    for (const stroke of strokes) paintStroke(context, stroke);
    const type = /^image\/(png|webp)$/.test(file.type) ? file.type : 'image/jpeg';
    const blob = await new Promise(resolve => output.toBlob(resolve, type, 0.92));
    setBusy(false);
    if (!blob) return onClose();
    onDone(new File([blob], file.name.replace(/\.[^.]+$/, '') + (type === 'image/jpeg' ? '.jpg' : type === 'image/png' ? '.png' : '.webp'), { type }));
  }

  return <Modal title="编辑图片" wide className="image-editor" onClose={onClose}>
    <div className="image-editor-tools" role="toolbar" aria-label="编辑工具">
      <div className="segmented-control" role="radiogroup" aria-label="工具">
        <button type="button" role="radio" aria-checked={tool === 'pen'} className={tool === 'pen' ? 'active' : ''} onClick={() => setTool('pen')}><Pencil size={14} />画笔</button>
        <button type="button" role="radio" aria-checked={tool === 'crop'} className={tool === 'crop' ? 'active' : ''} onClick={() => setTool('crop')}><Crop size={14} />裁剪</button>
      </div>
      {tool === 'pen' && <div className="pen-colors" role="radiogroup" aria-label="画笔颜色">{COLORS.map(value => <button type="button" key={value} role="radio" aria-checked={color === value} aria-label={`颜色 ${value}`} className={color === value ? 'active' : ''} style={{ background: value }} onClick={() => setColor(value)} />)}</div>}
      {tool === 'crop' && <span className="inline-note">在图片上拖出要保留的区域</span>}
      <button type="button" className="secondary-button" disabled={!actions.length} onClick={() => setActions(previous => previous.slice(0, -1))}><Undo2 size={14} />撤销</button>
    </div>
    <div className="image-editor-stage">{image ? <canvas ref={canvas} className={tool} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="图片画布" /> : <p className="inline-note">正在打开图片…</p>}</div>
    <div className="modal-footer"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="button" className="primary-button" disabled={busy || !image} onClick={finish}>{busy ? '正在保存…' : '完成'}</button></div>
  </Modal>;
}

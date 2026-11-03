import { useRef, useState } from 'react';

// 置顶会话用鼠标拖动排序：被拖的一项跟手移动，其余项让位；松手后按新顺序保存。
// 只响应鼠标，触屏的长按菜单和滚动不受影响；键盘用 Alt+↑/↓ 调整。
export default function usePinnedDrag(onReorder) {
  const [drag, setDrag] = useState(null);
  const moved = useRef(false);

  function begin(event, id, ids) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || ids.length < 2) return;
    const list = event.currentTarget.parentElement, startY = event.clientY, from = ids.indexOf(id);
    const rects = ids.map(other => list.querySelector(`[data-room-id="${CSS.escape(other)}"]`)?.getBoundingClientRect());
    if (rects.some(rect => !rect)) return;
    const step = rects[1].top - rects[0].top;
    let current = null;
    const move = moveEvent => {
      const dy = Math.min(Math.max(moveEvent.clientY - startY, rects[0].top - rects[from].top), rects.at(-1).top - rects[from].top);
      if (!current && Math.abs(moveEvent.clientY - startY) < 4) return;
      const centre = rects[from].top + rects[from].height / 2 + dy;
      const index = rects.filter((rect, position) => position !== from && rect.top + rect.height / 2 < centre).length;
      current = { id, ids, from, index, dy, step };
      setDrag(current);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!current) return;
      moved.current = true;
      setDrag(null);
      if (current.index !== from) { const next = ids.filter(other => other !== id); next.splice(current.index, 0, id); onReorder(next); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function keyMove(event, id, ids) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return false;
    event.preventDefault();
    const from = ids.indexOf(id), to = from + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= ids.length) return true;
    const next = [...ids]; next.splice(from, 1); next.splice(to, 0, id); onReorder(next);
    return true;
  }

  function styleFor(id) {
    if (!drag) return undefined;
    if (id === drag.id) return { transform: `translateY(${drag.dy}px)`, zIndex: 2, transition: 'none' };
    const position = drag.ids.indexOf(id);
    const shift = drag.from < drag.index && position > drag.from && position <= drag.index ? -drag.step
      : drag.from > drag.index && position >= drag.index && position < drag.from ? drag.step : 0;
    return { transform: `translateY(${shift}px)`, transition: 'transform 200ms cubic-bezier(.23, 1, .32, 1)' };
  }

  // 拖动结束时浏览器还会派发一次 click，吞掉它，避免误切换会话。
  const consumeClick = () => { const value = moved.current; moved.current = false; return value; };
  return { dragging: drag?.id, begin, keyMove, styleFor, consumeClick };
}

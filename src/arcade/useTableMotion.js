import { useLayoutEffect, useRef } from 'react';

// 动画读取真实牌桌布局，手机端和换座后仍从荷官发到对应位置。状态始终以服务端为准。
export default function useTableMotion(table, stage, visible) {
  const cursor = useRef(null);
  const pending = useRef({ animations: new Set(), timers: new Set(), hidden: new Set(), nodes: new Set(), until: 0, bounds: null });
  const clear = () => {
    const state = pending.current;
    state.animations.forEach(animation => animation.cancel()); state.animations.clear();
    state.timers.forEach(timer => clearTimeout(timer)); state.timers.clear();
    state.hidden.forEach(node => { node.style.visibility = ''; }); state.hidden.clear();
    state.nodes.forEach(node => node.remove()); state.nodes.clear(); state.until = 0; state.bounds = null;
    stage.current?.querySelector('.poker-dealer-machine')?.removeAttribute('data-dealing');
  };
  useLayoutEffect(() => {
    const cancel = () => { if (document.hidden) clear(); };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const reduce = () => { if (media.matches) clear(); };
    const resize = new ResizeObserver(() => {
      const bounds = stage.current?.getBoundingClientRect(), previous = pending.current.bounds;
      // 同一次 React 更新里按钮区也会改变布局；已按新尺寸发出的动画不应被首次尺寸通知取消。
      if (bounds && previous && (Math.abs(bounds.width - previous.width) > .5 || Math.abs(bounds.height - previous.height) > .5)) clear();
    });
    if (stage.current) resize.observe(stage.current);
    document.addEventListener('visibilitychange', cancel); media.addEventListener('change', reduce);
    return () => { clear(); resize.disconnect(); document.removeEventListener('visibilitychange', cancel); media.removeEventListener('change', reduce); };
  }, [visible, table?.id]);
  useLayoutEffect(() => {
    const root = stage.current;
    const events = table?.events || [];
    const last = { table: table?.id, hand: table?.handId, event: events.at(-1)?.id || 0 };
    const before = cursor.current;
    cursor.current = last;
    if (!root || !visible || !before || before.table !== last.table) { clear(); return; }
    if (before.hand !== last.hand) clear();
    if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) { clear(); return; }
    const next = events.filter(event => event.id > before.event);
    if (!next.length) return;
    const layer = root.querySelector('.table-motion-layer');
    const deck = root.querySelector('.poker-deck .poker-card');
    if (!layer || !deck) return;
    const state = pending.current;
    if (state.until - performance.now() > 4000) { clear(); return; }
    const base = root.getBoundingClientRect();
    if (state.bounds && (Math.abs(base.width - state.bounds.width) > .5 || Math.abs(base.height - state.bounds.height) > .5)) clear();
    state.bounds = { width: base.width, height: base.height };
    const center = node => {
      const box = node?.getBoundingClientRect();
      return box ? { x: box.left - base.left + box.width / 2, y: box.top - base.top + box.height / 2, w: box.width, h: box.height } : null;
    };
    const origin = center(root.querySelector('[data-deal-origin]')) || center(deck);
    const pot = center(root.querySelector('[data-pot-anchor]'));
    const seat = id => root.querySelector(`[data-seat="${id}"]`);
    const bet = id => center(seat(id)?.querySelector('[data-bet-anchor]'));
    const stack = id => center(seat(id)?.querySelector('.mechanical-counter'));
    const later = (delay, fn) => {
      const timer = setTimeout(() => { state.timers.delete(timer); fn(); }, Math.max(0, delay));
      state.timers.add(timer);
    };
    const animate = (node, frames, options, done) => {
      const animation = node.animate(frames, options); state.animations.add(animation);
      animation.onfinish = () => { state.animations.delete(animation); done?.(); animation.cancel(); };
    };
    const remove = node => { state.nodes.delete(node); node.remove(); };
    const pulse = (node, delay) => { if (node) later(delay, () => animate(node, [{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { duration: 240, easing: 'ease-out' })); };
    const pitch = (target, delay, index) => {
      if (!target) return;
      const end = center(target);
      target.style.visibility = 'hidden'; state.hidden.add(target);
      const card = deck.cloneNode(true);
      card.classList.add('flying-card'); card.removeAttribute('aria-label'); card.setAttribute('aria-hidden', 'true');
      Object.assign(card.style, { width: `${end.w}px`, height: `${end.h}px`, animation: 'none', visibility: 'hidden' });
      layer.append(card); state.nodes.add(card);
      const at = (p, rotate, scale = 1) => `translate3d(${p.x - end.w / 2}px,${p.y - end.h / 2}px,0) rotate(${rotate}deg) scale(${scale})`;
      later(delay, () => {
        card.style.visibility = '';
        const spin = (end.x < origin.x ? -1 : 1) * (25 + index % 3 * 7);
        animate(card, [
          { transform: at(origin, spin, .55), opacity: .4 },
          { transform: at({ x: origin.x + (end.x - origin.x) * .62, y: origin.y + (end.y - origin.y) * .62 - 28 }, spin * -.35, 1.04), opacity: 1, offset: .58 },
          { transform: at({ x: end.x + 2, y: end.y + 3 }, 2), opacity: 1, offset: .88 },
          { transform: at(end, 0), opacity: 1 },
        ], { duration: 440, easing: 'cubic-bezier(.18,.72,.3,1)', fill: 'forwards' }, () => {
          target.style.visibility = ''; state.hidden.delete(target); remove(card);
          const back = target.classList.contains('back');
          animate(target.querySelector('.poker-card-face'), back ? [{ transform: 'translateY(2px)' }, { transform: 'translateY(0)' }] : [{ transform: 'rotateY(-85deg)' }, { transform: 'rotateY(0deg)' }], { duration: back ? 100 : 180, easing: 'ease-out' });
        });
      });
    };
    const chips = (from, to, amount, delay) => {
      if (!from || !to || !amount) return;
      const count = Math.min(7, Math.max(2, Math.ceil(Math.log10(amount + 1) * 2)));
      for (let i = 0; i < count; i++) {
        const chip = document.createElement('i'); chip.className = 'flying-chip'; chip.style.visibility = 'hidden'; layer.append(chip); state.nodes.add(chip);
        later(delay + i * 26, () => {
          chip.style.visibility = '';
          const dx = (i % 3 - 1) * 4, dy = -i * 2;
          const transform = (x, y, rotation) => `translate3d(${x - 13}px,${y - 7}px,0) rotate(${rotation}deg)`;
          animate(chip, [
            { transform: transform(from.x + dx, from.y + dy, -18), opacity: .5 },
            { transform: transform(from.x + (to.x - from.x) * .5 + dx, from.y + (to.y - from.y) * .5 - 24 + dy, 24), opacity: 1, offset: .45 },
            { transform: transform(to.x + dx, to.y + dy + 3, -8), opacity: 1, offset: .87 },
            { transform: transform(to.x + dx, to.y + dy, 0), opacity: 1 },
          ], { duration: 430, easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'both' }, () => remove(chip));
        });
      }
    };
    let delay = Math.max(0, state.until - performance.now());
    for (const event of next) {
      if (event.type === 'deal') {
        const machine = root.querySelector('.poker-dealer-machine');
        later(delay, () => { if (machine) machine.dataset.dealing = 'true'; });
        for (let round = 0; round < 2; round++) event.seats.forEach((id, i) => pitch(seat(id)?.querySelector(`[data-card-index="${round}"]`), delay + (round * event.seats.length + i) * 95, i));
        delay += event.seats.length * 2 * 95 + 500;
        later(delay, () => machine?.removeAttribute('data-dealing'));
      } else if (event.type === 'bet') { chips(stack(event.seat), bet(event.seat), event.amount, delay); pulse(seat(event.seat)?.querySelector('[data-bet-anchor]'), delay + 480); delay += 170; }
      else if (event.type === 'collect') { event.bets.forEach((item, i) => chips(bet(item.seat), pot, item.amount, delay + i * 40)); delay += 720; pulse(root.querySelector('.poker-pot'), delay); }
      else if (event.type === 'refund') { chips(bet(event.seat), stack(event.seat), event.amount, delay); delay += 480; }
      else if (event.type === 'board') { event.indices.forEach((i, n) => pitch(root.querySelector(`[data-board-index="${i}"]`), delay + n * 100, n)); delay += 580 + event.indices.length * 100; }
      else if (event.type === 'win') { event.awards.forEach((item, i) => { chips(pot, stack(item.seat), item.amount, delay + i * 100); pulse(seat(item.seat)?.querySelector('.seat-identity'), delay + i * 100 + 600); }); delay += 800; }
      else if (event.type === 'fold') {
        seat(event.seat)?.querySelectorAll('.seat-cards .poker-card').forEach((target, i) => {
          const from = center(target), card = deck.cloneNode(true);
          card.classList.add('flying-card'); card.style.animation = 'none'; card.style.visibility = 'hidden';
          Object.assign(card.style, { width: `${from.w}px`, height: `${from.h}px` });
          layer.append(card); state.nodes.add(card);
          later(delay + i * 45, () => {
            card.style.visibility = '';
            animate(card, [
              { transform: `translate(${from.x - from.w / 2}px,${from.y - from.h / 2}px) rotate(${i ? 8 : -8}deg)`, opacity: 1 },
              { transform: `translate(${origin.x - from.w / 2 + 30}px,${origin.y - from.h / 2 + 25}px) rotate(-30deg) scale(.65)`, opacity: 0 },
            ], { duration: 380, easing: 'ease-in', fill: 'both' }, () => remove(card));
          });
        });
        delay += 230;
      }
    }
    state.until = performance.now() + delay;
  }, [table, visible]);
}

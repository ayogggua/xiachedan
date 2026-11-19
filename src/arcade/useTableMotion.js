import { useLayoutEffect, useRef } from 'react';
import { chipLayout, createChipPile, createMovingChip, paintChipPile } from './pokerChips';
import { advanceChips, chipLaunchOffsets, createChipParticle } from './chipPhysics';

// 动画读取真实牌桌布局，手机端和换座后仍从荷官发到对应位置。状态始终以服务端为准。
export default function useTableMotion(table, stage, visible, onImpact) {
  const cursor = useRef(null);
  const impact = useRef(onImpact); impact.current = onImpact;
  const pending = useRef({ animations: new Set(), timers: new Set(), hidden: new Set(), concealed: new Map(), nodes: new Set(),
    packets: new Set(), chipViews: new Map(), frame: 0, lastFrame: 0, lastImpact: 0, until: 0, bounds: null });
  const clear = () => {
    const state = pending.current;
    cancelAnimationFrame(state.frame); state.frame = 0; state.lastFrame = 0; state.packets.clear(); state.chipViews.clear();
    state.animations.forEach(animation => animation.cancel()); state.animations.clear();
    state.timers.forEach(timer => clearTimeout(timer)); state.timers.clear();
    state.hidden.forEach(node => { node.style.visibility = ''; }); state.hidden.clear();
    state.concealed.forEach((count, node) => { node.style.visibility = ''; }); state.concealed.clear();
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
    if (state.until - performance.now() > 4000 || next.length > 32) { clear(); return; }
    const base = root.getBoundingClientRect();
    if (state.bounds && (Math.abs(base.width - state.bounds.width) > .5 || Math.abs(base.height - state.bounds.height) > .5)) clear();
    state.bounds = { width: base.width, height: base.height };
    const center = node => {
      const box = node?.getBoundingClientRect();
      return box ? { x: box.left - base.left + box.width / 2, y: box.top - base.top + box.height / 2, w: box.width, h: box.height } : null;
    };
    const origin = center(root.querySelector('[data-deal-origin]')) || center(deck);
    const pot = root.querySelector('[data-pot-anchor] .poker-chips');
    const seat = id => root.querySelector(`[data-seat="${id}"]`);
    const bet = id => seat(id)?.querySelector('[data-bet-anchor] .poker-chips');
    const stack = id => seat(id)?.querySelector('[data-stack-anchor] .poker-chips');
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
    const conceal = node => {
      if (!node) return () => {};
      state.concealed.set(node, (state.concealed.get(node) || 0) + 1); node.style.visibility = 'hidden';
      return () => {
        const remaining = (state.concealed.get(node) || 1) - 1;
        if (remaining > 0) state.concealed.set(node, remaining);
        else { state.concealed.delete(node); node.style.visibility = ''; }
      };
    };
    const amountAt = node => Math.max(0, Number(node?.dataset.chipAmount) || 0);
    const unitAt = node => Math.max(1, Number(node?.dataset.chipUnit) || table.smallBlind || 1);
    const ledger = new Map();
    const valueAt = node => ledger.has(node) ? ledger.get(node) : amountAt(node);
    const adjust = (node, amount) => { if (node) ledger.set(node, valueAt(node) + amount); };
    // A single server update can already contain collection and payout. Rebuild the
    // preceding visible piles instead of reading their now-empty DOM canvases.
    for (const event of [...next].reverse()) {
      if (event.type === 'bet') adjust(bet(event.seat), -event.amount);
      else if (event.type === 'collect') for (const item of event.bets) { adjust(bet(item.seat), item.amount); adjust(pot, -item.amount); }
      else if (event.type === 'refund') adjust(bet(event.seat), event.amount);
      else if (event.type === 'win') for (const item of event.awards) adjust(pot, item.amount);
    }
    const ensureView = (node, amount, unit) => {
      if (state.chipViews.has(node)) return state.chipViews.get(node);
      const box = node.getBoundingClientRect(), canvas = createChipPile(Math.max(0, amount), document, unit);
      const view = { node, canvas, amount: Math.max(0, amount), unit, reveal: conceal(node) };
      Object.assign(canvas.style, { position: 'absolute', left: `${box.left - base.left}px`, top: `${box.bottom - base.top - box.width * .84}px`,
        bottom: 'auto', width: `${box.width}px`, height: `${box.width * .84}px`, zIndex: `${Math.round((box.bottom - base.top - box.width * .17) * 10)}` });
      layer.append(canvas); state.nodes.add(canvas); state.chipViews.set(node, view); return view;
    };
    const paintView = view => paintChipPile(view.canvas, Math.max(0, view.amount), view.unit);
    const clearViews = () => {
      for (const view of state.chipViews.values()) { remove(view.canvas); view.reveal(); }
      state.chipViews.clear();
    };
    const drawParticle = (particle, node, scale) => {
      const x = particle.x * scale, y = (particle.y - particle.z) * scale;
      // Rotate on the table plane: the .56 projection keeps a spinning chip elliptical.
      node.style.transform = `translate3d(${x - 30 * scale}px,${y - 20 * scale}px,0) scaleY(.56) rotate(${particle.angle}rad) scaleY(${1 / .56})`;
      node.style.zIndex = `${Math.round(particle.y * scale * 10 + particle.z)}`;
    };
    const runFrame = time => {
      state.frame = 0;
      const delta = state.lastFrame ? (time - state.lastFrame) / 1000 : 1 / 60;
      state.lastFrame = time;
      if (!root.isConnected || document.hidden || delta > .25 || [...state.packets].some(packet => time - packet.createdAt > 7000)) { clear(); return; }
      for (const packet of state.packets) {
        if (!packet.started) {
          if (time < packet.notBefore || packet.dependencies.some(dependency => !dependency.done)) continue;
          packet.begin(time / 1000);
        }
        if (packet.step(delta, time / 1000)) {
          packet.finish(); packet.done = true; state.packets.delete(packet);
        }
      }
      if (state.packets.size) state.frame = requestAnimationFrame(runFrame);
      else { state.lastFrame = 0; clearViews(); }
    };
    let overflow = false;
    const chips = (source, target, amount, delay, kind, sourceAmount, targetBefore, targetAfter) => {
      if (!source || !target || !amount) return;
      const fromBox = source.getBoundingClientRect(), toBox = target.getBoundingClientRect();
      if (!fromBox.width || !toBox.width) return;
      if (state.packets.size >= 12) { overflow = true; return; }
      const unit = unitAt(target), layout = chipLayout(amount, unit, 24);
      if (!layout.length) return;
      const sourceView = ensureView(source, sourceAmount, unitAt(source)), targetView = ensureView(target, targetBefore, unit);
      const sourceSlots = chipLayout(Math.max(amount, sourceAmount), unitAt(source), 24).reverse();
      const occupied = new Map();
      for (const chip of chipLayout(targetBefore, unit, 24)) occupied.set(chip.kind, (occupied.get(chip.kind) || 0) + 1);
      const targetSlots = chipLayout(Math.max(amount, targetAfter), unit, 24).filter(chip => {
        const count = occupied.get(chip.kind) || 0;
        if (!count) return true;
        occupied.set(chip.kind, count - 1); return false;
      });
      const slot = (slots, chip) => {
        const match = slots.findIndex(item => item.kind === chip.kind);
        return match >= 0 ? slots.splice(match, 1)[0] : slots.shift() || chip;
      };
      const scale = toBox.width / 100 * .53;
      const point = (box, chip) => ({ x: (box.left - base.left + chip.x / 100 * box.width) / scale,
        y: (box.bottom - base.top - box.width * .84 + chip.baseY / 100 * box.width) / scale,
        z: chip.z * (box.width / toBox.width) });
      const paths = layout.map(chip => ({ chip, from: point(fromBox, slot(sourceSlots, chip)), target: point(toBox, slot(targetSlots, chip)) }));
      const offsets = chipLaunchOffsets(paths.length, kind);
      const packet = { source, target, createdAt: performance.now(), notBefore: performance.now() + delay, started: false, done: false,
        dependencies: [...state.packets].filter(other => other.target === source), particles: [], nodes: [],
        begin(time) {
          packet.started = true; sourceView.amount = Math.max(0, sourceView.amount - amount); paintView(sourceView);
          for (const [i, path] of paths.entries()) {
            const particle = createChipParticle(path.from, path.target, time + offsets[i]);
            const node = createMovingChip(document, path.chip.kind, path.chip.variant);
            node.className = 'moving-chip'; node.setAttribute('aria-hidden', 'true');
            Object.assign(node.style, { position: 'absolute', left: '0', top: '0', width: `${60 * scale}px`, height: `${44 * scale}px`,
              transformOrigin: '50% 45.454545%', pointerEvents: 'none', willChange: 'transform' });
            drawParticle(particle, node, scale); layer.append(node); state.nodes.add(node);
            packet.particles.push(particle); packet.nodes.push(node);
          }
        },
        step(delta, time) {
          const finished = advanceChips(packet.particles, delta, time);
          packet.particles.forEach((particle, i) => drawParticle(particle, packet.nodes[i], scale));
          const strength = Math.min(1, Math.max(...packet.particles.map(particle => particle.impact || 0)) / 350);
          if (strength > .08 && time * 1000 - state.lastImpact >= 40) { state.lastImpact = time * 1000; impact.current?.(strength); }
          return finished;
        },
        finish() {
          packet.nodes.forEach(remove); targetView.amount += amount; paintView(targetView);
        },
      };
      state.packets.add(packet);
      if (!state.frame) { state.lastFrame = performance.now(); state.frame = requestAnimationFrame(runFrame); }
    };
    let delay = Math.max(0, state.until - performance.now());
    for (const event of next) {
      if (event.type === 'deal') {
        const machine = root.querySelector('.poker-dealer-machine');
        later(delay, () => { if (machine) machine.dataset.dealing = 'true'; });
        for (let round = 0; round < 2; round++) event.seats.forEach((id, i) => pitch(seat(id)?.querySelector(`[data-card-index="${round}"]`), delay + (round * event.seats.length + i) * 95, i));
        delay += event.seats.length * 2 * 95 + 500;
        later(delay, () => machine?.removeAttribute('data-dealing'));
      } else if (event.type === 'bet') {
        const target = bet(event.seat), before = Math.max(0, valueAt(target)); adjust(target, event.amount);
        chips(stack(event.seat), target, event.amount, delay, 'bet', event.amount, before, before + event.amount); delay += 180;
      }
      else if (event.type === 'collect') {
        event.bets.forEach((item, i) => {
          const source = bet(item.seat), before = Math.max(0, valueAt(pot)), sourceAmount = Math.max(item.amount, valueAt(source));
          adjust(source, -item.amount); adjust(pot, item.amount);
          chips(source, pot, item.amount, delay + i * 80, 'collect', sourceAmount, before, before + item.amount);
        });
        delay += 650 + Math.max(0, event.bets.length - 1) * 80; pulse(root.querySelector('.poker-pot'), delay);
      }
      else if (event.type === 'refund') {
        const source = bet(event.seat), before = Math.max(event.amount, valueAt(source)); adjust(source, -event.amount);
        chips(source, stack(event.seat), event.amount, delay, 'refund', before, 0, event.amount); delay += 180;
      }
      else if (event.type === 'board') { event.indices.forEach((i, n) => pitch(root.querySelector(`[data-board-index="${i}"]`), delay + n * 100, n)); delay += 580 + event.indices.length * 100; }
      else if (event.type === 'win') {
        event.awards.forEach((item, i) => {
          const before = Math.max(item.amount, valueAt(pot)); adjust(pot, -item.amount);
          chips(pot, stack(item.seat), item.amount, delay + i * 100, 'win', before, 0, item.amount);
          pulse(seat(item.seat)?.querySelector('.seat-identity'), delay + i * 100 + 600);
        }); delay += 350;
      }
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
    if (overflow || delay > 4000) { clear(); return; }
    state.until = performance.now() + delay;
  }, [table, visible]);
}

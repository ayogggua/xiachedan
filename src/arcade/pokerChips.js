// Geometry and palette recovered from CrommaCode 0.3.29, function 0x100d1aad8.
// The browser renderer shares cached faces between resting piles and moving chips.
export const CHIP_RADIUS = 26;
export const CHIP_THICKNESS = 4.42;
export const CHIP_COLORS = [
  ['#f0e7d6', '#2769b7'], ['#cc3430', '#f0e7d6'], ['#2769b7', '#f0e7d6'],
  ['#1a8a51', '#f0e7d6'], ['#7945ab', '#f0e7d6'], ['#2b2823', '#cc3430'],
];
const faces = new Map();
const projection = .56, tau = Math.PI * 2, stripePeriod = Math.PI / 4;
const shade = (hex, light) => `rgb(${[1, 3, 5].map(start => Math.min(255, Math.round(parseInt(hex.slice(start, start + 2), 16) * light))).join(' ')})`;
const point = (radius, angle, height = 0) => [Math.cos(angle) * radius, Math.sin(angle) * radius * projection + height];
function polygon(ctx, points, color) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}

function face(document, kind, variant) {
  const key = `${kind}:${variant % 6}`;
  if (faces.has(key)) return faces.get(key);
  const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 88;
  const ctx = canvas.getContext('2d'); ctx.scale(2, 2); ctx.translate(30, 20);
  const [base, stripe] = CHIP_COLORS[kind] || CHIP_COLORS[0];
  const rotation = variant * Math.PI / 24;
  const paint = angle => ((angle + rotation) % stripePeriod + stripePeriod) % stripePeriod < stripePeriod * .42 ? stripe : base;
  const stripeSegments = end => {
    const edges = [0, end];
    for (let i = 0; i < 10; i++) for (const offset of [0, .42]) {
      const angle = (i + offset) * stripePeriod - rotation;
      if (angle > 0 && angle < end) edges.push(angle);
    }
    edges.sort((a, b) => a - b);
    return edges.slice(1).flatMap((end, i) => {
      const start = edges[i], pieces = Math.ceil((end - start) / (Math.PI / 36));
      return Array.from({ length: pieces }, (_, n) => [start + (end - start) * n / pieces, start + (end - start) * (n + 1) / pieces]);
    });
  };
  ctx.fillStyle = '#302b221c'; ctx.beginPath(); ctx.ellipse(1, CHIP_THICKNESS + 1, 26.8, 15.2, 0, 0, tau); ctx.fill();
  for (const [a, b] of stripeSegments(Math.PI)) {
    const mid = (a + b) / 2;
    const top = point(26, mid), color = paint(mid), light = .6 + Math.sin(mid) * .2;
    const gradient = ctx.createLinearGradient(top[0], top[1], top[0], top[1] + CHIP_THICKNESS);
    gradient.addColorStop(0, shade(color, light)); gradient.addColorStop(1, shade(color, light * .82));
    polygon(ctx, [point(26, a), point(26, b), point(26, b, CHIP_THICKNESS), point(26, a, CHIP_THICKNESS)], gradient);
  }
  const ring = (inner, outer, color, light = () => 1, segments = Array.from({ length: 72 }, (_, i) => [i * tau / 72, (i + 1) * tau / 72])) => {
    for (const [a, end] of segments) {
      const b = end + .001, mid = (a + end) / 2;
      polygon(ctx, [point(inner, a), point(outer, a), point(outer, b), point(inner, b)], shade(typeof color === 'function' ? color(mid) : color, light(mid)));
    }
  };
  const lighting = a => 1 - Math.sin(a) * .07;
  ring(20.28, 26, paint, lighting, stripeSegments(tau));
  ring(19.28, 20.28, base, () => .7);
  ring(14.32, 19.28, base, a => lighting(a) * .92);
  ring(13.52, 14.32, stripe);
  ring(0, 13.52, '#f8f3e8', lighting);
  ring(25.1, 26, base, () => .62);
  for (let i = 0; i < 36; i++) {
    const a = i * Math.PI / 36, b = (i + 1) * Math.PI / 36;
    polygon(ctx, [point(26, a, CHIP_THICKNESS - .9), point(26, b, CHIP_THICKNESS - .9), point(26, b, CHIP_THICKNESS), point(26, a, CHIP_THICKNESS)], shade(base, .45));
  }
  faces.set(key, canvas); return canvas;
}

// Native amount decomposition, 0x100e61240. Compression retains the exact value.
export function chipAmounts(amount, unit = 1, budget = 24) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return [];
  unit = Number.isSafeInteger(unit) && unit > 0 ? unit : 1;
  budget = Math.max(1, Math.min(60, Math.floor(budget) || 24));
  const values = [500, 100, 25, 10, 5, 1], kinds = [4, 5, 3, 2, 1, 0];
  let remaining = Math.floor(amount / unit);
  const counts = values.map(value => { const count = Math.floor(remaining / value); remaining %= value; return count; });
  const spare = () => Math.max(0, budget - counts.reduce((sum, count) => sum + count, 0));
  const split = (index, additions, increase, available = counts[index]) => {
    const count = Math.min(available, Math.floor(spare() / increase)); counts[index] -= count;
    for (const [target, multiple] of additions) counts[target] += count * multiple;
  };
  split(0, [[1, 5]], 4); split(1, [[2, 4]], 3); split(2, [[3, 2], [4, 1]], 2); split(3, [[4, 2]], 1);
  split(4, [[5, 5]], 4, counts[4] - Math.ceil(counts[4] / 3));
  const chips = [];
  for (let i = 0; i < counts.length; i++) {
    const count = Math.min(counts[i], budget - chips.length);
    for (let n = 0; n < count; n++) chips.push({ kind: kinds[i], value: values[i] * unit });
  }
  if (!chips.length) return [{ kind: 0, value: amount }];
  const remainder = amount % unit, represented = chips.reduce((sum, chip) => sum + chip.value, 0);
  chips[0].value += amount - represented - remainder; chips.at(-1).value += remainder;
  return chips;
}

export function chipLayout(amount, unit = 1, budget = 24) {
  const piles = [];
  for (const chip of chipAmounts(amount, unit, budget)) {
    let pile = piles.find(items => items[0].kind === chip.kind && items.length < 20);
    if (!pile) { pile = []; piles.push(pile); }
    pile.push(chip);
  }
  const columns = Math.min(3, piles.length);
  return piles.flatMap((pile, index) => pile.map((chip, level) => {
    const column = index % 3, row = Math.floor(index / 3), baseY = 67 - (piles.length > 3 && row === 0 ? 9 : 0);
    return { ...chip, x: 50 + (column - (columns - 1) / 2) * 32, y: baseY - level * CHIP_THICKNESS * .53, baseY, z: level * CHIP_THICKNESS, variant: (level * 5 + index * 2) % 6 };
  }));
}

export function paintChipPile(canvas, amount, unit = 1) {
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  canvas.width = Math.ceil(100 * dpr); canvas.height = Math.ceil(84 * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  for (const chip of chipLayout(amount, unit)) ctx.drawImage(face(canvas.ownerDocument, chip.kind, chip.variant), chip.x - 15.9, chip.y - 10.6, 31.8, 23.32);
}

export function createChipPile(amount, document, unit = 1) {
  const canvas = document.createElement('canvas'); canvas.className = 'poker-chip-pile'; canvas.setAttribute('aria-hidden', 'true');
  paintChipPile(canvas, amount, unit); return canvas;
}

export function createMovingChip(document, kind, variant) {
  const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 88;
  canvas.getContext('2d').drawImage(face(document, kind, variant), 0, 0); return canvas;
}

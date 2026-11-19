// CrommaCode 0.3.29: emitter 0x100cb6c48, motion 0x100a2ed38 and table collisions.
const GRAVITY = 1500, FRICTION = 820, BOUNCE = .36, RETAIN = .88;
const SPRING = 986.9605, DAMPING = 62.831856, PROJECTION = .56;
export const CHIP_STEP = 1 / 240;

export function launchSpeed(distance, vz, height = 0) {
  // Solve distance = weighted flight time * speed + final sliding distance.
  // The first flight also accounts for a chip leaving an existing raised pile.
  let flight = 0, retained = 1, vertical = Math.max(0, vz), z = Math.max(0, height);
  if (!vertical && !z) return Math.sqrt(Math.max(1, distance) * 2 * FRICTION);
  do {
    const landing = Math.sqrt(vertical * vertical + 2 * GRAVITY * z);
    flight += retained * (vertical + landing) / GRAVITY;
    retained *= RETAIN; vertical = landing * BOUNCE; z = 0;
  } while (vertical >= 45);
  const slide = retained * retained / (2 * FRICTION);
  const length = Math.max(1, distance);
  return 2 * length / (Math.sqrt(flight * flight + 4 * slide * length) + flight);
}

export function chipLaunchOffsets(count, kind = 'bet', random = Math.random) {
  if (kind === 'collect') return Array.from({ length: count }, (_, i) => i * Math.min(.45 / count, .025));
  if (kind === 'win') {
    const intervals = Array.from({ length: Math.max(0, count - 1) }, (_, i) => .085 + (.032 - .085) * i / Math.max(1, count - 2));
    const ratio = Math.min(1, 2.6 / (intervals.reduce((sum, value) => sum + value, 0) || 1));
    let delay = 0;
    return Array.from({ length: count }, (_, i) => { const at = delay; delay += Math.max(.014, (intervals[i] || 0) * ratio); return at; });
  }
  return Array.from({ length: count }, (_, i) => i / count * .16 * (random() + .5));
}

export function createChipParticle(from, target, startAt = 0, random = Math.random) {
  const vz = (random() * .35 + .15) * 230;
  const direction = Math.atan2(target.y - from.y, target.x - from.x) + (random() - .5) * .24;
  const speed = launchSpeed(Math.hypot(target.x - from.x, target.y - from.y), vz, from.z) * (1 + (random() - .5) * .22);
  return { x: from.x, y: from.y, z: from.z || 0, vx: Math.cos(direction) * speed, vy: Math.sin(direction) * speed,
    vz, angle: 0, spin: (12 + random() * 8) * (random() < .5 ? -1 : 1), target: { ...target }, startAt, state: 0 };
}

export function settleChip(chip) {
  Object.assign(chip, chip.target, { vx: 0, vy: 0, vz: 0, spin: 0, angle: 0, state: 3 });
}

function noteStackArrival(chip) {
  if (chip.stackNoted || !chip.state || !chip.target.z) return;
  if (chip.state === 3 || (Math.hypot(chip.target.x - chip.x, chip.target.y - chip.y) < 7.8 && Math.abs(chip.target.z - chip.z) < 2.21)) {
    chip.stackNoted = true;
    chip.stackImpact = Math.round(chip.target.z / 4.42);
  }
}

function stepChip(chip, dt, time) {
  if (chip.state === 3) return;
  if (chip.state === 0) { if (time >= chip.startAt) chip.state = 1; return; }
  if (time - chip.startAt >= 3) { settleChip(chip); return; }
  if (chip.state === 1) {
    chip.angle += chip.spin * dt;
    if (chip.z <= 0 && chip.vz <= 0) {
      chip.spin *= Math.exp(-2 * dt);
      const speed = Math.hypot(chip.vx, chip.vy), remaining = Math.max(0, speed - FRICTION * dt);
      const fraction = speed > .001 ? remaining / speed : 0;
      chip.vx *= fraction; chip.vy *= fraction; chip.x += chip.vx * dt; chip.y += chip.vy * dt;
      if (remaining < 70) chip.state = 2;
    } else {
      const incoming = Math.max(0, -chip.vz);
      chip.z += chip.vz * dt; chip.vz -= GRAVITY * dt;
      chip.x += chip.vx * dt; chip.y += chip.vy * dt;
      if (chip.z <= 0) {
        chip.impact = Math.max(chip.impact || 0, Math.abs(chip.vz));
        chip.z = 0; chip.vz *= -BOUNCE; chip.vx *= RETAIN; chip.vy *= RETAIN;
        if (chip.vz < 45) chip.vz = 0;
        const kind = chip.vz > 0 ? 'bounce' : 'land';
        chip[kind] = Math.max(chip[kind] || 0, Math.min(1, incoming / 138));
      }
    }
    return;
  }
  chip.vx += ((chip.target.x - chip.x) * SPRING - chip.vx * DAMPING) * dt;
  chip.vy += ((chip.target.y - chip.y) * SPRING - chip.vy * DAMPING) * dt;
  chip.vz += ((chip.target.z - chip.z) * SPRING - chip.vz * DAMPING) * dt;
  chip.x += chip.vx * dt; chip.y += chip.vy * dt; chip.z += chip.vz * dt;
  chip.spin *= Math.exp(-2 * dt); chip.angle += chip.spin * dt;
  if (Math.hypot(chip.target.x - chip.x, chip.target.y - chip.y) < .5 && Math.abs(chip.target.z - chip.z) < .5 && Math.hypot(chip.vx, chip.vy) < 6) settleChip(chip);
}

export function collideChips(chips, random = Math.random) {
  for (let i = 0; i < chips.length; i++) {
    const a = chips[i]; if (a.state !== 1) continue;
    for (let j = i + 1; j < chips.length; j++) {
      const b = chips[j]; if (b.state !== 1 || Math.abs(a.z - b.z) > 15.6) continue;
      const dx = a.x - b.x, dy = (a.y - b.y) / PROJECTION, distance = Math.hypot(dx, dy);
      if (distance >= 52) continue;
      const nx = distance > .001 ? dx / distance : 1, ny = distance > .001 ? dy / distance : 0;
      const separation = (52 - distance) * .35 * .5;
      a.x += nx * separation; a.y += ny * separation * PROJECTION;
      b.x -= nx * separation; b.y -= ny * separation * PROJECTION;
      const relative = (a.vx - b.vx) * nx + (a.vy - b.vy) / PROJECTION * ny;
      if (relative >= 0) continue;
      const impulse = -1.6 * relative / 2, tangent = (random() - .5) * 2 * .35 * impulse;
      a.impact = Math.max(a.impact || 0, impulse); b.impact = Math.max(b.impact || 0, impulse);
      a.collision = Math.max(a.collision || 0, Math.min(1, impulse / 260));
      const ix = nx * impulse - ny * tangent, iy = (ny * impulse + nx * tangent) * PROJECTION;
      a.vx += ix; a.vy += iy; b.vx -= ix; b.vy -= iy;
    }
  }
}

export function advanceChips(chips, delta, time, random = Math.random) {
  // A suspended tab is restored by the caller; never run an unbounded catch-up loop.
  const duration = Math.max(0, Math.min(.05, delta));
  for (const chip of chips) { chip.impact = 0; chip.bounce = 0; chip.land = 0; chip.collision = 0; chip.stackImpact = 0; }
  const steps = Math.max(1, Math.ceil(duration / CHIP_STEP)), dt = duration / steps;
  for (let i = 0; i < steps; i++) {
    const at = time - duration + (i + 1) * dt;
    for (const chip of chips) { stepChip(chip, dt, at); noteStackArrival(chip); }
    collideChips(chips, random);
  }
  return chips.every(chip => chip.state === 3);
}

// 撤回时的粉碎效果：在气泡原位置铺一层画布，把气泡拆成小颗粒从左到右依次飘散（Telegram 式）。
// 只读取气泡的位置和颜色，不截图内容；系统要求减少动态效果时不播放。
const SIZE = 3;
const DURATION = 900;

export function disintegrate(element) {
  if (!element || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rect = element.getBoundingClientRect();
  if (!rect.width || rect.bottom < 0 || rect.top > window.innerHeight) return;
  const style = getComputedStyle(element);
  const fill = style.backgroundColor, ink = style.color;
  const margin = 60, ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', left: `${rect.left - margin}px`, top: `${rect.top - margin}px`, width: `${rect.width + margin * 2}px`, height: `${rect.height + margin * 2}px`, pointerEvents: 'none', zIndex: 50 });
  canvas.width = (rect.width + margin * 2) * ratio;
  canvas.height = (rect.height + margin * 2) * ratio;
  document.body.appendChild(canvas);
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, rect.width / 2, rect.height / 2);
  const outside = (x, y) => {
    const cx = Math.min(Math.max(x, radius), rect.width - radius), cy = Math.min(Math.max(y, radius), rect.height - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2;
  };
  const particles = [];
  for (let x = 0; x < rect.width; x += SIZE) for (let y = 0; y < rect.height; y += SIZE) {
    if (outside(x + SIZE / 2, y + SIZE / 2)) continue;
    particles.push({ x: x + margin, y: y + margin, delay: (x / rect.width) * 360 + Math.random() * 120,
      dx: 20 + Math.random() * 40, dy: -10 - Math.random() * 30, color: Math.random() < .12 ? ink : fill });
  }
  const start = performance.now();
  const frame = now => {
    const elapsed = now - start;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const particle of particles) {
      const t = Math.min(1, Math.max(0, (elapsed - particle.delay) / (DURATION - 360)));
      if (t >= 1) continue;
      const eased = 1 - (1 - t) ** 3;
      context.globalAlpha = 1 - t;
      context.fillStyle = particle.color;
      context.fillRect(particle.x + particle.dx * eased, particle.y + particle.dy * eased, SIZE * (1 - t * .5), SIZE * (1 - t * .5));
    }
    if (elapsed < DURATION + 120) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}

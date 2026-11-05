// 新消息提示音：用 WebAudio 现场合成两声短促的「叮」，不需要音频文件。1.5 秒内最多响一次。
let context;
let lastPlayed = 0;

export function playMessageSound({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastPlayed < 1500) return;
  lastPlayed = now;
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === 'suspended') context.resume().catch(() => {});
    const start = context.currentTime;
    const gain = context.createGain();
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
    for (const [frequency, offset] of [[880, 0], [1318.5, 0.085]]) {
      const tone = context.createOscillator();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(frequency, start + offset);
      tone.connect(gain);
      tone.start(start + offset);
      tone.stop(start + 0.4);
    }
  } catch {}
}

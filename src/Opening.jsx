import React, { useEffect, useRef, useState } from 'react';
import appIcon from './assets/brand/app-icon.svg';
import shrimp from './assets/brand/shrimp.svg';
import { popoutRoom } from './popout';
import './opening.css';

const SEEN = 'linliao.opening.seen';
const DURATION = 5800;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const shouldPlay = () => {
  if (popoutRoom || reducedMotion()) return false;
  try { if (localStorage.getItem('linliao.appLock')) return false; } catch {}
  try { return !sessionStorage.getItem(SEEN); } catch { return true; }
};
const remember = () => { try { sessionStorage.setItem(SEEN, '1'); } catch {} };

// Original procedural planet: no imagery or video from the reference application.
function Planet() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const size = window.innerWidth < 640 ? 480 : 720;
    canvas.width = canvas.height = size;
    const pixels = ctx.createImageData(size, size);
    const hash = (x, y) => {
      const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return value - Math.floor(value);
    };
    const noise = (x, y) => {
      const ix = Math.floor(x), iy = Math.floor(y);
      let fx = x - ix, fy = y - iy;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
      return a + fx * (b - a) + fy * (c - a) + fx * fy * (a - b - c + d);
    };
    const terrain = (x, y) => noise(x, y) * .57 + noise(x * 2.05, y * 2.05) * .28 + noise(x * 4.2, y * 4.2) * .15;
    for (let py = 0; py < size; py++) {
      const y = (py + .5) / size * 2 - 1;
      const v = Math.asin(y) * 3.1 + 23.7;
      for (let px = 0; px < size; px++) {
        const x = (px + .5) / size * 2 - 1, radius = x * x + y * y;
        if (radius > 1) continue;
        const z = Math.sqrt(1 - radius);
        const u = Math.atan2(x, z) * 3.1 + 17.2;
        const land = terrain(u * 1.6, v * 1.6);
        const cloud = terrain(u * 5.2 + Math.sin(v * 1.7), v * 5.2);
        const mountain = terrain(u * 16, v * 16);
        const light = Math.max(.08, x * -.32 + y * -.48 + z * .78);
        const atmosphere = Math.pow(1 - z, 3) * .65;
        const cloudAmount = Math.max(0, Math.min(1, (cloud - .50) * 4.7));
        const ice = Math.max(0, (Math.abs(y) - .86) * 5.5);
        let color = land > .52 ? [54 + mountain * 77, 76 + mountain * 64, 62 + mountain * 40] : [8 + mountain * 10, 48 + mountain * 27, 84 + mountain * 40];
        const white = Math.max(cloudAmount, ice);
        color = color.map((channel, index) => ((channel * (1 - white) + [225, 235, 232][index] * white) * light) * (1 - atmosphere) + [51, 151, 215][index] * atmosphere);
        const i = (py * size + px) * 4;
        pixels.data[i] = color[0]; pixels.data[i + 1] = color[1]; pixels.data[i + 2] = color[2];
        pixels.data[i + 3] = Math.min(255, (1 - radius) * 12000);
      }
    }
    ctx.putImageData(pixels, 0, 0);
  }, []);
  return <div className="opening-planet"><canvas ref={ref} /><div className="opening-atmosphere" /></div>;
}

function Cabin() {
  return <svg className="opening-cabin" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="opening-metal" x1="0" y1="0" x2="1" y2=".4"><stop stopColor="#172422" /><stop offset=".5" stopColor="#454a3d" /><stop offset="1" stopColor="#151e1c" /></linearGradient>
      <linearGradient id="opening-window" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#a09676" /><stop offset=".25" stopColor="#3b453e" /><stop offset=".7" stopColor="#151e1b" /><stop offset="1" stopColor="#7c7c62" /></linearGradient>
      <radialGradient id="opening-screen"><stop stopColor="#bccfba" /><stop offset=".8" stopColor="#819d8e" /><stop offset="1" stopColor="#39574c" /></radialGradient>
      <pattern id="opening-padding" width="62" height="62" patternUnits="userSpaceOnUse"><rect width="62" height="62" fill="#343d35" /><path d="M0 31 31 0 62 31 31 62Z" fill="none" stroke="#1f2b26" strokeWidth="2" /><path d="M1 32 32 1M32 61 61 32" stroke="#616957" strokeOpacity=".3" /></pattern>
      <pattern id="opening-scan" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 1H4" stroke="#163b30" strokeOpacity=".22" /></pattern>
      <filter id="opening-glow"><feGaussianBlur stdDeviation="4" /></filter>
    </defs>
    <path d="M0 0H1440V900H0V800H580Q670 800 670 710V120Q670 50 580 50H0Z" fill="url(#opening-metal)" />
    <path d="M0 40H582Q684 40 684 133V704Q684 812 576 812H0" fill="none" stroke="url(#opening-window)" strokeWidth="42" />
    <path d="M0 62H574Q650 62 650 136V700Q650 774 574 774H0" fill="none" stroke="#0a1816" strokeWidth="13" />
    <path d="M0 76H570Q636 76 636 140V700Q636 759 570 759H0" fill="none" stroke="#b2c6b3" strokeOpacity=".26" strokeWidth="2" />
    <rect x="1110" y="0" width="330" height="900" fill="url(#opening-padding)" />
    <path d="M1132 0V900M1153 0V900" stroke="#111d18" strokeWidth="10" />
    <rect x="726" y="65" width="342" height="732" rx="16" fill="#111e1b" stroke="#69705b" strokeWidth="6" />
    <rect x="748" y="90" width="298" height="132" rx="5" fill="#1d2e26" />
    {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M763 ${105 + i * 12}H1030`} stroke="#080f0d" strokeWidth="6" />)}
    <rect x="751" y="251" width="292" height="82" rx="4" fill="#292e22" stroke="#6f7259" strokeWidth="2" />
    {Array.from({ length: 28 }, (_, i) => <rect key={i} x={767 + (i % 14) * 19} y={268 + Math.floor(i / 14) * 31} width={9 + i % 3 * 3} height={5 + i % 2 * 7} rx="1" fill={i % 4 === 0 ? '#b6d8a1' : '#e7aa65'} opacity={i % 5 === 0 ? .25 : .9} />)}
    <rect x="748" y="363" width="298" height="240" rx="18" fill="#59614d" stroke="#0c1915" strokeWidth="8" />
    <rect x="768" y="381" width="258" height="193" rx="28" fill="#0c201b" stroke="#90957a" strokeWidth="4" />
    <rect className="opening-crt" x="778" y="390" width="238" height="175" rx="24" fill="url(#opening-screen)" />
    <rect x="778" y="390" width="238" height="175" rx="24" fill="url(#opening-scan)" />
    <image className="opening-screen-mark" href={shrimp} x="870" y="449" width="54" height="54" opacity=".8" />
    <path d="M1059 390V576M744 390V576" stroke="#89927b" strokeWidth="3" opacity=".5" />
    <path d="M766 637H1029M766 650H1029M766 663H1029" stroke="#4e5d45" strokeWidth="3" />
    {[788, 831, 874].map((x, i) => <g key={x}><circle cx={x} cy="708" r="12" fill="#080f0a" /><circle cx={x} cy="707" r="5" fill={i ? '#a7c6a0' : '#eb9e64'} /><circle cx={x} cy="707" r="8" fill={i ? '#a7c6a0' : '#eb9e64'} opacity=".5" filter="url(#opening-glow)" /></g>)}
    <rect x="968" y="688" width="60" height="37" rx="4" fill="#697259" stroke="#a5a788" strokeWidth="2" />
    {[165, 375, 615].map(y => <g key={y}><rect x="1174" y={y} width="130" height="62" rx="5" fill="#747966" stroke="#a1a086" strokeWidth="2" /><path d={`M1195 ${y + 20}H1283M1195 ${y + 40}H1283`} stroke="#353f32" strokeWidth="5" /></g>)}
    <path d="M0 850H1440" stroke="#090f0c" strokeWidth="30" />
  </svg>;
}

export default function Opening() {
  const [playing, setPlaying] = useState(shouldPlay);
  const [run, setRun] = useState(0);
  const skipButton = useRef(null);
  const skip = () => { remember(); setPlaying(false); };
  useEffect(() => {
    const replay = () => { if (!popoutRoom && !reducedMotion()) { setRun(value => value + 1); setPlaying(true); } };
    window.addEventListener('linliao:replay-opening', replay);
    return () => window.removeEventListener('linliao:replay-opening', replay);
  }, []);
  useEffect(() => {
    if (!playing) return;
    remember();
    const previousFocus = document.activeElement;
    skipButton.current?.focus({ preventScroll: true });
    const timeout = setTimeout(() => setPlaying(false), DURATION);
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPlaying(false); }
      if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); skipButton.current?.focus(); }
    };
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const changed = event => { if (event.matches) setPlaying(false); };
    document.addEventListener('keydown', escape, true);
    preference?.addEventListener?.('change', changed);
    return () => { clearTimeout(timeout); document.removeEventListener('keydown', escape, true); preference?.removeEventListener?.('change', changed); previousFocus?.focus?.({ preventScroll: true }); };
  }, [playing, run]);
  if (!playing) return null;
  return <div className="opening" key={run} role="dialog" aria-modal="true" aria-label="虾扯蛋开屏动画">
    <div className="opening-camera" aria-hidden="true">
      <div className="opening-space">
        {Array.from({ length: 70 }, (_, i) => <i key={i} style={{ left: `${(i * 61.3) % 100}%`, top: `${(i * 31.7) % 100}%`, opacity: .2 + (i % 5) * .13, width: i % 7 === 0 ? 2 : 1, height: i % 7 === 0 ? 2 : 1 }} />)}
        <Planet />
      </div>
      <Cabin />
      <div className="opening-vignette" />
    </div>
    <div className="opening-arrival" aria-hidden="true"><img src={appIcon} alt="" /><span>虾扯蛋</span></div>
    <button ref={skipButton} type="button" className="opening-skip" onClick={skip}>跳过</button>
  </div>;
}

import React, { useId } from 'react';
import './ArcadeDecor.css';

const uid = value => value.replace(/:/g, '');
const ellipse = (cx, cy, rx, ry, points = 120, waves = 12, depth = .08) => Array.from({ length: points + 1 }, (_, i) => {
  const angle = i / points * Math.PI * 2, modulation = 1 + Math.sin(angle * waves) * depth;
  return `${i ? 'L' : 'M'}${(cx + Math.cos(angle) * rx * modulation).toFixed(2)},${(cy + Math.sin(angle) * ry * modulation).toFixed(2)}`;
}).join(' ') + 'Z';

function Bolt({ x, y, radius = 2.5 }) {
  return <g transform={`translate(${x} ${y})`}><circle r={radius} fill="#e9e6de" stroke="#a7a394" strokeWidth=".7" /><path d={`M${-radius * .5} ${radius * .25}L${radius * .5} ${-radius * .25}`} stroke="#8e8b7e" strokeWidth=".7" /></g>;
}

function Bearing({ x, y, radius = 14, fill }) {
  return <g transform={`translate(${x} ${y})`}><circle r={radius} fill={fill} stroke="#b4b1a5" strokeWidth="1.2" /><circle r={radius - 3} fill="none" stroke="#fbfaf5" strokeWidth="1.2" /><circle r={radius * .47} fill="#ece9df" stroke="#b2ad9a" strokeWidth=".8" /><circle r={radius * .14} fill="#aaa58f" />{Array.from({ length: 6 }, (_, i) => <Bolt key={i} x={Math.cos(i * Math.PI / 3) * radius * .72} y={Math.sin(i * Math.PI / 3) * radius * .72} radius={1.3} />)}</g>;
}

export function DealerArm({ phase = 'waiting', handId = '', className = '' }) {
  const id = `dealer-${uid(useId())}`;
  const active = ['preflop', 'flop', 'turn', 'river'].includes(phase);
  return <div className={`poker-dealer-machine ${className}`} aria-hidden="true" data-active={active ? 'true' : 'false'}>
    <svg viewBox="0 0 300 170" fill="none">
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fffefa" /><stop offset=".46" stopColor="#f3f1e9" /><stop offset=".52" stopColor="#dbd8ce" /><stop offset="1" stopColor="#eeece5" /></linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#d6d1c3" /><stop offset=".45" stopColor="#fffdf5" /><stop offset="1" stopColor="#b6b1a0" /></linearGradient>
        <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f4dfa2" /><stop offset=".46" stopColor="#b99a4d" /><stop offset=".75" stopColor="#edce87" /><stop offset="1" stopColor="#8f7a48" /></linearGradient>
        <filter id={`${id}-shadow`} x="-20%" y="-40%" width="140%" height="200%"><feDropShadow dx="0" dy="5" stdDeviation="3.5" floodColor="#524734" floodOpacity=".19" /></filter>
      </defs>
      <g filter={`url(#${id}-shadow)`}>
        <rect x="21" y="101" width="253" height="53" rx="9" fill={`url(#${id}-edge)`} stroke="#bfb9a9" />
        <rect x="25" y="97" width="245" height="51" rx="7" fill={`url(#${id}-metal)`} stroke="#c6c1b3" />
        <rect x="31" y="103" width="233" height="38" rx="4" fill="#f6f4ec" stroke="#dad5c7" />
        <path d="M37 144H257M30 109H265" stroke="#fffef9" />
        {[35, 80, 150, 222, 260].map(x => <Bolt key={x} x={x} y={144} radius={1.8} />)}
        <rect x="39" y="91" width="56" height="35" rx="4" fill={`url(#${id}-metal)`} stroke="#c2bdad" />
        {[98, 102, 106, 110].map(y => <path key={y} d={`M44 ${y}H87`} stroke="#c4bca7" strokeWidth="1" />)}
        <rect x="40" y="85" width="54" height="19" rx="3" fill="#faf7ed" stroke="#c7c0ad" />
        <path d="M45 89H88M45 93H88M45 97H88" stroke="#e5d8b4" />
        <path d="M110 116H151M110 121H151M110 126H151" stroke="#c6c0ae" strokeWidth="1.3" />
        <rect x="175" y="113" width="75" height="21" rx="3" fill="#ece9de" stroke="#d4cebe" />
        {[182, 187, 192, 197, 202, 207, 212, 217, 222, 227, 232, 237, 242].map(x => <path key={x} d={`M${x} 118V129`} stroke="#bab5a6" strokeWidth=".8" />)}
        <circle cx="106" cy="133" r="3.3" fill={active ? '#7eab85' : '#c3a967'} stroke="#b1a888" strokeWidth="1" />
        <g key={`${handId}-${phase}`} className="dealer-linkage">
          <path d="M161 113 237 29" stroke="#9a9688" strokeWidth="16" strokeLinecap="round" />
          <path d="M161 110 237 26" stroke={`url(#${id}-metal)`} strokeWidth="13" strokeLinecap="round" />
          <path d="M159 107 233 26" stroke="#fffef8" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M165 104 231 32" stroke="#c1ba9f" strokeWidth="1" strokeLinecap="round" />
          <path d="M237 29 92 84" stroke="#a7a293" strokeWidth="15" strokeLinecap="round" />
          <path d="M237 26 92 81" stroke={`url(#${id}-metal)`} strokeWidth="12" strokeLinecap="round" />
          <path d="M237 22 91 77" stroke="#fffffa" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M108 110 179 37" stroke="#aaa496" strokeWidth="8" strokeLinecap="round" />
          <path d="M108 108 179 35" stroke="#f5f3ec" strokeWidth="6" strokeLinecap="round" />
          <path d="M179 35 241 89" stroke="#aaa496" strokeWidth="7" strokeLinecap="round" />
          <path d="M179 33 241 87" stroke="#f5f3ec" strokeWidth="5" strokeLinecap="round" />
          <path d="M99 85 241 89" stroke="#b0a47a" strokeWidth="3.4" strokeLinecap="round" />
          <path d="M99 83 241 87" stroke="#f5e7bc" strokeWidth="1.6" strokeLinecap="round" />
          <Bearing x={161} y={110} fill={`url(#${id}-metal)`} radius={17} />
          <g className="dealer-gear"><Bearing x={237} y={26} fill={`url(#${id}-metal)`} radius={19} /><circle cx="237" cy="26" r="21" stroke="#b9ae8c" strokeWidth="2" strokeDasharray="2 5" /></g>
          <Bearing x={179} y={34} fill={`url(#${id}-metal)`} radius={10} />
          <Bearing x={241} y={88} fill={`url(#${id}-metal)`} radius={8} />
          <Bearing x={109} y={108} fill={`url(#${id}-metal)`} radius={8} />
          <g className="dealer-gripper">
            <rect x="66" y="64" width="41" height="36" rx="7" fill={`url(#${id}-edge)`} stroke="#b5ae9c" transform="rotate(-20 86 82)" />
            <path d="M71 72 98 63M74 78 100 69M76 84 103 75" stroke="#bfb9a9" strokeWidth="1.2" />
            <path d="M72 91 80 103 99 96 98 82" fill="#eeece2" stroke="#bbb39d" />
            <circle cx="88" cy="83" r="5" fill={`url(#${id}-brass)`} stroke="#b49b5f" />
            <Bolt x={88} y={83} radius={2} />
          </g>
          <Bolt x={201} y={67} radius={2.2} /><Bolt x={206} y={37} radius={2} />
        </g>
      </g>
    </svg>
  </div>;
}

export function TableEngraving({ className = '' }) {
  const id = `table-grain-${uid(useId())}`;
  return <svg className={`poker-table-engraving ${className}`} viewBox="0 0 1000 650" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <pattern id={`${id}-crackle`} width="106" height="88" patternUnits="userSpaceOnUse">
        <path d="M0 9 13 13 19 4 33 0M13 13 10 27 0 31M10 27 23 31 29 21 19 4M29 21 45 18 47 5 40 0M45 18 54 30 70 23 69 8 57 0M54 30 47 44 57 55 72 48 70 23M72 48 88 54 99 41 91 27 78 25 69 8M91 27 106 25M99 41 106 44M88 54 89 70 106 78M89 70 75 76 67 88M75 76 62 69 57 55M62 69 48 75 44 88M48 75 34 63 31 46 47 44M31 46 23 31M34 63 19 68 13 55 16 44 4 38 0 40M19 68 17 82 29 88M17 82 0 79M13 55 0 56M106 4 94 9 83 3 81 0M94 9 91 27M4 38 10 27" fill="none" stroke="#9d937a" strokeWidth=".55" opacity=".25" />
        <path d="M33 0 37 7 33 12 39 19M57 55 50 60 53 66M10 27 7 19M88 54 96 57 98 65M75 76 78 83M31 46 24 49 23 57" fill="none" stroke="#c0ac75" strokeWidth=".4" opacity=".3" />
      </pattern>
      <radialGradient id={`${id}-fade`}><stop stopColor="#f8f6ee" stopOpacity=".82" /><stop offset=".6" stopColor="#f8f6ee" stopOpacity=".3" /><stop offset="1" stopColor="#f8f6ee" stopOpacity="0" /></radialGradient>
    </defs>
    <rect x="0" y="0" width="1000" height="650" rx="85" fill={`url(#${id}-crackle)`} />
    <rect x="0" y="0" width="1000" height="650" rx="85" fill={`url(#${id}-fade)`} />
    <g stroke="#b79b5e" fill="none" opacity=".14" strokeWidth=".65">
      {[0, 1, 2].map(i => <path key={i} d={ellipse(500, 325, 263 + i * 3, 166 + i * 2, 160, 32, .035)} />)}
      <path d="M95 70Q500 185 905 70M95 580Q500 465 905 580M80 85Q250 325 80 565M920 85Q750 325 920 565" />
      <path d="M70 80 930 570M930 80 70 570" opacity=".45" />
    </g>
  </svg>;
}

export function CardOrnament({ className = '' }) {
  const id = `card-back-${uid(useId())}`;
  return <svg className={`poker-card-ornament ${className}`} viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e7c16b" /><stop offset=".48" stopColor="#d5a64d" /><stop offset="1" stopColor="#e1b95f" /></linearGradient>
      <pattern id={`${id}-weave`} width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 0 5 5M5 0 0 5" stroke="#fff7d7" strokeWidth=".35" opacity=".42" /></pattern>
    </defs>
    <rect x="1" y="1" width="98" height="138" rx="6" fill="#faf6e7" stroke="#a7956d" strokeWidth=".8" />
    <rect x="4" y="4" width="92" height="132" rx="4" fill={`url(#${id}-gold)`} />
    <rect x="5" y="5" width="90" height="130" rx="3" fill={`url(#${id}-weave)`} />
    <rect x="7.5" y="7.5" width="85" height="125" rx="2" fill="none" stroke="#fff3c5" strokeWidth=".7" />
    <rect x="11" y="11" width="78" height="118" rx="2" fill="none" stroke="#fff7d7" strokeWidth=".6" strokeDasharray="1.4 1.4" />
    <rect x="13" y="13" width="74" height="114" rx="2" fill="none" stroke="#fff3c5" strokeWidth=".4" />
    <g stroke="#fff6d6" strokeWidth=".55" fill="none">
      {[0, 1, 2, 3].map(i => <path key={i} d={ellipse(50, 70, 22 + i * 2, 28 + i * 2.5, 160, 18, .12)} />)}
      <path d={ellipse(50, 70, 14, 20, 120, 8, .19)} />
      <path d="M50 43 65 70 50 97 35 70Z M50 50 60 70 50 90 40 70Z" />
      <path d="M50 17V36M50 104V123M45 22 50 17 55 22M45 118 50 123 55 118" />
    </g>
    {[[20, 20], [80, 20], [20, 120], [80, 120]].map(([x, y]) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`} stroke="#fff6d6" strokeWidth=".5" fill="none"><path d={ellipse(0, 0, 4.3, 4.3, 48, 8, .2)} /><circle r="2.2" /><circle r=".7" fill="#fff6d6" /></g>)}
  </svg>;
}

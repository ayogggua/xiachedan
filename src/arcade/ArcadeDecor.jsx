import React, { useId } from 'react';
import './ArcadeDecor.css';

const uid = value => value.replace(/:/g, '');

const rosette = (cx, cy, rx, ry, points = 128, waves = 16, depth = 0.09) =>
  Array.from({ length: points + 1 }, (_, i) => {
    const angle = (i / points) * Math.PI * 2;
    const mod = 1 + Math.sin(angle * waves) * depth;
    return `${i ? 'L' : 'M'}${(cx + Math.cos(angle) * rx * mod).toFixed(2)},${(cy + Math.sin(angle) * ry * mod).toFixed(2)}`;
  }).join(' ') + 'Z';

function BrassScrew({ x, y, r = 2.1 }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill="#b9964f" stroke="#533f1b" strokeWidth="0.6" />
      <circle r={r * 0.68} fill="#dfc07b" />
      <path d={`M${-r * 0.55} ${r * 0.28}L${r * 0.55} ${-r * 0.28}`} stroke="#4a3717" strokeWidth="0.65" strokeLinecap="round" />
    </g>
  );
}

/**
 * 写实胡桃木 + 拉丝黄铜发牌靴（保留 DealerArm 导出名及 .poker-dealer-machine / data-active / data-dealing 钩子）
 */
export function DealerArm({ phase = 'waiting', handId = '', className = '' }) {
  const id = `shoe-${uid(useId())}`;
  const active = ['preflop', 'flop', 'turn', 'river'].includes(phase);
  return (
    <div className={`poker-dealer-machine ${className}`} aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <svg viewBox="0 0 184 98" fill="none">
        <defs>
          <linearGradient id={`${id}-walnut`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#563f2c" />
            <stop offset="42%" stopColor="#38281c" />
            <stop offset="100%" stopColor="#1e150f" />
          </linearGradient>
          <linearGradient id={`${id}-walnut-top`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#654b35" />
            <stop offset="55%" stopColor="#3e2d20" />
            <stop offset="100%" stopColor="#261b13" />
          </linearGradient>
          <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f5e2a9" />
            <stop offset="35%" stopColor="#cfa95a" />
            <stop offset="70%" stopColor="#8f6e33" />
            <stop offset="100%" stopColor="#e2c37d" />
          </linearGradient>
          <linearGradient id={`${id}-brass-v`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0d899" />
            <stop offset="50%" stopColor="#b89147" />
            <stop offset="100%" stopColor="#775b28" />
          </linearGradient>
          <linearGradient id={`${id}-slot`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#091511" />
            <stop offset="100%" stopColor="#122720" />
          </linearGradient>
          <linearGradient id={`${id}-card-edge`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fcf8ee" />
            <stop offset="50%" stopColor="#e8e0cc" />
            <stop offset="100%" stopColor="#cfc4aa" />
          </linearGradient>
          <radialGradient id={`${id}-mouth-glow`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.88" />
            <stop offset="55%" stopColor="#e2c37d" stopOpacity="0.48" />
            <stop offset="100%" stopColor="#e2c37d" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}-drop`} x="-14%" y="-20%" width="132%" height="160%">
            <feDropShadow dx="0" dy="6" stdDeviation="4.5" floodColor="#040b08" floodOpacity="0.72" />
          </filter>
        </defs>

        <g filter={`url(#${id}-drop)`}>
          {/* 底座毛毡垫与下缘黄铜护边 */}
          <path d="M12 68 L138 68 L168 82 L148 89 L18 82 Z" fill="#130e0a" stroke="#765a2a" strokeWidth="0.9" />

          {/* 胡桃木发牌靴主体外壳 */}
          <path
            d="M14 26 L128 20 L166 56 L154 78 L18 76 Q11 75 11 68 L11 32 Q11 26 14 26 Z"
            fill={`url(#${id}-walnut)`}
            stroke={`url(#${id}-brass)`}
            strokeWidth="1.25"
          />

          {/* 顶部斜面胡桃木盖板 */}
          <path
            d="M16 24 L126 18 L156 46 L142 54 L18 54 Z"
            fill={`url(#${id}-walnut-top)`}
            stroke="#8a6b35"
            strokeWidth="0.85"
          />

          {/* 精致木纹与结构折线 */}
          <path d="M22 30 H120 M24 37 H128 M24 44 H134 M20 50 H138" stroke="#785b42" strokeWidth="0.55" strokeOpacity="0.45" />
          <path d="M16 54 H142 L156 46" stroke="#e4c680" strokeWidth="0.85" strokeOpacity="0.68" />
          <path d="M18 74 H148" stroke="#8f6e33" strokeWidth="0.55" strokeOpacity="0.45" />

          {/* 侧边透明观察窗与叠层象牙白牌垛 */}
          <path d="M26 57 L122 57 L128 71 L26 71 Z" fill={`url(#${id}-slot)`} stroke="#a68342" strokeWidth="0.9" />
          {/* 牌垛细节线 */}
          <rect x="46" y="59.5" width="70" height="9" rx="1" fill={`url(#${id}-card-edge)`} />
          {[52, 58, 64, 70, 76, 82, 88, 94, 100, 106, 112].map(x => (
            <line key={x} x1={x} y1="59.5" x2={x - 1.5} y2="68.5" stroke="#8e8268" strokeWidth="0.55" strokeOpacity="0.65" />
          ))}

          {/* 内部黄铜重锤推牌滑块 */}
          <g key={`${handId}-${phase}`} className="shoe-roller">
            <rect x="31" y="58.2" width="15" height="11.6" rx="2" fill={`url(#${id}-brass-v)`} stroke="#4e3a18" strokeWidth="0.7" />
            <line x1="35" y1="60.5" x2="35" y2="67.5" stroke="#5b441d" strokeWidth="0.75" />
            <line x1="39" y1="60.5" x2="39" y2="67.5" stroke="#5b441d" strokeWidth="0.75" />
            <circle cx="43" cy="64" r="2.2" fill="#f5e3b0" stroke="#6e5324" strokeWidth="0.6" />
          </g>

          {/* 顶面铭牌与拉丝黄铜导轨 */}
          <rect x="34" y="27" width="66" height="19" rx="2.5" fill="#15201c" stroke={`url(#${id}-brass)`} strokeWidth="0.9" />
          <rect x="36.5" y="29.5" width="61" height="14" rx="1.5" fill="none" stroke="#cfa95a" strokeWidth="0.45" strokeOpacity="0.6" />
          <text
            x="67"
            y="39"
            textAnchor="middle"
            fill="#e6ca86"
            fontSize="6.4"
            fontWeight="700"
            letterSpacing="1.8"
            fontFamily="ui-monospace, SF Mono, Menlo, monospace"
          >
            CLUB SHOE
          </text>

          {/* 发牌状态光学指示灯 */}
          <circle
            className="shoe-led"
            cx="114"
            cy="36.5"
            r="3.2"
            fill={active ? '#34d399' : '#8b7344'}
            stroke="#e4c680"
            strokeWidth="0.9"
          />
          <circle cx="113.2" cy="35.6" r="1" fill="#ffffff" fillOpacity="0.75" />

          {/* 精密黄铜螺钉 */}
          <BrassScrew x={22} y={30} r={1.8} />
          <BrassScrew x={22} y={48} r={1.8} />
          <BrassScrew x={123} y={24} r={1.8} />
          <BrassScrew x={135} y={48} r={1.8} />

          {/* 前段拉丝黄铜压牌出牌口 */}
          <path
            d="M135 50 L161 45 L172 60 L153 77 L133 74 Z"
            fill={`url(#${id}-brass-v)`}
            stroke="#f5e1a8"
            strokeWidth="0.85"
          />
          <path d="M141 55 L161 52 L166 60 L150 72 L138 70 Z" fill="#0a1612" stroke="#5b451e" strokeWidth="0.8" />

          {/* 出牌口微光与滑出牌舌 */}
          <ellipse className="shoe-mouth-glow" cx="156" cy="64" rx="15" ry="9" fill={`url(#${id}-mouth-glow)`} />
          <g className="shoe-card-slip">
            <path
              d="M146 60 L165 57 L173 68 L153 72 Z"
              fill="#113d2e"
              stroke="#f2ead4"
              strokeWidth="1.2"
            />
            <path d="M150 62 L163 60 L168 67 L155 69.5 Z" fill="none" stroke="#e4c680" strokeWidth="0.55" />
          </g>
        </g>
      </svg>
    </div>
  );
}

/**
 * 写实祖母绿绒面精工黄铜线稿（双层椭圆下注轨 + 精密直段刻度 + 四角星标 + 公共牌微框 + 花色线标）
 */
export function TableEngraving({ className = '' }) {
  const id = `felt-engraving-${uid(useId())}`;
  const topTicks = [270, 316, 362, 408, 454, 546, 592, 638, 684, 730];
  return (
    <svg className={`poker-table-engraving ${className}`} viewBox="0 0 1000 580" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#eed595" stopOpacity="0.56" />
          <stop offset="50%" stopColor="#caa558" stopOpacity="0.36" />
          <stop offset="100%" stopColor="#eed595" stopOpacity="0.54" />
        </linearGradient>
        <linearGradient id={`${id}-gold-soft`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8cb86" stopOpacity="0.3" />
          <stop offset="50%" stopColor="#b89249" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#e8cb86" stopOpacity="0.28" />
        </linearGradient>
        <radialGradient id={`${id}-spotlight`} cx="50%" cy="44%" r="54%">
          <stop offset="0%" stopColor="#359970" stopOpacity="0.2" />
          <stop offset="55%" stopColor="#154734" stopOpacity="0" />
          <stop offset="100%" stopColor="#061710" stopOpacity="0.48" />
        </radialGradient>
      </defs>

      {/* 顶灯聚光柔雾 */}
      <rect x="0" y="0" width="1000" height="580" fill={`url(#${id}-spotlight)`} />

      {/* 外圈黄铜主轨（精工双线 + 微虚线缝轨） */}
      <rect x="22" y="22" width="956" height="536" rx="226" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="1.35" />
      <rect x="31" y="31" width="938" height="518" rx="217" fill="none" stroke="#dcc07a" strokeWidth="0.68" strokeOpacity="0.32" strokeDasharray="3 5" />

      {/* 内圈下注界线轨（经典俱乐部 Betting Line 双线） */}
      <rect x="64" y="62" width="872" height="456" rx="188" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="1.15" />
      <rect x="70" y="68" width="860" height="444" rx="182" fill="none" stroke={`url(#${id}-gold-soft)`} strokeWidth="0.65" />

      {/* 顶底直段精密标尺刻度线（增强线稿写实精度） */}
      <g stroke="#e0c27d" strokeOpacity="0.24" strokeWidth="0.8">
        {topTicks.map(x => (
          <React.Fragment key={x}>
            <line x1={x} y1="24" x2={x} y2="31" />
            <line x1={x} y1="549" x2={x} y2="556" />
          </React.Fragment>
        ))}
      </g>

      {/* 12 / 3 / 6 / 9 点精密罗盘刻度与棱形星标 */}
      <g stroke="#e2c57f" strokeOpacity="0.48" strokeWidth="1" fill="none">
        {/* 12 点 */}
        <line x1="500" y1="15" x2="500" y2="54" />
        <line x1="484" y1="22" x2="484" y2="33" strokeOpacity="0.34" />
        <line x1="516" y1="22" x2="516" y2="33" strokeOpacity="0.34" />
        <path d="M500 56 L505 62 L500 68 L495 62 Z" fill="#e2c57f" fillOpacity="0.38" />

        {/* 6 点 */}
        <line x1="500" y1="526" x2="500" y2="565" />
        <line x1="484" y1="547" x2="484" y2="558" strokeOpacity="0.34" />
        <line x1="516" y1="547" x2="516" y2="558" strokeOpacity="0.34" />
        <path d="M500 512 L505 518 L500 524 L495 518 Z" fill="#e2c57f" fillOpacity="0.38" />

        {/* 9 点 */}
        <line x1="15" y1="290" x2="56" y2="290" />
        <line x1="22" y1="274" x2="33" y2="274" strokeOpacity="0.34" />
        <line x1="22" y1="306" x2="33" y2="306" strokeOpacity="0.34" />
        <path d="M58 290 L64 285 L70 290 L64 295 Z" fill="#e2c57f" fillOpacity="0.38" />

        {/* 3 点 */}
        <line x1="944" y1="290" x2="985" y2="290" />
        <line x1="967" y1="274" x2="978" y2="274" strokeOpacity="0.34" />
        <line x1="967" y1="306" x2="978" y2="306" strokeOpacity="0.34" />
        <path d="M930 290 L936 285 L942 290 L936 295 Z" fill="#e2c57f" fillOpacity="0.38" />
      </g>

      {/* 四角俱乐部菱形星标与细线导角 */}
      {[
        [152, 92, 1, 1],
        [848, 92, -1, 1],
        [152, 488, 1, -1],
        [848, 488, -1, -1],
      ].map(([x, y, sx, sy]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y}) scale(${sx} ${sy})`} stroke="#e0c27d" strokeOpacity="0.4" strokeWidth="0.9" fill="none">
          <path d="M0 -8 L6 0 L0 8 L-6 0 Z" />
          <circle r="1.7" fill="#e0c27d" fillOpacity="0.48" stroke="none" />
          <path d="M12 0 H42 M0 12 V28" strokeOpacity="0.3" />
          <circle cx="46" cy="0" r="1.1" fill="#e0c27d" fillOpacity="0.34" stroke="none" />
        </g>
      ))}

      {/* 左右弧段精工四花色线描微标 */}
      <g stroke="#e2c37d" strokeOpacity="0.28" strokeWidth="0.95" fill="none">
        <g transform="translate(106 250) scale(0.72)">
          <path d="M12 2C9 6 3 9 3 14a5 5 0 0 0 8 4l-2 4h6l-2-4a5 5 0 0 0 8-4c0-5-6-8-9-12Z" />
        </g>
        <g transform="translate(106 312) scale(0.72)">
          <path d="M12 2 21 12 12 22 3 12Z" />
        </g>
        <g transform="translate(876 250) scale(0.72)">
          <path d="M12 21 3 12C-2 5 8-1 12 6 16-1 26 5 21 12Z" />
        </g>
        <g transform="translate(876 312) scale(0.72)">
          <path d="M10 16a4.5 4.5 0 1 1-3-7.5 4.5 4.5 0 1 1 10 0 4.5 4.5 0 1 1-3 7.5l2 5H8Z" />
        </g>
      </g>

      {/* 中央公共牌台精工定位细框 */}
      <g stroke="#e2c47d" strokeOpacity="0.24" strokeWidth="0.9" fill="none">
        <rect x="260" y="176" width="480" height="228" rx="18" strokeDasharray="2 4" strokeOpacity="0.16" />
        <path d="M260 198 V176 H284" strokeOpacity="0.44" strokeWidth="1.05" />
        <path d="M740 198 V176 H716" strokeOpacity="0.44" strokeWidth="1.05" />
        <path d="M260 382 V404 H284" strokeOpacity="0.44" strokeWidth="1.05" />
        <path d="M740 382 V404 H716" strokeOpacity="0.44" strokeWidth="1.05" />
        <line x1="202" y1="290" x2="248" y2="290" strokeOpacity="0.26" />
        <line x1="752" y1="290" x2="798" y2="290" strokeOpacity="0.26" />
        <circle cx="252" cy="290" r="1.8" fill="#e2c47d" fillOpacity="0.38" stroke="none" />
        <circle cx="748" cy="290" r="1.8" fill="#e2c47d" fillOpacity="0.38" stroke="none" />
      </g>
    </svg>
  );
}

/**
 * 写实墨绿 × 复古金精工玑镂牌背
 */
export function CardOrnament({ className = '' }) {
  const id = `card-back-${uid(useId())}`;
  return (
    <svg className={`poker-card-ornament ${className}`} viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#18523d" />
          <stop offset="52%" stopColor="#0f3628" />
          <stop offset="100%" stopColor="#09231a" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f4dea6" />
          <stop offset="50%" stopColor="#d1ab59" />
          <stop offset="100%" stopColor="#e7ca82" />
        </linearGradient>
        <pattern id={`${id}-guilloche`} width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 4 L4 0 L8 4 L4 8 Z" fill="none" stroke="#e6c880" strokeWidth="0.35" strokeOpacity="0.26" />
          <circle cx="4" cy="4" r="0.55" fill="#e6c880" fillOpacity="0.2" />
        </pattern>
      </defs>

      {/* 象牙白纸边 */}
      <rect x="0.8" y="0.8" width="98.4" height="138.4" rx="6" fill="#f7f2e4" stroke="#b39a68" strokeWidth="0.8" />
      {/* 墨绿主底 */}
      <rect x="4.2" y="4.2" width="91.6" height="131.6" rx="4" fill={`url(#${id}-bg)`} />
      {/* 菱格细密玑镂底纹 */}
      <rect x="6" y="6" width="88" height="128" rx="3" fill={`url(#${id}-guilloche)`} />

      {/* 三层精工金线花框 */}
      <rect x="7.5" y="7.5" width="85" height="125" rx="2.4" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="0.95" />
      <rect x="10.8" y="10.8" width="78.4" height="118.4" rx="1.8" fill="none" stroke="#e8ca85" strokeWidth="0.55" strokeOpacity="0.74" strokeDasharray="1.8 1.5" />
      <rect x="13.5" y="13.5" width="73" height="113" rx="1.4" fill="none" stroke="#d5b265" strokeWidth="0.45" strokeOpacity="0.65" />

      {/* 四角折角星花 */}
      {[
        [19.5, 19.5],
        [80.5, 19.5],
        [19.5, 120.5],
        [80.5, 120.5],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`} stroke="#edd394" strokeWidth="0.55" fill="none">
          <path d="M0 -4.8 L4.8 0 L0 4.8 L-4.8 0 Z" fill="#123d2d" />
          <circle r="1.5" fill="#edd394" stroke="none" />
        </g>
      ))}

      {/* 中心玑镂花徽与对称矛尖 */}
      <g stroke={`url(#${id}-gold)`} strokeWidth="0.62" fill="none">
        {[0, 1, 2].map(i => (
          <path key={i} d={rosette(50, 70, 19 + i * 3.1, 25 + i * 3.6, 128, 16, 0.1)} strokeOpacity={0.86 - i * 0.16} />
        ))}
        <path d={rosette(50, 70, 12, 16.5, 96, 8, 0.16)} fill="#0d2e22" fillOpacity="0.9" />
        <path d="M50 48 L63 70 L50 92 L37 70 Z" strokeWidth="0.85" />
        <path d="M50 56 L58 70 L50 84 L42 70 Z" fill="#174a37" strokeWidth="0.75" />
        <path d="M50 63.5 L54 70 L50 76.5 L46 70 Z" fill="#e7ca82" stroke="none" />
        <path d="M50 18 V41 M50 99 V122" strokeWidth="0.75" />
        <path d="M45 25 L50 18 L55 25 M45 115 L50 122 L55 115" strokeWidth="0.7" />
        <path d="M18 70 H29 M71 70 H82" strokeWidth="0.6" strokeOpacity="0.78" />
      </g>
    </svg>
  );
}

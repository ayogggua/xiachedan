import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { askRoad, buildBigRoad, computeRoadmaps } from '../../shared/baccaratRoads';

const ROWS = 6;

function AskIndicator({ pred }) {
  return (
    <span className="ask-icons" aria-hidden="true">
      <i className={`ask-bigeye ${pred.bigEye || 'none'}`} />
      <i className={`ask-small ${pred.small || 'none'}`} />
      <i className={`ask-cockroach ${pred.cockroach || 'none'}`} />
    </span>
  );
}

function RoadGrid({ cols, minCols, cellSize, className = '', children }) {
  const scrollRef = useRef(null);
  const totalCols = Math.max(minCols, cols + 1);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [cols]);
  return (
    <div ref={scrollRef} className={`road-scroll ${className}`}>
      <div
        className="road-grid"
        style={{
          '--road-cols': totalCols,
          '--road-rows': ROWS,
          '--cell-size': `var(--road-cell-override, ${cellSize}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const MiniBigRoad = memo(function MiniBigRoad({ history = [], minCols = 14 }) {
  const big = useMemo(() => buildBigRoad(history, ROWS), [history]);
  const visibleCols = Math.max(minCols, big.cols);
  const colOffset = Math.max(0, visibleCols - minCols);
  return (
    <div className="mini-big-road" aria-hidden="true">
      <div className="road-grid" style={{ '--road-cols': minCols, '--road-rows': ROWS, '--cell-size': '11px' }}>
        {big.cells.map((cell, idx) => {
          const c = cell.col - colOffset;
          if (c < 0 || c >= minCols) return null;
          return (
            <span
              key={idx}
              className={`road-cell big-cell side-${cell.side}`}
              style={{ gridColumn: c + 1, gridRow: cell.row + 1 }}
            >
              <i className="big-ring" />
              {cell.ties > 0 && <em className="tie-slash" />}
              {cell.bp && <b className="pair-dot is-banker" />}
              {cell.pp && <b className="pair-dot is-player" />}
            </span>
          );
        })}
      </div>
    </div>
  );
});

const BaccaratRoadmap = memo(function BaccaratRoadmap({
  history = [],
  mode = 'no-commission',
  compact = false,
  onExpand,
}) {
  const [askSide, setAskSide] = useState(null); // null | 'banker' | 'player'
  const [mobileTab, setMobileTab] = useState('big'); // big | bead | derived

  const displayHistory = useMemo(
    () => (askSide ? [...history, { o: askSide, ghost: true }] : history),
    [history, askSide],
  );
  const roads = useMemo(() => computeRoadmaps(displayHistory, ROWS), [displayHistory]);
  const realStats = useMemo(() => computeRoadmaps(history, ROWS).stats, [history]);
  const askBanker = useMemo(() => askRoad(history, 'banker'), [history]);
  const askPlayer = useMemo(() => askRoad(history, 'player'), [history]);

  const toggleAsk = side => setAskSide(prev => (prev === side ? null : side));

  const renderBead = (minCols = 9, cellSize = 22) => (
    <RoadGrid cols={roads.bead.cols} minCols={minCols} cellSize={cellSize} className="road-bead">
      {roads.bead.cells.map((cell, idx) => {
        const e = cell.entry;
        const label = e.o === 'banker' ? '庄' : e.o === 'player' ? '闲' : '和';
        return (
          <span
            key={idx}
            className={`road-cell bead-cell side-${e.o} ${e.ghost ? 'is-ghost' : ''}`}
            style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }}
            title={e.ghost ? `问路预览：${label}` : `第 ${e.r} 局 · 闲 ${e.pPts} 点 / 庄 ${e.bPts} 点`}
          >
            <i className="bead-disc">{label}</i>
            {e.bp && <b className="pair-dot is-banker" />}
            {e.pp && <b className="pair-dot is-player" />}
            {e.l6 > 0 && <em className="lucky6-mark">6</em>}
          </span>
        );
      })}
    </RoadGrid>
  );

  const renderBig = (minCols = 22, cellSize = 18) => (
    <RoadGrid cols={roads.big.cols} minCols={minCols} cellSize={cellSize} className="road-big">
      {roads.big.cells.map((cell, idx) => (
        <span
          key={idx}
          className={`road-cell big-cell side-${cell.side} ${cell.ghost ? 'is-ghost' : ''}`}
          style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }}
        >
          <i className="big-ring">{cell.l6 > 0 ? '6' : ''}</i>
          {cell.ties > 0 && <em className="tie-slash">{cell.ties > 1 ? cell.ties : ''}</em>}
          {cell.bp && <b className="pair-dot is-banker" />}
          {cell.pp && <b className="pair-dot is-player" />}
        </span>
      ))}
    </RoadGrid>
  );

  const renderDerived = (road, kind, minCols = 12, cellSize = 12) => (
    <RoadGrid cols={road.cols} minCols={minCols} cellSize={cellSize} className={`road-derived road-${kind}`}>
      {road.cells.map((cell, idx) => (
        <span
          key={idx}
          className={`road-cell derived-cell kind-${kind} color-${cell.color} ${cell.ghost ? 'is-ghost' : ''}`}
          style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }}
        >
          <i />
        </span>
      ))}
    </RoadGrid>
  );

  return (
    <section className={`baccarat-roadmap ${compact ? 'is-compact' : ''}`} aria-label="澳门路单">
      <div className="roadmap-topbar">
        <div className="roadmap-stats">
          <span className="stat-pill">局<b>{realStats.total}</b></span>
          <span className="stat-pill is-banker">庄<b>{realStats.banker}</b></span>
          <span className="stat-pill is-player">闲<b>{realStats.player}</b></span>
          <span className="stat-pill is-tie">和<b>{realStats.tie}</b></span>
          <span className="stat-pill is-sub">庄对<b>{realStats.bankerPair}</b></span>
          <span className="stat-pill is-sub">闲对<b>{realStats.playerPair}</b></span>
          {mode === 'no-commission' && <span className="stat-pill is-gold">幸运6<b>{realStats.lucky6}</b></span>}
        </div>
        <div className="roadmap-ask-bar">
          <button
            type="button"
            className={`ask-btn is-banker ${askSide === 'banker' ? 'is-active' : ''}`}
            onClick={() => toggleAsk('banker')}
            aria-pressed={askSide === 'banker'}
          >
            <span>庄问路</span>
            <AskIndicator pred={askBanker} />
          </button>
          <button
            type="button"
            className={`ask-btn is-player ${askSide === 'player' ? 'is-active' : ''}`}
            onClick={() => toggleAsk('player')}
            aria-pressed={askSide === 'player'}
          >
            <span>闲问路</span>
            <AskIndicator pred={askPlayer} />
          </button>
          {compact && onExpand && (
            <button type="button" className="roadmap-expand-btn" onClick={onExpand} aria-label="展开完整五路单">
              <Maximize2 size={14} />
            </button>
          )}
        </div>
      </div>

      {compact ? (
        <div className="roadmap-compact-body">
          <div className="roadmap-mobile-tabs" role="tablist">
            {[
              ['big', '大路'],
              ['bead', '珠盘路'],
              ['derived', '下三路'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mobileTab === id}
                className={mobileTab === id ? 'active' : ''}
                onClick={() => setMobileTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {mobileTab === 'big' && renderBig(18, 16)}
          {mobileTab === 'bead' && renderBead(13, 20)}
          {mobileTab === 'derived' && (
            <div className="roadmap-derived-strip">
              <div className="derived-box"><span>大眼仔</span>{renderDerived(roads.bigEye, 'bigeye', 10, 11)}</div>
              <div className="derived-box"><span>小路</span>{renderDerived(roads.small, 'small', 10, 11)}</div>
              <div className="derived-box"><span>曱甴路</span>{renderDerived(roads.cockroach, 'cockroach', 10, 11)}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="roadmap-full-board">
          <div className="roadmap-pane roadmap-pane-bead">
            <span className="road-pane-label">珠盘路</span>
            {renderBead(11, 20)}
          </div>
          <div className="roadmap-right-stack">
            <div className="roadmap-pane roadmap-pane-big">
              <span className="road-pane-label">大路</span>
              {renderBig(48, 15)}
            </div>
            <div className="roadmap-derived-strip">
              <div className="derived-box"><span>大眼仔</span>{renderDerived(roads.bigEye, 'bigeye', 24, 9)}</div>
              <div className="derived-box"><span>小路</span>{renderDerived(roads.small, 'small', 24, 9)}</div>
              <div className="derived-box"><span>曱甴路</span>{renderDerived(roads.cockroach, 'cockroach', 24, 9)}</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});

export default BaccaratRoadmap;

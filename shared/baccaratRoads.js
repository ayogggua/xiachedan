// 澳门百家乐五路单（珠盘路 / 大路 / 大眼仔 / 小路 / 曱甴路）与问路算法

const ROWS = 6;

export function shoeStats(history = []) {
  let banker = 0, player = 0, tie = 0, bankerPair = 0, playerPair = 0, lucky6 = 0, natural = 0;
  for (const item of history) {
    if (item.o === 'banker') banker++;
    else if (item.o === 'player') player++;
    else if (item.o === 'tie') tie++;
    if (item.bp) bankerPair++;
    if (item.pp) playerPair++;
    if (item.l6) lucky6++;
    if (item.nat) natural++;
  }
  return { total: history.length, banker, player, tie, bankerPair, playerPair, lucky6, natural };
}

export function buildBeadPlate(history = [], rows = ROWS) {
  const cells = history.map((entry, index) => ({
    col: Math.floor(index / rows),
    row: index % rows,
    entry,
  }));
  const cols = cells.length ? cells.at(-1).col + 1 : 0;
  return { cells, cols };
}

function placeStreaks(streaks, rows = ROWS) {
  const occupied = new Set();
  const cells = [];
  let startCol = -1;
  let maxCol = -1;
  for (const streak of streaks) {
    startCol++;
    while (occupied.has(`${startCol},0`)) startCol++;
    let c = startCol;
    let r = 0;
    let turned = false;
    streak.forEach((item, index) => {
      if (index > 0) {
        if (!turned && r + 1 < rows && !occupied.has(`${c},${r + 1}`)) r++;
        else { turned = true; c++; }
      }
      occupied.add(`${c},${r}`);
      if (c > maxCol) maxCol = c;
      cells.push({ col: c, row: r, ...item });
    });
  }
  return { cells, cols: maxCol + 1 };
}

export function buildBigRoad(history = [], rows = ROWS) {
  const logicalCols = [];
  let leadingTies = 0;
  let lastEntry = null;
  for (const item of history) {
    if (item.o === 'tie') {
      if (lastEntry) lastEntry.ties++;
      else leadingTies++;
      continue;
    }
    const cell = {
      side: item.o,
      ties: leadingTies,
      bp: Boolean(item.bp),
      pp: Boolean(item.pp),
      l6: Number(item.l6 || 0),
      nat: Boolean(item.nat),
      round: item.r,
      ghost: Boolean(item.ghost),
    };
    leadingTies = 0;
    if (!logicalCols.length || logicalCols.at(-1).side !== item.o) {
      logicalCols.push({ side: item.o, items: [cell] });
    } else {
      logicalCols.at(-1).items.push(cell);
    }
    lastEntry = cell;
  }

  if (!logicalCols.length && leadingTies > 0) {
    return {
      cells: [{ col: 0, row: 0, side: 'tie', ties: leadingTies, bp: false, pp: false, l6: 0, nat: false }],
      cols: 1,
      logicalCols,
    };
  }

  const placed = placeStreaks(logicalCols.map(column => column.items), rows);
  return { ...placed, logicalCols };
}

function derivedColor(logicalCols, col, row, offset) {
  if (col < offset || (col === offset && row === 0)) return null;
  if (row === 0) {
    return logicalCols[col - 1].items.length === logicalCols[col - 1 - offset].items.length ? 'red' : 'blue';
  }
  const refLen = logicalCols[col - offset].items.length;
  return row !== refLen ? 'red' : 'blue';
}

export function buildDerivedRoad(logicalCols, offset, rows = ROWS) {
  const streaks = [];
  for (let col = 0; col < logicalCols.length; col++) {
    const items = logicalCols[col].items;
    for (let row = 0; row < items.length; row++) {
      const color = derivedColor(logicalCols, col, row, offset);
      if (!color) continue;
      const entry = { color, ghost: Boolean(items[row].ghost) };
      if (!streaks.length || streaks.at(-1)[0].color !== color) streaks.push([entry]);
      else streaks.at(-1).push(entry);
    }
  }
  return placeStreaks(streaks, rows);
}

export function computeRoadmaps(history = [], rows = ROWS) {
  const bead = buildBeadPlate(history, rows);
  const big = buildBigRoad(history, rows);
  const bigEye = buildDerivedRoad(big.logicalCols, 1, rows);
  const small = buildDerivedRoad(big.logicalCols, 2, rows);
  const cockroach = buildDerivedRoad(big.logicalCols, 3, rows);
  return {
    stats: shoeStats(history),
    bead,
    big,
    bigEye,
    small,
    cockroach,
  };
}

export function askRoad(history = [], side = 'banker') {
  const hypothetical = [...history, { o: side, ghost: true }];
  const big = buildBigRoad(hypothetical);
  const lastCol = big.logicalCols.length - 1;
  if (lastCol < 0) return { bigEye: null, small: null, cockroach: null };
  const lastRow = big.logicalCols[lastCol].items.length - 1;
  return {
    bigEye: derivedColor(big.logicalCols, lastCol, lastRow, 1),
    small: derivedColor(big.logicalCols, lastCol, lastRow, 2),
    cockroach: derivedColor(big.logicalCols, lastCol, lastRow, 3),
  };
}

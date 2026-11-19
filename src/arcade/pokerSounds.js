// Rendered from CrommaCode 0.3.29's arena trigger, control and sample routines.
// Strength is the native 0..7 quantization; stack height is measured in chips.
const files = import.meta.glob('./sounds/*.wav', { eager: true, query: '?url', import: 'default' });
const bank = new Map();
for (const [path, url] of Object.entries(files)) {
  const key = path.slice('./sounds/'.length).replace(/-\d+\.wav$/, '');
  if (!bank.has(key)) bank.set(key, []);
  bank.get(key).push(url);
}
const warmKeys = ['deal', 'card-land', 'board-land', 'board-land-1', 'board-land-2', 'board-land-3', 'flip', 'fold', 'check',
  'bet-2', 'bet-8', 'bounce-4', 'land-4', 'collision-4', 'stack-1', 'collect-2', 'collect-end-1', 'payout-self-8', 'payout-other-8'];
export const pokerWarmupUrls = warmKeys.flatMap(key => bank.get(key)?.slice(0, 1) || []);

export function pokerSoundOptions(kind, { strength = 1, height = 1, progress = 1, level = 0, count = 1, sequence = 0 } = {}) {
  let key = kind;
  if (['bounce', 'land', 'collision'].includes(kind)) key += `-${Math.max(0, Math.min(7, Math.round((Number.isFinite(strength) ? strength : 1) * 7)))}`;
  else if (kind === 'stack') key += `-${Math.max(1, Math.min(19, Math.round(Number.isFinite(height) ? height : 1)))}`;
  else if (kind === 'payout-self' || kind === 'payout-other') key += `-${Math.max(0, Math.min(16, Math.floor((Number.isFinite(progress) ? progress : 1) * 16)))}`;
  else if (kind === 'bet') key += `-${Math.max(0, Math.min(8, Math.floor(Number.isFinite(level) ? level : 0)))}`;
  else if (kind === 'collect') key += `-${Math.max(1, Math.min(6, Math.round(Number.isFinite(count) ? count : 1)))}`;
  else if (kind === 'collect-end') key += `-${Math.max(1, Math.min(6, Math.round(Number.isFinite(sequence) ? sequence : 1)))}`;
  else if (kind === 'board-land' && sequence > 0) key += `-${Math.max(1, Math.min(3, Math.round(sequence)))}`;
  return bank.get(key) || [];
}

import { readStorage } from './history';

// 本机的勿扰设置：每天固定时段，或临时暂停到某个时间；可以让 @我 的消息照常提醒。
const KEY = 'linliao.quiet';
export const readQuiet = () => ({ enabled: false, start: '22:00', end: '08:00', until: 0, mentions: true, ...readStorage(KEY, {}) });
export const saveQuiet = value => localStorage.setItem(KEY, JSON.stringify(value));
const minutes = value => { const [hours, mins] = String(value).split(':').map(Number); return hours * 60 + mins; };

export function isQuiet(mentioned = false, now = new Date()) {
  const quiet = readQuiet();
  if (mentioned && quiet.mentions) return false;
  if (quiet.until > now.getTime()) return true;
  if (!quiet.enabled) return false;
  const current = now.getHours() * 60 + now.getMinutes(), start = minutes(quiet.start), end = minutes(quiet.end);
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

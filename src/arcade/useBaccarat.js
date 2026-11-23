import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uid } from '../api';

export default function useBaccarat(active = false) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const selected = useRef('');
  const live = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const serial = useRef(0);
  const queue = useRef([]);
  const draining = useRef(false);

  const refresh = useCallback(async () => {
    if (!activeRef.current && !selected.current) return;
    const ticket = ++serial.current;
    try {
      const next = await api(`arcade/baccarat/state${selected.current ? `?id=${encodeURIComponent(selected.current)}` : ''}`);
      if (live.current && ticket === serial.current) {
        setData(next);
        setError('');
      }
    } catch (failure) {
      if (live.current && ticket === serial.current) {
        setError(failure.message);
        if (failure.status === 404) {
          selected.current = '';
          setData(prev => prev && { ...prev, table: null });
        }
      }
    } finally {
      if (live.current && ticket === serial.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    let debounce;
    const sync = event => {
      if (!activeRef.current && !selected.current) return;
      const detail = event?.detail;
      if (detail?.game === 'poker') return;
      clearTimeout(debounce);
      debounce = setTimeout(refresh, 55);
    };
    const wake = () => {
      if (document.visibilityState === 'visible' && (activeRef.current || selected.current)) sync();
    };
    if (active) {
      setLoading(prev => prev || !data);
      refresh();
    }
    const poll = setInterval(wake, 4000);
    window.addEventListener('linliao:arcade-changed', sync);
    window.addEventListener('linliao:resume', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      live.current = false;
      ++serial.current;
      clearTimeout(debounce);
      clearInterval(poll);
      window.removeEventListener('linliao:arcade-changed', sync);
      window.removeEventListener('linliao:resume', wake);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [active, refresh]);

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    if (live.current) setBusy(true);
    try {
      while (queue.current.length && live.current) {
        const item = queue.current.shift();
        ++serial.current;
        try {
          const next = await api(`arcade/baccarat/${item.action}`, { requestId: uid(), ...item.body });
          ++serial.current;
          if (live.current) {
            if (item.action === 'leave') selected.current = '';
            else if (next.table?.id) selected.current = next.table.id;
            setData(next);
            setError('');
          }
          item.resolve(next);
        } catch (failure) {
          // 发生错误后清空后续排队的重复押注，避免连续报错
          while (queue.current.length) queue.current.shift().resolve(null);
          await refresh();
          if (live.current) setError(failure.message);
          item.resolve(null);
        }
      }
    } finally {
      draining.current = false;
      if (live.current) setBusy(false);
    }
  }, [refresh]);

  const command = useCallback((action, body = {}) => {
    // 筹码连点支持排队，其余操作防连点
    if (action !== 'bet' && draining.current) return Promise.resolve(null);
    if (action === 'bet' && queue.current.length >= 6) return Promise.resolve(null);
    return new Promise(resolve => {
      queue.current.push({ action, body, resolve });
      drain();
    });
  }, [drain]);

  const inspect = useCallback(async id => {
    selected.current = id || '';
    activeRef.current = true;
    setLoading(true);
    await refresh();
  }, [refresh]);

  const leaveTable = useCallback(async () => {
    const id = selected.current;
    selected.current = '';
    setData(prev => prev && { ...prev, table: null });
    if (id) {
      try {
        await api('arcade/baccarat/leave', { id });
      } catch {}
    }
  }, []);

  const clearError = useCallback(() => setError(''), []);

  return { ...data, loading, busy, error, clearError, refresh, command, inspect, leaveTable };
}

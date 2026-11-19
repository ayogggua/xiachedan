import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

export default function useArcade() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const selected = useRef('');
  const live = useRef(false);
  const serial = useRef(0);
  const mutating = useRef(false);
  const refresh = useCallback(async () => {
    const ticket = ++serial.current;
    try {
      const next = await api(`arcade/state${selected.current ? `?id=${encodeURIComponent(selected.current)}` : ''}`);
      if (live.current && ticket === serial.current) { setData(next); setError(''); }
    } catch (error) {
      if (live.current && ticket === serial.current) {
        setError(error.message);
        if (error.status === 404) { selected.current = ''; setData(previous => previous && { ...previous, table: null }); }
      }
    } finally { if (live.current) setLoading(false); }
  }, []);
  useEffect(() => {
    live.current = true;
    let debounce;
    const sync = () => { clearTimeout(debounce); debounce = setTimeout(refresh, 60); };
    const wake = () => { if (document.visibilityState === 'visible') sync(); };
    const joined = event => { selected.current = event.detail?.id || ''; sync(); };
    refresh();
    const poll = setInterval(wake, 5000);
    window.addEventListener('linliao:arcade-changed', sync);
    window.addEventListener('linliao:arcade-joined', joined);
    window.addEventListener('linliao:resume', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => { live.current = false; ++serial.current; clearTimeout(debounce); clearInterval(poll); window.removeEventListener('linliao:arcade-changed', sync); window.removeEventListener('linliao:arcade-joined', joined); window.removeEventListener('linliao:resume', wake); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake); };
  }, [refresh]);
  const command = async (action, body = {}) => {
    if (mutating.current) return false;
    mutating.current = true; setBusy(true); setError(''); ++serial.current;
    try {
      const next = await api(`arcade/${action}`, { requestId: crypto.randomUUID(), ...body });
      ++serial.current;
      if (live.current) { selected.current = next.table?.id || ''; setData(next); }
      return true;
    } catch (error) {
      await refresh();
      if (live.current) setError(error.message);
      return false;
    } finally { mutating.current = false; if (live.current) setBusy(false); }
  };
  const inspect = async id => { selected.current = id || ''; setLoading(true); await refresh(); };
  return { ...data, loading, busy, error, refresh, command, inspect };
}

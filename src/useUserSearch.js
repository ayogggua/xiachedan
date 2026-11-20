import { useEffect, useState } from 'react';
import { api } from './api';

// 昵称、部门和备注即时匹配，完整账号交给服务端查询，避免下发他人的登录信息。
export default function useUserSearch(users = [], query = '', enabled = true, notes = {}) {
  const term = query.trim().toLowerCase();
  const [result, setResult] = useState({ term: '', ids: [], error: '' });
  useEffect(() => {
    if (!enabled || !term) {
      setResult(previous => previous.term || previous.ids.length || previous.error ? { term: '', ids: [], error: '' } : previous);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await api(`users/search?q=${encodeURIComponent(term)}`, undefined, { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ term, ids: response.users.map(user => user.id), error: '' });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ term, ids: [], error: error.message });
      }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [term, enabled]);
  const remoteIds = new Set(enabled && result.term === term ? result.ids : []);
  return {
    users: users.filter(user => !user.removed && (!term || remoteIds.has(user.id) ||
      [user.name, user.department, user.bio, notes[user.id]].some(value => value?.toLowerCase().includes(term)))),
    loading: Boolean(enabled && term && result.term !== term),
    error: enabled && result.term === term ? result.error : '',
  };
}

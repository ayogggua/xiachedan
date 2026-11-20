import { useEffect, useState } from 'react';
import { api } from './api';

// 昵称、部门和备注即时匹配，远程搜索返回包括非好友在内的匹配结果，避免下发完整用户列表或他人登录信息。
export default function useUserSearch(users = [], query = '', enabled = true, notes = {}) {
  const term = query.trim().toLowerCase();
  const [result, setResult] = useState({ term: '', users: [], error: '' });
  useEffect(() => {
    if (!enabled || !term) {
      setResult(previous => previous.term || previous.users.length || previous.error ? { term: '', users: [], error: '' } : previous);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await api(`users/search?q=${encodeURIComponent(term)}`, undefined, { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ term, users: response.users || [], error: '' });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ term, users: [], error: error.message });
      }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [term, enabled]);
  const activeUsers = users.filter(user => !user.removed);
  if (!term) return { users: activeUsers, loading: false, error: '' };
  const localMatches = activeUsers.filter(user =>
    [user.name, user.department, user.bio, notes[user.id]].some(value => value?.toLowerCase().includes(term)));
  const merged = new Map(localMatches.map(user => [user.id, user]));
  if (enabled && result.term === term) {
    for (const remote of result.users) {
      if (remote.removed) continue;
      const local = merged.get(remote.id);
      merged.set(remote.id, local ? { ...remote, ...local, relation: remote.relation, requestId: remote.requestId } : remote);
    }
  }
  return {
    users: [...merged.values()],
    loading: Boolean(enabled && term && result.term !== term),
    error: enabled && result.term === term ? result.error : '',
  };
}

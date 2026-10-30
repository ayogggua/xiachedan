import { parseInvitation } from '../shared/invitation.js';

export async function connectToInvitation(value, identity, request) {
  const { addresses, inviteCode } = parseInvitation(value);
  if (!addresses.length) throw new Error('这只有邀请码，请复制包含内网地址的完整邀请');
  const controller = new AbortController();
  let origin;
  try {
    origin = await Promise.any(addresses.map(async address => {
      const response = await request(`${address}/api/health`, {
        credentials: 'omit', redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok || (await response.json()).app !== 'linliao') throw new Error('不是聊天空间');
      return address;
    }));
  } catch { throw new Error('无法连接，请确认两台 Mac 在同一局域网，且创建空间的 Mac 已打开虾扯蛋'); }
  finally { controller.abort(); }
  if (!inviteCode) return origin;

  async function json(route, body) {
    let response, data;
    try {
      response = await request(`${origin}/api/${route}`, {
        method: body ? 'POST' : 'GET', credentials: 'include', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Linliao': '1' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
      });
      data = await response.json();
    } catch { throw new Error('连接中断，请检查网络后重新加入'); }
    if (!response.ok) throw new Error(data.error || '暂时无法加入空间');
    return data;
  }
  const bootstrap = await json('bootstrap');
  if (!bootstrap.configured) throw new Error('对方还没有创建空间，请联系邀请你的同事');
  if (!bootstrap.me) {
    const name = typeof identity?.name === 'string' ? identity.name.trim().slice(0, 24) : '';
    if (!name) throw new Error('请先填写昵称');
    await json('join', { name, avatar: identity.avatar, inviteCode });
  }
  return origin;
}

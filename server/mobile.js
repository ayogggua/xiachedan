import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const mobileOrigins = new Set(['capacitor://localhost', 'https://localhost', 'http://localhost']);
export const isMobileClient = req => req.headers['x-linliao-client'] === 'mobile';
export const isMediaRequest = req => ['GET', 'HEAD'].includes(req.method) && `${req.baseUrl || ''}${req.path}` === '/api/media';

// 原生客户端不依赖跨站 Cookie；WebSocket 在子协议中携带凭证，避免进入 URL 和访问日志。
export function mobileToken(req) {
  const authorization = req.headers.authorization;
  if (authorization) return /^Bearer ([0-9a-f]{64})$/.exec(authorization)?.[1] || '';
  const protocols = req.headers['sec-websocket-protocol']?.split(',').map(value => value.trim()) || [];
  return protocols.find(value => /^session\.[0-9a-f]{64}$/.test(value))?.slice(8) || '';
}

export function createMediaAccess() {
  const secret = randomBytes(32);
  const sign = value => createHmac('sha256', secret).update(value).digest('hex');
  return {
    issue(sessionHash) {
      const value = `${sessionHash}.${Date.now() + 15 * 60000}`;
      return `${value}.${sign(value)}`;
    },
    sessionHash(req) {
      // 临时凭证只允许读取附件，不能登录、导出记录或执行其他接口；仍受会话有效期和房间权限限制。
      if (!isMediaRequest(req)) return '';
      const ticket = req.query?.access;
      if (typeof ticket !== 'string' || !/^[0-9a-f]{64}\.\d{13}\.[0-9a-f]{64}$/.test(ticket)) return '';
      const [sessionHash, expires, signature] = ticket.split('.');
      if (Number(expires) <= Date.now()) return '';
      const expected = sign(`${sessionHash}.${expires}`);
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature)) ? sessionHash : '';
    },
  };
}

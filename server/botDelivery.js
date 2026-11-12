import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { createHmac } from 'node:crypto';
import { ADDRESS_LABELS, addressAllowed, checkCallbackUrl, classifyAddress } from './address.js';
import { createHostResolver } from './resolve.js';

// 机器人回调的一次投递：按模式检查地址（域名每次投递时现解析），连接时直接连检查过的那个 IP，
// 中间不再解析（没有 DNS 重绑定的空档）；不跟随重定向，限时，响应内容只读一点就丢掉，从不记录。
const RESPONSE_BYTES = 4096;

export const signPayload = (secret, timestamp, body) => createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

// 连接检查过的 IP；https 用原来的域名做 SNI 和证书校验（tls.connect 按 servername 校验证书）。
const defaultConnect = ({ ip, port, secure, servername, tlsOptions }) => secure
  ? tls.connect({ host: ip, port, ...(servername ? { servername } : {}), ALPNProtocols: ['http/1.1'], ...tlsOptions })
  : net.connect({ host: ip, port });

// 失败分几类：kind 决定给管理者看的说法，detail 是底层原因（错误码、地址类别）。
const failure = (kind, retry, detail = '', status) => ({ ok: false, kind, retry, detail, ...(status ? { status } : {}) });
// 证书类的错误码（自签、过期、域名不符、缺中间证书……）；其余 TLS 握手错误按连不上算。
const CERTIFICATE = /CERT|SELF_SIGNED|UNABLE_TO_|ALTNAME|HOSTNAME_MISMATCH/;
// 域名解析见 resolve.js：账号模式走 c-ares（不占线程池、到点取消），局域网模式走 getaddrinfo（限并发、排队、同名共用）。
export function createBotSender({ mode, resolver = createHostResolver(), connect = defaultConnect, timeoutMs = 5000, tlsOptions = {}, log = details => console.warn(details) } = {}) {
  const active = new Set();
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  // 给管理者看的说法：账号模式下只给几类笼统的原因（不带错误码，免得借回调探测服务器能连到的端口），细节只写服务器日志；
  // 局域网模式是自己的网络，照实说。
  const cloud = mode !== 'local';
  const describe = result => ({
    invalid: result.detail, stopped: '服务已停止', dns: '无法解析回调地址的域名',
    queued: '等待域名解析的投递太多，这次没排上，稍后重试',
    timeout: `回调地址 ${seconds} 秒内没有完成（包括域名解析）`,
    blocked: cloud ? '回调地址不是公网地址，不能投递' : `回调地址的域名解析到了${result.detail}，不能投递`,
    status: `对方返回 HTTP ${result.status}${result.status >= 300 && result.status < 400 ? '（不跟随重定向）' : ''}`,
    certificate: cloud ? '证书校验失败' : `HTTPS 证书无效（${result.detail}）`,
    connect: cloud ? '无法连接回调地址' : result.detail === 'ECONNREFUSED' ? '回调地址拒绝连接' : `连接回调地址失败（${result.detail}）`,
  })[result.kind];
  // 找出这次要连的地址：解析出的地址里只要有一个不允许，就整条拒绝（不挑一个能用的凑合）。解析自己带截止时间。
  async function target(raw, deadline, stopped) {
    let parsed;
    try { parsed = checkCallbackUrl(raw, mode); } catch (error) { return failure('invalid', false, error.message); }
    if (parsed.ip) return { parsed, ip: parsed.ip };
    const resolve = cloud ? resolver.resolvePublic : resolver.resolveLan;
    const lookup = resolve(parsed.hostname.replace(/\.+$/, ''), deadline).then(addresses => ({ addresses }), error => ({ error }));
    const outcome = await Promise.race([lookup, stopped.then(reason => ({ reason }))]);
    if (outcome.reason) return failure('stopped', false);
    if (outcome.error) return failure({ queued: 'queued', timeout: 'timeout' }[outcome.error.code] || 'dns', true, outcome.error.code || outcome.error.message);
    const blocked = outcome.addresses.find(ip => !addressAllowed(ip, mode));
    if (blocked) return failure('blocked', false, ADDRESS_LABELS[classifyAddress(blocked)]);
    return { parsed, ip: outcome.addresses[0] };
  }

  function request({ parsed: { url, hostname, port }, ip }, body, headers, deadline, stopped) {
    const secure = url.protocol === 'https:';
    return new Promise(settle => {
      let done = false;
      let req;
      const finish = result => { if (!done) { done = true; clearTimeout(timer); settle(result); } };
      // 截止时间已经到了（比如解析刚好在最后一刻才回来）就不再发起连接。
      const timer = setTimeout(() => { finish(failure('timeout', true)); req?.destroy(); }, Math.max(0, deadline - Date.now()));
      stopped.then(() => { finish(failure('stopped', false)); req?.destroy(); });
      if (deadline <= Date.now()) return finish(failure('timeout', true));
      try {
        req = http.request({
          method: 'POST', path: `${url.pathname}${url.search}`, setHost: false,
          headers: { Host: url.host, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'XiachedanBot/1.0', ...headers },
          createConnection: () => connect({ ip, port, secure, servername: net.isIP(hostname) ? '' : hostname.replace(/\.+$/, ''), tlsOptions }),
        }, response => {
          const status = response.statusCode;
          let size = 0;
          // 响应正文不用：读一点就断开，不保存也不写日志。
          response.on('data', chunk => { size += chunk.length; if (size > RESPONSE_BYTES) response.destroy(); });
          const result = () => status >= 200 && status < 300 ? { ok: true, status }
            : failure('status', status >= 500 || status === 408 || status === 429, '', status);
          response.on('end', () => finish(result()));
          response.on('close', () => finish(result()));
          response.on('error', () => finish(result()));
        });
        req.on('error', error => {
          const code = error.code || error.message;
          finish(CERTIFICATE.test(String(error.code)) ? failure('certificate', false, code) : failure('connect', true, code));
        });
        req.end(body);
      } catch (error) { finish(failure('connect', true, error.code || error.message)); }
    });
  }

  // 返回 { ok, status, error, retry, kind }：retry 表示这类失败值得重试（网络、超时、排队、5xx、408、429）。
  // 解析、连接、等回应合起来不超过 timeoutMs：到点后即使解析才回来，也不再发起连接。
  async function send(raw, body, headers) {
    const deadline = Date.now() + timeoutMs;
    let wake;
    const stopped = new Promise(resolve => { wake = resolve; });
    const stop = () => wake('stopped');
    active.add(stop);
    let result;
    try {
      const found = await target(raw, deadline, stopped);
      result = found.parsed ? await request(found, body, headers, deadline, stopped) : found;
    } finally { active.delete(stop); }
    if (result.ok) return result;
    if (cloud && result.detail && result.kind !== 'invalid') log({ message: 'bot callback failed', kind: result.kind, detail: result.detail, host: (() => { try { return new URL(raw).host; } catch { return ''; } })() });
    return { ok: false, retry: result.retry, kind: result.kind, error: describe(result), ...(result.status ? { status: result.status } : {}) };
  }
  // 服务关闭时中断还在进行的投递。
  return { send, close: () => { for (const stop of [...active]) stop(); } };
}

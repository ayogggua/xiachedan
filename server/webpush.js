// Web Push：按 RFC 8291 加密消息内容（aes128gcm），按 RFC 8292（VAPID）签名，只用 node:crypto。
import { createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, createCipheriv, sign } from 'node:crypto';

const b64url = buffer => Buffer.from(buffer).toString('base64url');
const fromB64url = text => Buffer.from(text, 'base64url');
const hkdf = (salt, ikm, info, length) => Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

// 推送地址由浏览器提供，服务端会去访问它：只放行 HTTPS 的已知推送服务，防止被用来探测内网。
// Chrome 用 fcm.googleapis.com（旧版 android.googleapis.com），部分 Chromium 浏览器用 jmt17.google.com 这类地址。
const PUSH_HOSTS = [/^(fcm|android)\.googleapis\.com$/, /^jmt\d+\.google\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function validEndpoint(value) {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && PUSH_HOSTS.some(pattern => pattern.test(url.hostname));
  } catch { return false; }
}

// 浏览器给的公钥必须是 P-256 上的点（computeSecret 会校验），认证密钥是 16 字节。
export function validKeys(keys) {
  try {
    const publicKey = fromB64url(keys?.p256dh || ''), auth = fromB64url(keys?.auth || '');
    if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length !== 16) return false;
    const probe = createECDH('prime256v1'); probe.generateKeys(); probe.computeSecret(publicKey);
    return true;
  } catch { return false; }
}

// 加密一条推送：单个记录，rs=4096，keyid 是本次临时生成的服务端公钥。localKey、salt 只在测试里传入。
export function encrypt(payload, keys, { localKey, salt = randomBytes(16) } = {}) {
  const uaPublic = fromB64url(keys.p256dh), authSecret = fromB64url(keys.auth);
  const ecdh = createECDH('prime256v1');
  if (localKey) ecdh.setPrivateKey(localKey); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ikm = hkdf(authSecret, ecdh.computeSecret(uaPublic), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0); header.writeUInt32BE(4096, 16); header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

// VAPID 签名密钥：首次使用时生成，存成 JWK。
export const createVapidKeys = () => generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
export const vapidPublicKey = jwk => b64url(Buffer.concat([Buffer.from([4]), fromB64url(jwk.x), fromB64url(jwk.y)]));

// 签名结果按推送服务和联系人缓存，到期前 1 小时换新，避免每条推送都做一次 ECDSA 签名。
const signingKeys = new WeakMap(), tokens = new Map();
export function vapidAuthorization(endpoint, jwk, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin, cacheKey = `${jwk.x}|${aud}|${subject}`, cached = tokens.get(cacheKey);
  if (cached && cached.exp * 1000 - now > 3600000) return cached.value;
  if (!signingKeys.has(jwk)) signingKeys.set(jwk, createPrivateKey({ key: jwk, format: 'jwk' }));
  const exp = Math.floor(now / 1000) + 12 * 3600;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64url(JSON.stringify({ aud, exp, sub: subject }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: signingKeys.get(jwk), dsaEncoding: 'ieee-p1363' });
  const value = `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapidPublicKey(jwk)}`;
  if (tokens.size > 200) tokens.clear();
  tokens.set(cacheKey, { exp, value });
  return value;
}

// 发送一条推送，返回推送服务的状态码；网络失败返回 0。
export async function sendPush(subscription, payload, { jwk, subject, urgency = 'normal', ttl = 86400 }) {
  try {
    const response = await fetch(subscription.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { TTL: String(ttl), Urgency: urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        Authorization: vapidAuthorization(subscription.endpoint, jwk, subject) },
      body: encrypt(JSON.stringify(payload), subscription.keys),
    });
    await response.arrayBuffer().catch(() => {});
    return response.status;
  } catch { return 0; }
}

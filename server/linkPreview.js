import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';

// 链接预览：服务端抓取网页标题和简介。只访问公网地址（每次跳转都重新检查，连接时固定用检查过的 IP，防止 DNS 重绑定），
// 限时、限大小、只读 HTML；不抓图片，聊天里也就不会从外部站点加载任何内容。
const TIMEOUT = 4000;
const MAX_BYTES = 512 * 1024;

const privateV4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]];
const toNumber = ip => ip.split('.').reduce((sum, part) => sum * 256 + Number(part), 0);
export function isPublicAddress(ip) {
  if (net.isIPv4(ip)) return !privateV4.some(([base, bits]) => (toNumber(ip) >>> (32 - bits)) === (toNumber(base) >>> (32 - bits)));
  if (!net.isIPv6(ip)) return false;
  const value = ip.toLowerCase();
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);
  return !(value === '::' || value === '::1' || /^(fc|fd|fe[89ab]|ff)/.test(value) || value.startsWith('64:ff9b:') || value.startsWith('2001:db8'));
}

async function resolvePublic(hostname) {
  const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('只能预览公网链接');
  return addresses[0];
}

function request(url, address) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method: 'GET', timeout: TIMEOUT, headers: { 'User-Agent': 'XiachedanLinkPreview/1.0', Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6' },
      lookup: (_host, _options, done) => done(null, address.address, address.family),
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { response.resume(); return resolve({ redirect: new URL(response.headers.location, url) }); }
      if (response.statusCode !== 200 || !/text\/html|application\/xhtml/.test(response.headers['content-type'] || '')) { response.resume(); return reject(new Error('不是可以预览的网页')); }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { response.destroy(); resolve({ html: Buffer.concat(chunks).toString('utf8') }); } else chunks.push(chunk); });
      response.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('网页响应超时')));
    req.on('error', reject);
    req.end();
  });
}

const decode = text => text.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_, code) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[code.toLowerCase()]
  ?? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10))).replace(/\s+/g, ' ').trim();
function meta(html, names) {
  for (const name of names) {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i'))?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return decode(content);
  }
  return '';
}

export async function fetchPreview(raw) {
  let url = new URL(raw);
  for (let hop = 0; hop < 4; hop++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只能预览网页链接');
    const address = await resolvePublic(url.hostname.replace(/^\[|\]$/g, ''));
    const result = await request(url, address);
    if (result.redirect) { url = result.redirect; continue; }
    const head = result.html.slice(0, MAX_BYTES);
    const title = meta(head, ['og:title', 'twitter:title']) || decode(head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '');
    const description = meta(head, ['og:description', 'twitter:description', 'description']);
    if (!title && !description) throw new Error('网页没有标题');
    return { url: url.href, title: title.slice(0, 200), description: description.slice(0, 300), site: (meta(head, ['og:site_name']) || url.hostname).slice(0, 80) };
  }
  throw new Error('跳转次数过多');
}

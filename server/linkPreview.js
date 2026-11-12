import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { addressAllowed } from './address.js';
import { createHostResolver } from './resolve.js';

// 链接预览：服务端抓取网页标题和简介。只访问公网地址（每次跳转都重新检查，连接时固定用检查过的 IP，防止 DNS 重绑定），
// 限时、限大小、只读 HTML；不抓图片，聊天里也就不会从外部站点加载任何内容。
const TIMEOUT = 4000;
const MAX_BYTES = 512 * 1024;

// 地址分类与外发机器人回调共用一个函数（address.js）；这里只接受公网地址。
export const isPublicAddress = ip => addressAllowed(ip, 'cloud');

// 连接时只用检查过的地址。Node 20 起默认开着 autoSelectFamily，net 调 lookup 时带 all: true、要的是地址数组；
// 两种调用方式都要支持，否则带域名的网址一律报「Invalid IP address: undefined」。
export const pinnedLookup = address => (_host, options, done) => options?.all
  ? done(null, [{ address: address.address, family: address.family }])
  : done(null, address.address, address.family);

// 域名解析和机器人回调共用 resolve.js 的公网解析（c-ares）：不占 libuv 线程池，每一跳最多等 TIMEOUT 毫秒，
// 有人发一堆解析会挂住的网址也拖不住登录、上传。localhost 这类名字不去查，直接当本机拒绝。
const sharedResolver = createHostResolver();
async function resolvePublic(hostname, resolver, timeout) {
  const bare = hostname.replace(/\.+$/, '').toLowerCase();
  if (bare === 'localhost' || bare.endsWith('.localhost')) throw new Error('只能预览公网链接');
  let addresses;
  if (net.isIP(hostname)) addresses = [hostname];
  else {
    try { addresses = await resolver.resolvePublic(bare, Date.now() + timeout); }
    catch (error) { throw new Error(error.code === 'timeout' ? '网页响应超时' : '找不到这个网址的域名'); }
  }
  if (!addresses.length || addresses.some(address => !isPublicAddress(address))) throw new Error('只能预览公网链接');
  return { address: addresses[0], family: net.isIP(addresses[0]) };
}

function request(url, address) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method: 'GET', timeout: TIMEOUT, headers: { 'User-Agent': 'XiachedanLinkPreview/1.0', Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6' },
      lookup: pinnedLookup(address),
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

// resolver、timeout 只给测试用。
export async function fetchPreview(raw, { resolver = sharedResolver, timeout = TIMEOUT } = {}) {
  let url = new URL(raw);
  for (let hop = 0; hop < 4; hop++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只能预览网页链接');
    const address = await resolvePublic(url.hostname.replace(/^\[|\]$/g, ''), resolver, timeout);
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

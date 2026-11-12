// 机器人测试辅助：本机的回调接收端、带令牌调用机器人接口、等事件到达。
import { createServer } from 'node:http';
import dgram from 'node:dgram';
import { createHmac } from 'node:crypto';

// 回调接收端：记录每个请求（头、原始正文、解析后的事件）；respond 决定怎么回应（默认 200）。
export async function receiver(respond = () => ({ status: 200 })) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let event = null;
      try { event = JSON.parse(raw); } catch {}
      const entry = { method: req.method, url: req.url, headers: req.headers, raw, event };
      requests.push(entry);
      const answer = await respond(entry, requests.length);
      if (answer?.hang) return;
      res.writeHead(answer?.status || 200, answer?.headers || { 'Content-Type': 'text/plain' });
      res.end(answer?.body || 'ok');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  // 测试失败没来得及关时也不拖住进程。
  server.unref();
  const port = server.address().port;
  return { requests, port, url: `http://127.0.0.1:${port}/hook`, events: type => requests.filter(item => !type || item.event?.type === type).map(item => item.event),
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

export const verify = (secret, request) => {
  const expected = `v1=${createHmac('sha256', secret).update(`${request.headers['x-xiachedan-timestamp']}.${request.raw}`).digest('hex')}`;
  return request.headers['x-xiachedan-signature'] === expected;
};

export const botCall = (base, token, method, path, body) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
}).then(async response => ({ status: response.status, body: await response.json().catch(() => null) }));

export async function waitFor(check, timeout = 3000) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error('waitFor timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

// 测试用的 DNS 服务器（UDP，只回答 A 和 AAAA）：账号模式的回调和链接预览用 c-ares 直接查它，走的是真实的解析路径。
// answer(name, type) 返回 [{ type: 'A' | 'AAAA' | 'CNAME', name?, value }]（可以是 Promise，用来模拟慢），'hang' 表示不回应，空值表示不存在。
const encodeName = host => Buffer.concat([...host.split('.').filter(Boolean).map(label => Buffer.concat([Buffer.from([Buffer.byteLength(label)]), Buffer.from(label)])), Buffer.from([0])]);
const v6Bytes = address => {
  // 末尾是点分 IPv4（::ffff:127.0.0.1）时先换成两组十六进制，再展开「::」。
  const ip = address.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_all, a, b, c, d) => `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`);
  const [head, tail] = ip.split('::');
  const parts = value => value ? value.split(':') : [];
  const groups = tail === undefined ? parts(head) : [...parts(head), ...Array(8 - parts(head).length - parts(tail).length).fill('0'), ...parts(tail)];
  return Buffer.from(groups.flatMap(group => { const value = parseInt(group, 16); return [value >> 8, value & 255]; }));
};
export async function fakeDns(answer) {
  const queries = [];
  const socket = dgram.createSocket('udp4');
  socket.on('message', async (message, peer) => {
    const labels = [];
    let offset = 12;
    for (let length = message[offset++]; length; length = message[offset++]) { labels.push(message.toString('latin1', offset, offset + length)); offset += length; }
    const name = labels.join('.'), code = message.readUInt16BE(offset), type = code === 1 ? 'A' : code === 28 ? 'AAAA' : String(code);
    queries.push({ name, type, at: Date.now() });
    const records = await answer(name, type);
    if (records === 'hang') return;
    const answers = (records || []).filter(record => record.type === type || record.type === 'CNAME').map(record => {
      const data = record.type === 'A' ? Buffer.from(record.value.split('.').map(Number)) : record.type === 'AAAA' ? v6Bytes(record.value) : encodeName(record.value);
      const head = Buffer.alloc(10);
      head.writeUInt16BE({ A: 1, AAAA: 28, CNAME: 5 }[record.type], 0); head.writeUInt16BE(1, 2); head.writeUInt32BE(30, 4); head.writeUInt16BE(data.length, 8);
      return Buffer.concat([encodeName(record.name || name), head, data]);
    });
    const header = Buffer.alloc(12);
    header.writeUInt16BE(message.readUInt16BE(0), 0); header.writeUInt16BE(records ? 0x8180 : 0x8183, 2); header.writeUInt16BE(1, 4); header.writeUInt16BE(answers.length, 6);
    try { socket.send(Buffer.concat([header, message.subarray(12, offset + 4), ...answers]), peer.port, peer.address); } catch {}
  });
  await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
  socket.unref();
  return { servers: [`127.0.0.1:${socket.address().port}`], queries, close: () => new Promise(resolve => socket.close(resolve)) };
}
// 把「域名 → 地址列表」的表变成 fakeDns 的回答：IPv4 当 A、IPv6 当 AAAA；值可以是函数（每次查询都调用）。
export const fromTable = table => async (name, type) => {
  const entry = typeof table[name] === 'function' ? await table[name](type) : table[name];
  if (entry === 'hang' || entry === undefined || entry === null) return entry ?? null;
  return entry.map(value => typeof value === 'string' ? { type: value.includes(':') ? 'AAAA' : 'A', value } : value);
};

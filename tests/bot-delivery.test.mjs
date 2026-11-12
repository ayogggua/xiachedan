import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';
import { send, settle, startCloud, startLocal } from './helpers.mjs';
import { botCall, fakeDns, fromTable, receiver, verify, waitFor } from './bot-helpers.mjs';
import { Duplex } from 'node:stream';

const freePort = () => new Promise(resolve => { const probe = net.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
// 假的连接：建立后马上以给定的错误码失败，用来模拟拒绝连接、被重置、证书不对等情况。
const failingSocket = code => { const socket = new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } }); setImmediate(() => socket.destroy(Object.assign(new Error(code), { code }))); return socket; };

const created = events => events.filter(event => event?.type === 'message.created');
const botState = async (space, manager, id) => (await manager.get('/api/bots')).body.bots.find(bot => bot.id === id);

describe('机器人收消息（局域网）', () => {
  let space, alice, bob, group, rx, bot, secret, token, clock = null;
  before(async () => {
    rx = await receiver();
    space = await startLocal({ botOptions: { retryDelays: [30, 60], timeoutMs: 400, maxFailures: 2, now: () => clock ?? Date.now() } });
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    group = (await alice.post('/api/rooms', { name: '值班群', memberIds: [bob.id] })).body.id;
    const issued = await space.owner.post('/api/bots', { name: '助手', callbackUrl: rx.url });
    ({ bot, secret, token } = issued.body);
    await alice.post('/api/room-bots', { roomId: group, botId: bot.id, add: true });
  });
  after(async () => { await space.close(); await rx.close(); });

  test('群里默认只收 @它的消息；收到的事件带房间、发送人、@ 信息，并且签了名', async () => {
    await send(bob, group, '没有 @ 机器人');
    const sent = await send(bob, group, '@助手 帮我看看', { mentions: [bot.id] });
    const event = await waitFor(() => created(rx.events()).at(-1));
    await settle(80);
    assert.equal(created(rx.events()).length, 1, '没 @ 的消息、系统提示都不发');
    assert.equal(event.type, 'message.created');
    assert.equal(event.bot.id, bot.id);
    assert.deepEqual(event.room, { id: group, kind: 'group', name: '值班群' });
    assert.equal(event.message.id, sent.body.message.id);
    assert.equal(event.message.text, '@助手 帮我看看');
    assert.deepEqual(event.message.sender, { id: bob.id, name: 'Bob', bot: false });
    assert.equal(event.message.mentioned, true);
    assert.deepEqual(event.message.mentions, [bot.id]);
    assert.equal(event.message.kind, 'text');
    const request = rx.requests.at(-1);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['x-xiachedan-event'], 'message.created');
    assert.equal(request.headers['x-xiachedan-delivery'], event.id);
    assert.match(request.headers['content-type'], /application\/json/);
    assert.ok(verify(secret, request), '用密钥能验证签名');
    assert.ok(!verify('0'.repeat(64), request));
  });

  test('时间戳取自服务器时钟并参与签名，改了时间戳或正文签名就对不上', async () => {
    clock = Date.UTC(2026, 10, 12, 8, 0, 0);
    await send(bob, group, '@助手 几点了', { mentions: [bot.id] });
    const request = await waitFor(() => rx.requests.find(item => item.event?.message?.text === '@助手 几点了'));
    clock = null;
    assert.equal(request.headers['x-xiachedan-timestamp'], String(Date.UTC(2026, 10, 12, 8, 0, 0) / 1000));
    assert.equal(request.event.createdAt, Date.UTC(2026, 10, 12, 8, 0, 0));
    assert.ok(verify(secret, request));
    assert.ok(!verify(secret, { ...request, headers: { ...request.headers, 'x-xiachedan-timestamp': String(Number(request.headers['x-xiachedan-timestamp']) + 600) } }), '重放时改时间戳会失败');
    assert.ok(!verify(secret, { ...request, raw: request.raw.replace('几点了', '几点啦') }));
  });

  test('开了「接收全部消息」后群里的消息都收；附件只给名字、类型和大小，剧透原样给', async () => {
    await space.owner.post('/api/bots/update', { id: bot.id, receiveAll: true });
    rx.requests.length = 0;
    await send(bob, group, '大家好 ||谜底||');
    const event = await waitFor(() => created(rx.events()).at(-1));
    assert.equal(event.message.text, '大家好 ||谜底||');
    assert.equal(event.message.mentioned, false);
    assert.ok(!rx.events().some(item => item?.message?.sender?.id === 'system'), '系统提示不发给机器人');
    await space.owner.post('/api/bots/update', { id: bot.id, receiveAll: false });
  });

  test('私聊里收全部消息', async () => {
    const direct = (await alice.post('/api/rooms', { userId: bot.id })).body.id;
    rx.requests.length = 0;
    await send(alice, direct, '在吗');
    const event = await waitFor(() => created(rx.events()).at(-1));
    assert.equal(event.room.kind, 'direct');
    assert.equal(event.room.id, direct);
    assert.equal(event.message.text, '在吗');
    assert.deepEqual(event.message.sender, { id: alice.id, name: 'Alice', bot: false });
  });

  test('加入之前的消息收不到，引用了加入前的消息时只给标识', async () => {
    const later = (await alice.post('/api/rooms', { name: '后来的群', memberIds: [bob.id] })).body.id;
    const early = await send(alice, later, '加入前说的秘密');
    await alice.post('/api/room-bots', { roomId: later, botId: bot.id, add: true });
    rx.requests.length = 0;
    const reply = await send(bob, later, '@助手 你看上面', { mentions: [bot.id], replyTo: early.body.message.id });
    const event = await waitFor(() => created(rx.events()).at(-1));
    assert.equal(event.message.id, reply.body.message.id);
    assert.deepEqual(event.message.replyTo, { id: early.body.message.id, unavailable: true });
    assert.ok(!rx.requests.some(item => item.raw.includes('加入前说的秘密')));
    const second = await send(alice, later, '@助手 再看这条', { mentions: [bot.id], replyTo: reply.body.message.id, replyQuote: '你看上面' });
    const quoted = await waitFor(() => created(rx.events()).find(item => item.message.id === second.body.message.id));
    assert.deepEqual(quoted.message.replyTo, { id: reply.body.message.id, sender: { id: bob.id, name: 'Bob', bot: false }, text: '@助手 你看上面', quote: '你看上面' });
    // 移出之后不再收。
    await alice.post('/api/room-bots', { roomId: later, botId: bot.id, add: false });
    rx.requests.length = 0;
    await send(bob, later, '@助手 你还在吗');
    await settle(150);
    assert.equal(created(rx.events()).length, 0);
  });

  test('只把撤回、编辑通知给收到过原消息的机器人', async () => {
    rx.requests.length = 0;
    const mentioned = await send(bob, group, '@助手 原文', { mentions: [bot.id] });
    await waitFor(() => created(rx.events()).length === 1);
    await waitFor(async () => (await botState(space, space.owner, bot.id)).lastDeliveredAt);
    await bob.post('/api/edit-message', { messageId: mentioned.body.message.id, text: '@助手 改过的' });
    const edited = await waitFor(() => rx.events('message.edited')[0]);
    assert.equal(edited.message.id, mentioned.body.message.id);
    assert.equal(edited.message.text, '@助手 改过的');
    assert.ok(edited.message.editedAt);
    await bob.post('/api/recall-message', { messageId: mentioned.body.message.id });
    const recalled = await waitFor(() => rx.events('message.recalled')[0]);
    assert.deepEqual(recalled.message, { id: mentioned.body.message.id, seq: mentioned.body.message.seq });
    assert.equal(recalled.room.id, group);
    // 没发给它的消息，编辑、撤回也不通知。
    const quiet = await send(bob, group, '和机器人无关');
    await bob.post('/api/edit-message', { messageId: quiet.body.message.id, text: '还是无关' });
    await bob.post('/api/recall-message', { messageId: quiet.body.message.id });
    await settle(150);
    assert.equal(rx.events('message.edited').length, 1);
    assert.equal(rx.events('message.recalled').length, 1);
  });

  test('移出后再拉回来：重新加入之前的消息，编辑、撤回都不再通知', async () => {
    const room = (await alice.post('/api/rooms', { name: '回锅群', memberIds: [bob.id] })).body.id;
    await alice.post('/api/room-bots', { roomId: room, botId: bot.id, add: true });
    rx.requests.length = 0;
    const old = await send(bob, room, '@助手 第一次加入时的消息', { mentions: [bot.id] });
    await waitFor(() => created(rx.events()).some(event => event.message.id === old.body.message.id));
    await settle(50);
    await alice.post('/api/room-bots', { roomId: room, botId: bot.id, add: false });
    await alice.post('/api/room-bots', { roomId: room, botId: bot.id, add: true });
    await bob.post('/api/edit-message', { messageId: old.body.message.id, text: '@助手 改成了秘密' });
    const fresh = await send(bob, room, '@助手 重新加入之后', { mentions: [bot.id], replyTo: old.body.message.id });
    const event = await waitFor(() => created(rx.events()).find(item => item.message.id === fresh.body.message.id));
    assert.deepEqual(event.message.replyTo, { id: old.body.message.id, unavailable: true }, '引用旧消息也只给标识');
    await bob.post('/api/recall-message', { messageId: old.body.message.id });
    await bob.post('/api/edit-message', { messageId: fresh.body.message.id, text: '@助手 重新加入之后（改）' });
    await waitFor(() => rx.events('message.edited').some(item => item.message.id === fresh.body.message.id));
    await settle(150);
    assert.ok(!rx.events('message.edited').some(item => item.message.id === old.body.message.id), '旧消息的编辑没有发');
    assert.ok(!rx.events('message.recalled').some(item => item.message.id === old.body.message.id), '旧消息的撤回没有发');
    assert.ok(!rx.requests.some(item => item.raw.includes('改成了秘密')));
  });

  test('同一个机器人的事件按顺序送达', async () => {
    const slow = await receiver(async () => { await settle(Math.random() * 25); return { status: 200 }; });
    const ordered = (await space.owner.post('/api/bots', { name: '排队', callbackUrl: slow.url, receiveAll: true })).body.bot;
    await alice.post('/api/room-bots', { roomId: group, botId: ordered.id, add: true });
    const ids = [];
    for (let index = 0; index < 8; index++) ids.push((await send(bob, group, `第 ${index} 条`)).body.message.id);
    await waitFor(() => created(slow.events()).length === 8);
    assert.deepEqual(created(slow.events()).map(event => event.message.id), ids);
    await space.owner.post('/api/bots/delete', { id: ordered.id });
    await slow.close();
  });

  test('机器人和群机器人发的消息不会推给机器人（避免互相回复停不下来）', async () => {
    const other = await receiver();
    const listener = (await space.owner.post('/api/bots', { name: '旁听', callbackUrl: other.url, receiveAll: true })).body.bot;
    await alice.post('/api/room-bots', { roomId: group, botId: listener.id, add: true });
    assert.equal((await botCall(space.base, token, 'POST', '/api/bot/v1/messages', { roomId: group, text: '机器人说话' })).status, 201);
    const hook = await alice.post('/api/webhooks', { roomId: group, name: '告警' });
    await fetch(space.base + hook.body.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '告警来了' }) });
    await send(bob, group, '真人说话');
    await waitFor(() => created(other.events()).length >= 1);
    await settle(100);
    assert.deepEqual(created(other.events()).map(event => event.message.text), ['真人说话']);
    await space.owner.post('/api/bots/delete', { id: listener.id });
    await other.close();
  });

  test('失败会按退避重试，事件标识不变，每次重新签名', async () => {
    const flaky = await receiver((_entry, count) => ({ status: count <= 2 ? 503 : 200 }));
    const retrying = (await space.owner.post('/api/bots', { name: '重试', callbackUrl: flaky.url, receiveAll: true })).body;
    await alice.post('/api/room-bots', { roomId: group, botId: retrying.bot.id, add: true });
    await send(bob, group, '要重试的消息');
    await waitFor(() => flaky.requests.length === 3);
    assert.equal(new Set(flaky.requests.map(item => item.headers['x-xiachedan-delivery'])).size, 1);
    assert.ok(flaky.requests.every(item => verify(retrying.secret, item)));
    const state = await waitFor(async () => { const value = await botState(space, space.owner, retrying.bot.id); return value.lastDeliveredAt && value; });
    assert.equal(state.failures, 0);
    assert.equal(state.status, 'enabled');
    await space.owner.post('/api/bots/delete', { id: retrying.bot.id });
    await flaky.close();
  });

  test('连续失败后自动停用，管理者看得到原因；回应内容不会出现在错误里；重新启用后清零', async () => {
    const broken = await receiver(() => ({ status: 500, body: 'internal-secret-stack-trace' }));
    const failing = (await space.owner.post('/api/bots', { name: '坏的', callbackUrl: broken.url, receiveAll: true })).body.bot;
    await alice.post('/api/room-bots', { roomId: group, botId: failing.id, add: true });
    await send(bob, group, '第一条');
    await send(bob, group, '第二条');
    const state = await waitFor(async () => { const value = await botState(space, space.owner, failing.id); return value.status === 'failed' && value; });
    assert.match(state.lastError, /连续 2 次投递失败，已自动停用/);
    assert.match(state.lastError, /HTTP 500/);
    assert.ok(!state.lastError.includes('internal-secret'));
    assert.ok(state.lastErrorAt);
    assert.equal(broken.requests.length, 6, '每个事件 1 次 + 2 次重试');
    assert.equal((await alice.get('/api/state')).body.users.find(user => user.id === failing.id).bot.status, 'failed');
    assert.ok((await space.owner.get('/api/admin/audit')).body.entries.some(entry => entry.action === 'bot-auto-disable'));
    await send(bob, group, '停用后');
    await settle(150);
    assert.equal(broken.requests.length, 6);
    const enabled = await space.owner.post('/api/bots/status', { id: failing.id, enabled: true });
    assert.equal(enabled.body.bot.status, 'enabled');
    assert.equal(enabled.body.bot.failures, 0);
    await space.owner.post('/api/bots/delete', { id: failing.id });
    await broken.close();
  });

  test('不跟随重定向，也不重试', async () => {
    const elsewhere = await receiver();
    const redirect = await receiver(() => ({ status: 302, headers: { Location: elsewhere.url } }));
    const moved = (await space.owner.post('/api/bots', { name: '跳转', callbackUrl: redirect.url, receiveAll: true })).body.bot;
    await alice.post('/api/room-bots', { roomId: group, botId: moved.id, add: true });
    await send(bob, group, '会被重定向');
    const state = await waitFor(async () => { const value = await botState(space, space.owner, moved.id); return value.lastError && value; });
    assert.match(state.lastError, /重定向/);
    await settle(150);
    assert.equal(redirect.requests.length, 1);
    assert.equal(elsewhere.requests.length, 0);
    await space.owner.post('/api/bots/delete', { id: moved.id });
    await redirect.close(); await elsewhere.close();
  });

  test('回调超时算失败并重试；慢的回调不会拖慢发消息', async () => {
    const hanging = await receiver(() => ({ hang: true }));
    const slow = (await space.owner.post('/api/bots', { name: '很慢', callbackUrl: hanging.url, receiveAll: true })).body.bot;
    await alice.post('/api/room-bots', { roomId: group, botId: slow.id, add: true });
    const started = Date.now();
    const sent = await send(bob, group, '不能被拖住');
    assert.equal(sent.status, 201);
    assert.ok(Date.now() - started < 300, `发消息用了 ${Date.now() - started}ms`);
    const state = await waitFor(async () => { const value = await botState(space, space.owner, slow.id); return value.lastError && value; }, 4000);
    assert.match(state.lastError, /秒内没有完成/);
    assert.equal(hanging.requests.length, 3);
    await space.owner.post('/api/bots/delete', { id: slow.id });
    await hanging.close();
  });

  test('发送测试事件：只发一次，返回结果，不计入连续失败', async () => {
    rx.requests.length = 0;
    const ok = await space.owner.post('/api/bots/test', { id: bot.id });
    assert.equal(ok.body.ok, true);
    assert.equal(ok.body.status, 200);
    const request = rx.requests.at(-1);
    assert.equal(request.event.type, 'bot.test');
    assert.ok(verify(secret, request));
    const down = await receiver(() => ({ status: 404 }));
    const testing = (await space.owner.post('/api/bots', { name: '测试', callbackUrl: down.url })).body.bot;
    const failed = await space.owner.post('/api/bots/test', { id: testing.id });
    assert.equal(failed.body.ok, false);
    assert.match(failed.body.error, /HTTP 404/);
    assert.equal(failed.body.bot.failures, 0);
    assert.equal(down.requests.length, 1);
    assert.equal((await alice.post('/api/bots/test', { id: testing.id })).status, 403);
    // 局域网模式是自己的网络，错误照实说。
    const closed = (await space.owner.post('/api/bots', { name: '没开', callbackUrl: `http://127.0.0.1:${await freePort()}/` })).body.bot;
    assert.match((await space.owner.post('/api/bots/test', { id: closed.id })).body.error, /回调地址拒绝连接/);
    const empty = (await space.owner.post('/api/bots', { name: '无地址' })).body.bot;
    assert.equal((await space.owner.post('/api/bots/test', { id: empty.id })).status, 400);
    await down.close();
  });

  test('局域网模式：域名按解析结果连接（连的就是检查过的地址），本机和内网都可以', async () => {
    await space.close();
    const lookups = [];
    space = await startLocal({ botOptions: { lookup: async host => { lookups.push(host); return host === 'lan.test' ? [{ address: '127.0.0.1', family: 4 }] : []; } } });
    const issued = await space.owner.post('/api/bots', { name: '内网', callbackUrl: `http://lan.test:${rx.port}/hook` });
    rx.requests.length = 0;
    const result = await space.owner.post('/api/bots/test', { id: issued.body.bot.id });
    assert.equal(result.body.ok, true);
    assert.equal(rx.requests.at(-1).headers.host, `lan.test:${rx.port}`);
    assert.deepEqual(lookups, ['lan.test']);
  });
});

// 账号模式的解析走 c-ares：测试里起一个本机的 DNS 服务器（fakeDns），解析经过的是真实的 dns.Resolver。
describe('机器人收消息（账号模式的地址限制，经过真实的 c-ares 解析）', () => {
  let space, alice, group, rx, dns, connects;
  const PUBLIC = '93.184.216.34';
  const answers = {}, routes = {};
  before(async () => {
    rx = await receiver();
    dns = await fakeDns(fromTable(answers));
    connects = [];
    space = await startCloud({ botOptions: { retryDelays: [20], timeoutMs: 400, maxFailures: 5, log: () => {}, dnsServers: dns.servers,
      // 测试里的「公网地址」实际接到本机的接收端；记下要连的地址，确认连的是检查过的那个。
      connect: ({ ip, port }) => { connects.push({ ip, port }); return net.connect({ host: '127.0.0.1', port: routes[ip] || rx.port }); } } });
    alice = await space.member('Alice');
    const bob = await space.member('Bob');
    group = (await alice.post('/api/rooms', { name: '云上的群', memberIds: [bob.id] })).body.id;
  });
  after(async () => { await space.close(); await rx.close(); await dns.close(); });
  const makeBot = async (name, host, room = group) => {
    const issued = await space.admin.post('/api/bots', { name, callbackUrl: `http://${host}:8080/hook`, receiveAll: true });
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    await alice.post('/api/room-bots', { roomId: room, botId: issued.body.bot.id, add: true });
    return issued.body.bot;
  };
  const stateOf = async id => (await space.admin.get('/api/bots')).body.bots.find(item => item.id === id);
  const aQueries = host => dns.queries.filter(query => query.name === host && query.type === 'A').length;

  test('解析到公网地址时正常投递，A、AAAA 都查，连接的就是解析出的地址', async () => {
    answers['good.example'] = [PUBLIC];
    const bot = await makeBot('正常', 'good.example');
    rx.requests.length = 0; connects.length = 0;
    await send(alice, group, '你好云');
    await waitFor(() => created(rx.events()).length === 1);
    assert.deepEqual(connects, [{ ip: PUBLIC, port: 8080 }]);
    assert.equal(rx.requests[0].headers.host, 'good.example:8080');
    assert.deepEqual(dns.queries.filter(query => query.name === 'good.example').map(query => query.type).sort(), ['A', 'AAAA']);
    await space.admin.post('/api/bots/delete', { id: bot.id });
  });

  test('CNAME 跟到最后的地址再检查：指向内网的别名同样拒绝', async () => {
    answers['alias.example'] = [{ type: 'CNAME', value: 'inner.example' }, { type: 'A', name: 'inner.example', value: '10.1.2.3' }];
    const bot = await makeBot('别名', 'alias.example');
    connects.length = 0;
    assert.match((await space.admin.post('/api/bots/test', { id: bot.id })).body.error, /^回调地址不是公网地址/);
    assert.equal(connects.length, 0);
    await space.admin.post('/api/bots/delete', { id: bot.id });
  });

  test('域名解析到内网、本机、元数据或映射地址（A 或 AAAA）时拒绝投递，根本不建立连接', async () => {
    const cases = { 'intranet.example': '10.0.0.5', 'loop.example': '127.0.0.1', 'v6loop.example': '::1', 'mapped.example': '::ffff:127.0.0.1', 'meta.example': '169.254.169.254', 'nat64.example': '64:ff9b::a9fe:a9fe', 'ula.example': 'fd00:ec2::254' };
    for (const [host, address] of Object.entries(cases)) answers[host] = [address];
    // 混合：A 是公网、AAAA 是内网；或者两个 A 一个公网一个内网。
    answers['mixed.example'] = [PUBLIC, 'fd12::1'];
    answers['mixed4.example'] = [PUBLIC, '192.168.1.10'];
    const made = [];
    for (const host of [...Object.keys(cases), 'mixed.example', 'mixed4.example']) made.push([host, await makeBot(host.split('.')[0], host)]);
    connects.length = 0;
    await send(alice, group, '不能送到内网');
    for (const [host, bot] of made) {
      const state = await waitFor(async () => { const value = await stateOf(bot.id); return value.lastError && value; });
      assert.match(state.lastError, /^回调地址不是公网地址，不能投递$/, host);
    }
    assert.equal(connects.length, 0, JSON.stringify(connects));
    for (const [, bot] of made) await space.admin.post('/api/bots/delete', { id: bot.id });
  });

  test('DNS 重绑定：第一次解析到公网、第二次解析到本机时，第二次不会连到本机', async () => {
    let calls = 0;
    answers['rebind.example'] = type => type === 'AAAA' ? [] : ++calls === 1 ? [PUBLIC] : ['127.0.0.1'];
    const bot = await makeBot('重绑定', 'rebind.example');
    connects.length = 0;
    assert.equal((await space.admin.post('/api/bots/test', { id: bot.id })).body.ok, true);
    assert.deepEqual(connects, [{ ip: PUBLIC, port: 8080 }]);
    const second = await space.admin.post('/api/bots/test', { id: bot.id });
    assert.equal(second.body.ok, false);
    assert.match(second.body.error, /不是公网地址/);
    assert.equal(connects.length, 1, '第二次没有建立任何连接');
    assert.equal(aQueries('rebind.example'), 2, '每次投递只解析一次，连的就是这次检查过的地址');
    await space.admin.post('/api/bots/delete', { id: bot.id });
  });

  test('不跟随重定向：对方回 302 指向本机也不会去连', async () => {
    const elsewhere = await receiver();
    const redirect = await receiver(() => ({ status: 302, headers: { Location: elsewhere.url } }));
    answers['moved.example'] = ['93.184.216.35'];
    routes['93.184.216.35'] = redirect.port;
    const bot = await makeBot('跳转', 'moved.example');
    connects.length = 0;
    const result = await space.admin.post('/api/bots/test', { id: bot.id });
    assert.equal(result.body.error, '对方返回 HTTP 302（不跟随重定向）');
    assert.deepEqual(connects, [{ ip: '93.184.216.35', port: 8080 }]);
    assert.equal(redirect.requests.length, 1);
    assert.equal(elsewhere.requests.length, 0);
    await space.admin.post('/api/bots/delete', { id: bot.id });
    await redirect.close(); await elsewhere.close();
  });

  test('域名解析也算在超时里：解析卡住时到点就失败，之后才回来的应答也不会让它再去连接', async () => {
    let answered = 0;
    answers['stuck.example'] = () => new Promise(resolve => setTimeout(() => { answered++; resolve([PUBLIC]); }, 900));
    const bot = await makeBot('卡住', 'stuck.example');
    connects.length = 0;
    const started = Date.now();
    const result = await space.admin.post('/api/bots/test', { id: bot.id });
    const took = Date.now() - started;
    assert.equal(result.body.ok, false);
    assert.match(result.body.error, /秒内没有完成/);
    assert.ok(took < 800, `测试事件用了 ${took}ms，超时是 400ms`);
    await waitFor(() => answered >= 1, 3000);
    await settle(150);
    assert.equal(connects.length, 0, '应答晚到之后也没有建立连接');
    await space.admin.post('/api/bots/delete', { id: bot.id });
  });

  test('挂住的解析不占线程池：多个机器人的域名一直不回应时，别的机器人照常收到，登录也不受影响', async () => {
    const hung = [];
    for (let index = 0; index < 6; index++) { answers[`hang${index}.example`] = 'hang'; hung.push(await makeBot(`挂住${index}`, `hang${index}.example`)); }
    answers['fine.example'] = [PUBLIC];
    const fine = await makeBot('照常', 'fine.example');
    rx.requests.length = 0;
    const texts = ['一', '二', '三', '四', '五'];
    for (const text of texts) await send(alice, group, text);
    // 同时用掉线程池：登录要算 scrypt。
    const started = Date.now();
    const login = await space.client().post('/api/auth/login', { identifier: '19977167586', password: 'Admin-pass-2026' });
    assert.equal(login.status, 200);
    assert.ok(Date.now() - started < 1500, `登录用了 ${Date.now() - started}ms`);
    await waitFor(() => created(rx.events()).filter(event => texts.includes(event.message.text)).length === 5, 5000);
    const state = await stateOf(fine.id);
    assert.equal(state.status, 'enabled');
    assert.equal(state.failures, 0);
    for (const bot of [...hung, fine]) await space.admin.post('/api/bots/delete', { id: bot.id });
  });

  test('解析不了的域名算可重试的失败', async () => {
    const bot = await makeBot('查无此址', 'nowhere.example');
    const result = await space.admin.post('/api/bots/test', { id: bot.id });
    assert.equal(result.body.ok, false);
    assert.match(result.body.error, /无法解析/);
    await space.admin.post('/api/bots/delete', { id: bot.id });
  });
});

// 正常负载（没有任何攻击）不能丢事件：每次投递都要现解析域名，c-ares 的查询彼此独立、不排队。
describe('账号模式的正常负载', () => {
  let space, alice, rx, dns;
  const PUBLIC = '93.184.216.34';
  const answers = {};
  before(async () => {
    rx = await receiver();
    dns = await fakeDns(fromTable(answers));
    space = await startCloud({ botOptions: { log: () => {}, dnsServers: dns.servers, connect: () => net.connect({ host: '127.0.0.1', port: rx.port }) } });
    alice = await space.member('Alice');
  });
  after(async () => { await space.close(); await rx.close(); await dns.close(); });
  const makeBot = async (name, host, room) => {
    const issued = await space.admin.post('/api/bots', { name, callbackUrl: `http://${host}:8080/hook`, receiveAll: true });
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    await alice.post('/api/room-bots', { roomId: room, botId: issued.body.bot.id, add: true });
    return issued.body.bot;
  };
  const stateOf = async id => (await space.admin.get('/api/bots')).body.bots.find(item => item.id === id);

  test('正常负载不丢事件：10 个「接收全部」机器人各用自己的域名、解析要 300ms，连发 20 条全部送到', async () => {
    const room = (await alice.post('/api/rooms', { name: '压测群', memberIds: [(await space.member('Carol')).id] })).body.id;
    const bots = [];
    for (let index = 0; index < 10; index++) {
      answers[`load${index}.example`] = () => new Promise(resolve => setTimeout(() => resolve([PUBLIC]), 300));
      bots.push(await makeBot(`负载${index}`, `load${index}.example`, room));
    }
    rx.requests.length = 0;
    for (let index = 0; index < 20; index++) await send(alice, room, `第 ${index} 条`);
    await waitFor(() => created(rx.events()).filter(event => event.room.id === room).length === 200, 30000);
    const states = await Promise.all(bots.map(bot => stateOf(bot.id)));
    assert.ok(states.every(state => state.status === 'enabled' && !state.lastError), JSON.stringify(states.map(state => state.lastError)));
    for (const bot of bots) await space.admin.post('/api/bots/delete', { id: bot.id });
  });

});

// 账号模式里一族地址先回、另一族挂住或晚到时，投递在宽限后照常进行；晚到的内网地址照样拦下。
describe('账号模式：A、AAAA 一族先回', () => {
  let space, rx, dns, connects = [];
  const answers = {};
  before(async () => {
    rx = await receiver();
    dns = await fakeDns(fromTable(answers));
    space = await startCloud({ botOptions: { log: () => {}, dnsServers: dns.servers, connect: ({ ip, port }) => { connects.push(ip); return net.connect({ host: '127.0.0.1', port: rx.port }); } } });
  });
  after(async () => { await space.close(); await rx.close(); await dns.close(); });
  const testEvent = async host => {
    const bot = (await space.admin.post('/api/bots', { name: host.split('.')[0], callbackUrl: `http://${host}/hook` })).body.bot;
    const started = Date.now();
    const result = await space.admin.post('/api/bots/test', { id: bot.id });
    return { ...result.body, took: Date.now() - started };
  };

  test('AAAA 不回应、A 正常：发送测试事件在宽限后成功，远小于 5 秒', async () => {
    answers['v4only.example'] = type => type === 'A' ? ['93.184.216.34'] : 'hang';
    const result = await testEvent('v4only.example');
    assert.equal(result.ok, true, result.error);
    assert.ok(result.took < 1500, `${result.took}ms`);
    assert.equal(connects.at(-1), '93.184.216.34');
  });

  test('A 公网立刻返回、AAAA 内网在宽限期内返回：拒绝投递、不建立连接', async () => {
    answers['mix.example'] = type => type === 'A' ? ['93.184.216.34'] : new Promise(resolve => setTimeout(() => resolve(['::ffff:10.0.0.1']), 150));
    const before = connects.length;
    const result = await testEvent('mix.example');
    assert.equal(result.error, '回调地址不是公网地址，不能投递');
    assert.equal(connects.length, before);
  });

  test('AAAA 公网先回、A 内网在宽限期内返回：同样拒绝', async () => {
    answers['mix6.example'] = type => type === 'AAAA' ? ['2606:4700::1111'] : new Promise(resolve => setTimeout(() => resolve(['169.254.169.254']), 150));
    const before = connects.length;
    const result = await testEvent('mix6.example');
    assert.equal(result.error, '回调地址不是公网地址，不能投递');
    assert.equal(connects.length, before);
  });
});

// 局域网模式的解析走 getaddrinfo（这里用 lookup 替换成可控的假实现），同时最多 2 个，多的排队、同名共用。
describe('局域网模式的域名解析排队', () => {
  let space, alice, group, rx, calls, gates;
  const hold = host => new Promise(resolve => gates.push({ host, release: () => resolve([{ address: '127.0.0.1', family: 4 }]) }));
  const release = host => { for (const gate of gates.filter(item => !host || item.host === host)) { gate.release(); gates.splice(gates.indexOf(gate), 1); } };
  let behavior = {};
  before(async () => {
    rx = await receiver();
    calls = []; gates = [];
    space = await startLocal({ botOptions: { retryDelays: [20, 40], timeoutMs: 600, maxFailures: 2,
      lookup: async host => { calls.push(host); const answer = behavior[host]; return typeof answer === 'function' ? answer(host) : [{ address: '127.0.0.1', family: 4 }]; } } });
    alice = await space.join('Alice');
    const bob = await space.join('Bob');
    group = (await alice.post('/api/rooms', { name: '内网群', memberIds: [bob.id] })).body.id;
  });
  after(async () => { release(); await space.close(); await rx.close(); });
  const makeBot = async (name, host, room = group) => {
    const issued = await space.owner.post('/api/bots', { name, callbackUrl: `http://${host}:${rx.port}/hook`, receiveAll: true });
    await alice.post('/api/room-bots', { roomId: room, botId: issued.body.bot.id, add: true });
    return issued.body.bot;
  };
  const stateOf = async id => (await space.owner.get('/api/bots')).body.bots.find(item => item.id === id);

  test('名额被占满时排队等，名额空出来就接着解析、照常送到', async () => {
    behavior = { 'slow1.lan': hold, 'slow2.lan': hold };
    const slow = [await makeBot('慢一', 'slow1.lan'), await makeBot('慢二', 'slow2.lan')];
    const quick = await makeBot('快', 'quick.lan');
    rx.requests.length = 0;
    await send(alice, group, '排队的消息');
    await waitFor(() => calls.includes('slow1.lan') && calls.includes('slow2.lan'));
    await settle(150);
    assert.ok(!calls.includes('quick.lan'), '名额满了，快的还在排队');
    release('slow1.lan');
    await waitFor(() => rx.requests.some(item => item.headers.host.startsWith('quick.lan') && item.event?.message?.text === '排队的消息'));
    release();
    for (const bot of [...slow, quick]) await space.owner.post('/api/bots/delete', { id: bot.id });
  });

  test('别的域名挂住、名额一直被占：排不上队的投递重试，但不算连续失败，不会被自动停用', async () => {
    behavior = { 'stuck1.lan': hold, 'stuck2.lan': hold };
    const stuck = [await makeBot('挂一', 'stuck1.lan'), await makeBot('挂二', 'stuck2.lan')];
    const normal = await makeBot('正常', 'normal.lan');
    await send(alice, group, '第一条');
    await send(alice, group, '第二条');
    await send(alice, group, '第三条');
    const state = await waitFor(async () => { const value = await stateOf(normal.id); return /没排上/.test(value.lastError || '') && value; }, 6000);
    // 三条都排不上（每条 1 次 + 2 次重试），连续失败上限是 2，仍然启用着。
    await settle(4500);
    const after = await stateOf(normal.id);
    assert.equal(after.status, 'enabled');
    assert.equal(after.failures, 0);
    assert.match(after.lastError, /等待域名解析的投递太多，这次没排上/);
    assert.ok(state.lastErrorAt);
    // 挂住的那两个是自己的域名有问题，照常算失败、自动停用。
    assert.ok((await Promise.all(stuck.map(bot => stateOf(bot.id)))).every(value => value.status === 'failed'));
    release();
    rx.requests.length = 0;
    await send(alice, group, '名额空出来以后');
    await waitFor(() => rx.requests.some(item => item.headers.host.startsWith('normal.lan') && item.event?.message?.text === '名额空出来以后'));
    for (const bot of [...stuck, normal]) await space.owner.post('/api/bots/delete', { id: bot.id });
  });

  test('同一个域名正在解析时，后来的共用那一次结果，不另占名额', async () => {
    calls.length = 0;
    behavior = { 'shared.lan': hold };
    const bot = (await space.owner.post('/api/bots', { name: '共用', callbackUrl: `http://shared.lan:${rx.port}/hook` })).body.bot;
    const results = Promise.all([1, 2, 3].map(() => space.owner.post('/api/bots/test', { id: bot.id })));
    await settle(150);
    assert.deepEqual(calls, ['shared.lan']);
    release('shared.lan');
    assert.ok((await results).every(result => result.body.ok), '三次都用上了同一次解析的结果');
    assert.deepEqual(calls, ['shared.lan']);
    await space.owner.post('/api/bots/delete', { id: bot.id });
  });

  test('解析已经开始但过了截止时间：算超时，结果晚到也不再连接', async () => {
    calls.length = 0;
    behavior = { 'late.lan': host => new Promise(resolve => setTimeout(() => resolve([{ address: '127.0.0.1', family: 4 }]), 900)) };
    const bot = (await space.owner.post('/api/bots', { name: '晚到', callbackUrl: `http://late.lan:${rx.port}/hook` })).body.bot;
    rx.requests.length = 0;
    const result = await space.owner.post('/api/bots/test', { id: bot.id });
    assert.match(result.body.error, /秒内没有完成/);
    await settle(500);
    assert.equal(rx.requests.length, 0);
    await space.owner.post('/api/bots/delete', { id: bot.id });
  });

  test('正常负载不丢事件：10 个机器人各用自己的域名（解析 50ms），连发 20 条全部送到', async () => {
    behavior = {};
    for (let index = 0; index < 10; index++) behavior[`load${index}.lan`] = () => new Promise(resolve => setTimeout(() => resolve([{ address: '127.0.0.1', family: 4 }]), 50));
    const room = (await alice.post('/api/rooms', { name: '压测', memberIds: [(await space.join('Carol')).id] })).body.id;
    const bots = [];
    for (let index = 0; index < 10; index++) bots.push(await makeBot(`负载${index}`, `load${index}.lan`, room));
    rx.requests.length = 0;
    for (let index = 0; index < 20; index++) await send(alice, room, `第 ${index} 条`);
    await waitFor(() => created(rx.events()).filter(event => event.room.id === room).length === 200, 30000);
    const states = await Promise.all(bots.map(bot => stateOf(bot.id)));
    assert.ok(states.every(state => state.status === 'enabled' && !state.lastError), JSON.stringify(states.map(state => state.lastError)));
  });
});

describe('账号模式下回调失败的说法', () => {
  let space, logged = [], connectWith = null, garbage, probeDns;
  before(async () => {
    probeDns = await fakeDns(async () => [{ type: 'A', value: '93.184.216.34' }]);
    garbage = net.createServer(socket => socket.end('SSH-2.0-OpenSSH_9.6\r\n'));
    await new Promise(resolve => garbage.listen(0, '127.0.0.1', resolve));
    space = await startCloud({ botOptions: { timeoutMs: 400, retryDelays: [], log: entry => logged.push(entry),
      dnsServers: probeDns.servers, connect: options => connectWith(options) } });
  });
  after(async () => { await space.close(); garbage.close(); await probeDns.close(); });

  test('只给几类笼统的原因，不带错误码；细节写进服务器日志', async () => {
    const bot = (await space.admin.post('/api/bots', { name: '探测', callbackUrl: 'http://probe.example:22/' })).body.bot;
    const cases = [
      ['ECONNREFUSED', () => failingSocket('ECONNREFUSED'), '无法连接回调地址'],
      ['ECONNRESET', () => failingSocket('ECONNRESET'), '无法连接回调地址'],
      ['EHOSTUNREACH', () => failingSocket('EHOSTUNREACH'), '无法连接回调地址'],
      ['HPE_', () => net.connect({ host: '127.0.0.1', port: garbage.address().port }), '无法连接回调地址'],
      ['DEPTH_ZERO_SELF_SIGNED_CERT', () => failingSocket('DEPTH_ZERO_SELF_SIGNED_CERT'), '证书校验失败'],
      ['ERR_TLS_CERT_ALTNAME_INVALID', () => failingSocket('ERR_TLS_CERT_ALTNAME_INVALID'), '证书校验失败'],
      ['EPROTO', () => failingSocket('EPROTO'), '无法连接回调地址'],
    ];
    for (const [code, connect, message] of cases) {
      connectWith = connect;
      const result = await space.admin.post('/api/bots/test', { id: bot.id });
      assert.equal(result.body.error, message, code);
      assert.ok(!/[A-Z_]{4,}/.test(result.body.lastError || result.body.bot.lastError), result.body.bot.lastError);
      assert.ok(logged.at(-1).detail.startsWith(code), JSON.stringify(logged.at(-1)));
      assert.equal(logged.at(-1).host, 'probe.example:22');
    }
    connectWith = () => new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } });
    assert.match((await space.admin.post('/api/bots/test', { id: bot.id })).body.error, /^回调地址 1 秒内没有完成/);
  });

  test('端口 0 不能用，其余端口照常', async () => {
    assert.equal((await space.admin.post('/api/bots', { name: 'x', callbackUrl: 'http://bots.example.com:0/' })).status, 400);
    for (const port of [22, 8080, 65535]) assert.equal((await space.admin.post('/api/bots', { name: `p${port}`, callbackUrl: `http://bots.example.com:${port}/` })).status, 201);
  });
});

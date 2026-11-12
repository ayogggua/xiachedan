import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startCloud, startLocal } from './helpers.mjs';
import { botCall } from './bot-helpers.mjs';

const post = (space, token, body) => botCall(space.base, token, 'POST', '/api/bot/v1/messages', body);
const messagesOf = async (member, roomId) => (await member.get(`/api/messages?roomId=${encodeURIComponent(roomId)}`)).body.messages;

for (const mode of ['local', 'cloud']) describe(`机器人发消息接口（${mode === 'local' ? '局域网' : '账号模式'}）`, () => {
  let space, manager, alice, bob, carol, group, other, bot, token;
  before(async () => {
    if (mode === 'local') {
      space = await startLocal();
      manager = space.owner;
      [alice, bob, carol] = [await space.join('Alice'), await space.join('Bob'), await space.join('Carol')];
    } else {
      space = await startCloud();
      manager = space.admin;
      [alice, bob, carol] = [await space.member('Alice'), await space.member('Bob'), await space.member('Carol')];
    }
    group = (await alice.post('/api/rooms', { name: '值班群', memberIds: [bob.id] })).body.id;
    other = (await carol.post('/api/rooms', { name: '别的群', memberIds: [bob.id] })).body.id;
    ({ bot: { id: bot }, token } = (await manager.post('/api/bots', { name: '助手' })).body);
    await alice.post('/api/room-bots', { roomId: group, botId: bot, add: true });
  });
  after(() => space.close());

  test('令牌能查到自己在哪些会话里', async () => {
    const me = await botCall(space.base, token, 'GET', '/api/bot/v1/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.bot.id, bot);
    assert.deepEqual(me.body.rooms.map(room => room.id), [group]);
  });

  test('往所在的群发消息，成员实时收到，发送人是机器人', async () => {
    const live = await listen(space.base, bob);
    const sent = await post(space, token, { roomId: group, text: '大家好，我是助手' });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.roomId, group);
    await settle();
    const event = live.events.find(item => item.type === 'message' && item.message.id === sent.body.message.id);
    assert.equal(event.message.senderId, bot);
    assert.equal(event.message.bot, null, '不是 Webhook 群机器人，名字从成员资料里取');
    live.close();
    assert.equal((await messagesOf(alice, group)).at(-1).text, '大家好，我是助手');
  });

  test('不在的会话、不存在的会话都发不了', async () => {
    assert.equal((await post(space, token, { roomId: other, text: 'x' })).status, 403);
    assert.equal((await post(space, token, { roomId: 'lobby', text: 'x' })).status, 403);
    assert.equal((await post(space, token, { roomId: 'nope', text: 'x' })).status, 403);
    assert.equal((await post(space, token, { text: 'x' })).status, 403);
  });

  test('私聊：只有用户和它开过的私聊能发；对方离开空间后不能再发', async () => {
    const direct = (await carol.post('/api/rooms', { userId: bot })).body.id;
    assert.equal((await post(space, token, { roomId: direct, text: '你好 Carol' })).status, 201);
    assert.equal((await messagesOf(carol, direct)).at(-1).senderId, bot);
    const me = await botCall(space.base, token, 'GET', '/api/bot/v1/me');
    assert.deepEqual(me.body.rooms.find(room => room.id === direct).user, { id: carol.id, name: 'Carol', bot: false });
    // 两个人之间的私聊它进不去。
    const between = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
    assert.equal((await post(space, token, { roomId: between, text: '偷看' })).status, 403);
    if (mode === 'local') await space.owner.post('/api/remove-member', { userId: carol.id });
    else await space.admin.post('/api/admin/review', { userId: carol.id, status: 'suspended' });
    assert.equal((await post(space, token, { roomId: direct, text: '还在吗' })).status, 403);
  });

  test('内容限制和成员一样；不能带附件、不能阅后即焚、不能进话题', async () => {
    assert.equal((await post(space, token, { roomId: group, text: '   ' })).status, 400);
    assert.equal((await post(space, token, { roomId: group, text: 'x'.repeat(10001) })).status, 400);
    assert.equal((await post(space, token, { roomId: group, text: 'x'.repeat(10000) })).status, 201);
    assert.equal((await post(space, token, { roomId: group, text: 123 })).status, 400);
    assert.equal((await post(space, token, { roomId: group, text: '带附件', attachmentIds: ['a'] })).status, 400);
    assert.equal((await post(space, token, { roomId: group, text: '焚', burn: 5 })).status, 400);
    const root = await send(alice, group, '话题根');
    assert.equal((await post(space, token, { roomId: group, text: '话题', threadOf: root.body.message.id })).status, 400);
  });

  test('@成员：正文里要写着名字，只能 @会话里的人，不能 @所有人', async () => {
    const ok = await post(space, token, { roomId: group, text: '@Alice 请看', mentions: [alice.id] });
    assert.equal(ok.status, 201);
    assert.deepEqual((await messagesOf(bob, group)).find(message => message.id === ok.body.message.id).mentions, [alice.id]);
    assert.equal((await post(space, token, { roomId: group, text: '请看', mentions: [alice.id] })).status, 400);
    assert.equal((await post(space, token, { roomId: group, text: '@Carol 你好', mentions: [carol.id] })).status, 400);
    assert.equal((await post(space, token, { roomId: group, text: '@所有人 开会', mentions: ['*'] })).status, 403);
    assert.equal((await post(space, token, { roomId: group, text: '@助手', mentions: [bot] })).status, 400);
    assert.equal((await post(space, token, { roomId: group, text: 'x', mentions: 'Alice' })).status, 400);
    const unread = (await alice.post('/api/unread-counts', { cursors: { [group]: 0 } })).body.rooms.find(room => room.id === group);
    assert.ok(unread.mentionCount >= 1, '被机器人 @ 的人也有提醒');
  });

  test('引用：只能引用同一会话里、它加入之后的消息', async () => {
    const target = await send(bob, group, '@助手 这条怎么办', { mentions: [bot] });
    const replied = await post(space, token, { roomId: group, text: '这样办', replyTo: target.body.message.id });
    assert.equal(replied.status, 201);
    assert.equal((await messagesOf(alice, group)).find(message => message.id === replied.body.message.id).replyTo.id, target.body.message.id);
    const elsewhere = await send(bob, other, '别的群');
    assert.equal((await post(space, token, { roomId: group, text: 'x', replyTo: elsewhere.body.message.id })).status, 400);
    assert.equal((await post(space, token, { roomId: group, text: 'x', replyTo: 'missing' })).status, 400);
    // 加入之前的消息不能引用。
    const later = (await alice.post('/api/rooms', { name: '后来', memberIds: [bob.id] })).body.id;
    const early = await send(alice, later, '加入之前');
    await alice.post('/api/room-bots', { roomId: later, botId: bot, add: true });
    assert.equal((await post(space, token, { roomId: later, text: 'x', replyTo: early.body.message.id })).status, 400);
    // 系统提示也不能引用。
    const notice = (await messagesOf(alice, later)).at(-1);
    assert.ok(notice.notice);
    assert.equal((await post(space, token, { roomId: later, text: 'x', replyTo: notice.id })).status, 400);
  });

  test('clientId 去重：同一个 clientId 只发一次', async () => {
    const first = await post(space, token, { roomId: group, text: '只发一次', clientId: 'job-42' });
    const again = await post(space, token, { roomId: group, text: '只发一次', clientId: 'job-42' });
    assert.equal(first.status, 201);
    assert.equal(again.status, 200);
    assert.equal(again.body.message.id, first.body.message.id);
    assert.equal((await post(space, token, { roomId: group, text: 'x', clientId: 'x'.repeat(81) })).status, 400);
  });

  test('全员禁言时机器人也不能发', async () => {
    await alice.post('/api/room-policy', { roomId: group, allMuted: true });
    assert.equal((await post(space, token, { roomId: group, text: '禁言中' })).status, 403);
    await alice.post('/api/room-policy', { roomId: group, allMuted: false });
    assert.equal((await post(space, token, { roomId: group, text: '解除了' })).status, 201);
  });

  test('令牌：格式不对、内容不对都是 401；重置后旧令牌失效；停用 403；删除后 401', async () => {
    assert.equal((await post(space, null, { roomId: group, text: 'x' })).status, 401);
    assert.equal((await post(space, 'nonsense', { roomId: group, text: 'x' })).status, 401);
    const [id, secret] = token.split('.');
    const flipped = `${id}.${secret.slice(0, -1)}${secret.at(-1) === '0' ? '1' : '0'}`;
    assert.equal((await post(space, flipped, { roomId: group, text: 'x' })).status, 401, '同样长度、只差一位');
    assert.equal((await post(space, `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.${secret}`, { roomId: group, text: 'x' })).status, 401);
    const reset = await manager.post('/api/bots/reset', { id: bot });
    assert.equal((await post(space, token, { roomId: group, text: '旧令牌' })).status, 401);
    token = reset.body.token;
    assert.equal((await post(space, token, { roomId: group, text: '新令牌' })).status, 201);
    await manager.post('/api/bots/status', { id: bot, enabled: false });
    assert.equal((await post(space, token, { roomId: group, text: '停用了' })).status, 403);
    assert.equal((await botCall(space.base, token, 'GET', '/api/bot/v1/me')).status, 403);
    await manager.post('/api/bots/status', { id: bot, enabled: true });
    const doomed = (await manager.post('/api/bots', { name: '要删的' })).body;
    await alice.post('/api/room-bots', { roomId: group, botId: doomed.bot.id, add: true });
    assert.equal((await post(space, doomed.token, { roomId: group, text: '删之前' })).status, 201);
    await manager.post('/api/bots/delete', { id: doomed.bot.id });
    assert.equal((await post(space, doomed.token, { roomId: group, text: '删之后' })).status, 401);
  });

  test('成员的登录凭证调不了机器人接口，机器人令牌也调不了成员接口', async () => {
    const cookie = [...alice.jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const viaCookie = await fetch(`${space.base}/api/bot/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie, 'X-Linliao': '1' }, body: JSON.stringify({ roomId: group, text: 'x' }) });
    assert.equal(viaCookie.status, 401);
    for (const [method, path, body] of [['GET', '/api/state'], ['GET', `/api/messages?roomId=${group}`], ['POST', '/api/messages', { roomId: group, text: 'x', clientId: 'c1' }], ['GET', '/api/bots'], ['POST', '/api/room-bots', { roomId: group, botId: bot, add: false }]]) {
      const response = await fetch(space.base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Linliao': '1' }, body: body && JSON.stringify(body) });
      assert.equal(response.status, 401, path);
    }
  });

  test('浏览器跨站调用不受信任（账号模式下检查来源）', { skip: mode === 'local' }, async () => {
    const response = await fetch(`${space.base}/api/bot/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: 'https://evil.example' }, body: JSON.stringify({ roomId: group, text: 'x' }) });
    assert.equal(response.status, 403);
  });

  test('每个机器人每分钟最多发 60 条', async () => {
    const room = (await alice.post('/api/rooms', { name: '刷屏', memberIds: [bob.id] })).body.id;
    await alice.post('/api/room-bots', { roomId: room, botId: bot, add: true });
    const fresh = (await manager.post('/api/bots', { name: '刷屏机' })).body;
    await alice.post('/api/room-bots', { roomId: room, botId: fresh.bot.id, add: true });
    const results = [];
    for (let index = 0; index < 61; index++) results.push((await post(space, fresh.token, { roomId: room, text: `第 ${index} 条` })).status);
    assert.equal(results.filter(status => status === 201).length, 60);
    assert.equal(results.at(-1), 429);
  });
});

describe('机器人发消息的限流按滑动窗口算', () => {
  let space, clock = Date.UTC(2026, 10, 12, 9, 0, 0);
  before(async () => { space = await startLocal({ botOptions: { now: () => clock } }); });
  after(() => space.close());

  test('任意 60 秒里最多 60 条，整分钟交界处也不能连发', async () => {
    const alice = await space.join('Alice');
    const room = (await alice.post('/api/rooms', { name: '刷屏', memberIds: [space.ownerId] })).body.id;
    const made = (await space.owner.post('/api/bots', { name: '刷屏机' })).body;
    await alice.post('/api/room-bots', { roomId: room, botId: made.bot.id, add: true });
    const burst = async count => { const statuses = []; for (let index = 0; index < count; index++) statuses.push((await post(space, made.token, { roomId: room, text: `x${clock}-${index}` })).status); return statuses; };
    // 第一分钟的最后一秒发 30 条，跨过整分钟后马上再发：只剩 30 条额度。
    clock += 59000;
    assert.deepEqual(await burst(30), Array(30).fill(201));
    clock += 1500;
    const crossing = await burst(31);
    assert.equal(crossing.filter(status => status === 201).length, 30);
    assert.equal(crossing.at(-1), 429);
    // 最早那 30 条满一分钟之后，又能发 30 条。
    clock += 58600;
    const later = await burst(31);
    assert.equal(later.filter(status => status === 201).length, 30);
    assert.equal(later.at(-1), 429);
  });
});

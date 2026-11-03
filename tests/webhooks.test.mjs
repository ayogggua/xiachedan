import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startCloud, startLocal } from './helpers.mjs';

const hook = (space, path, body, headers = {}) => fetch(space.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  .then(async response => ({ status: response.status, body: await response.json() }));

describe('群机器人', () => {
  let space, alice, bob, carol, group, direct;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '值班群', memberIds: [bob.id] })).body.id;
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
  });
  after(() => space.close());

  test('群主创建机器人，外部系统凭地址发消息，成员实时收到并带机器人名字', async () => {
    const created = await alice.post('/api/webhooks', { roomId: group, name: '告警' });
    assert.equal(created.status, 201);
    assert.match(created.body.path, /^\/api\/hooks\/[0-9a-f-]+\/[0-9a-f]{48}$/);
    const live = await listen(space.base, bob);
    const sent = await hook(space, created.body.path, { text: '磁盘使用率 92%' });
    assert.equal(sent.status, 201);
    await settle();
    const event = live.events.find(item => item.type === 'message');
    assert.equal(event.message.bot, '告警');
    assert.equal(event.message.senderId, `webhook:${created.body.webhook.id}`);
    live.close();
    const messages = (await bob.get(`/api/messages?roomId=${group}`)).body.messages;
    assert.equal(messages.at(-1).text, '磁盘使用率 92%');
    assert.equal(messages.at(-1).bot, '告警');
  });

  test('机器人消息计入未读，不在群里的人看不到', async () => {
    const counts = (await bob.post('/api/unread-counts', { cursors: { [group]: 0 } })).body.rooms.find(room => room.id === group);
    assert.ok(counts.unreadCount >= 1);
    assert.equal((await carol.get(`/api/messages?roomId=${group}`)).status, 403);
  });

  test('地址或令牌不对、内容为空或过长都会被拒绝', async () => {
    const { body } = await alice.post('/api/webhooks', { roomId: group, name: '构建' });
    const wrong = body.path.replace(/[0-9a-f]{48}$/, '0'.repeat(48));
    assert.equal((await hook(space, wrong, { text: 'x' })).status, 404);
    assert.equal((await hook(space, `/api/hooks/nope/${'0'.repeat(48)}`, { text: 'x' })).status, 404);
    assert.equal((await hook(space, body.path, { text: '  ' })).status, 400);
    assert.equal((await hook(space, body.path, { text: 'x'.repeat(4001) })).status, 400);
  });

  test('重置后旧地址失效，删除后地址不可用但已发的消息仍显示名字', async () => {
    const { body } = await alice.post('/api/webhooks', { roomId: group, name: '日报' });
    assert.equal((await hook(space, body.path, { text: '今日完成 3 项' })).status, 201);
    const reset = await alice.post('/api/webhooks/reset', { id: body.webhook.id });
    assert.equal((await hook(space, body.path, { text: '旧地址' })).status, 404);
    assert.equal((await hook(space, reset.body.path, { text: '新地址' })).status, 201);
    assert.equal((await alice.post('/api/webhooks/delete', { id: body.webhook.id })).status, 200);
    assert.equal((await hook(space, reset.body.path, { text: '删除后' })).status, 404);
    const messages = (await bob.get(`/api/messages?roomId=${group}`)).body.messages;
    assert.equal(messages.find(message => message.text === '今日完成 3 项').bot, '日报');
  });

  test('只有群主能管理；私聊不能添加；大厅由空间创建者管理', async () => {
    assert.equal((await bob.post('/api/webhooks', { roomId: group, name: '偷偷加' })).status, 403);
    assert.equal((await bob.get(`/api/webhooks?roomId=${group}`)).status, 403);
    assert.equal((await alice.post('/api/webhooks', { roomId: direct, name: '私聊' })).status, 403);
    assert.equal((await carol.post('/api/webhooks', { roomId: group, name: '外人' })).status, 403);
    assert.equal((await alice.post('/api/webhooks', { roomId: 'lobby', name: '大厅' })).status, 403);
    assert.equal((await space.owner.post('/api/webhooks', { roomId: 'lobby', name: '大厅' })).status, 201);
    const list = (await alice.get(`/api/webhooks?roomId=${group}`)).body.webhooks;
    assert.ok(list.every(item => !('path' in item) && !('token' in item)));
  });

  test('同一个机器人每分钟最多发 30 条', async () => {
    const { body } = await alice.post('/api/webhooks', { roomId: group, name: '刷屏' });
    const results = [];
    for (let index = 0; index < 31; index++) results.push((await hook(space, body.path, { text: `第 ${index} 条` })).status);
    assert.equal(results.filter(status => status === 201).length, 30);
    assert.equal(results.at(-1), 429);
  });

  test('清空记录时一并清除机器人消息', async () => {
    await space.owner.post('/api/clear-history', { confirmation: '清空' });
    assert.equal((await bob.get(`/api/messages?roomId=${group}`)).body.messages.length, 0);
    await send(alice, group, '清空之后');
    assert.equal((await bob.get(`/api/messages?roomId=${group}`)).body.messages[0].bot, null);
  });
});

describe('账号模式的群机器人', () => {
  let space, alice;
  before(async () => {
    space = await startCloud();
    alice = await space.member('Alice');
  });
  after(() => space.close());

  test('管理员可以给大厅加机器人，外部调用不受来源检查影响', async () => {
    assert.equal((await alice.post('/api/webhooks', { roomId: 'lobby', name: '公告' })).status, 403);
    const created = await space.admin.post('/api/webhooks', { roomId: 'lobby', name: '公告' });
    assert.equal(created.status, 201);
    assert.equal((await hook(space, created.body.path, { text: '今晚 10 点维护' })).status, 201);
    assert.equal((await hook(space, created.body.path, { text: '浏览器跨站' }, { Origin: 'https://evil.example' })).status, 403);
    assert.ok((await alice.get('/api/messages?roomId=lobby')).body.messages.some(message => message.bot === '公告'));
  });
});

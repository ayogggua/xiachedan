import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startCloud, startLocal } from './helpers.mjs';

const texts = result => result.body.messages.map(message => message.text).sort();

describe('全局搜索', () => {
  let space, alice, bob, carol, aliceBob, bobCarol, team;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    aliceBob = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
    bobCarol = (await bob.post('/api/rooms', { userId: carol.id })).body.id;
    team = (await alice.post('/api/rooms', { name: '项目组', memberIds: [bob.id] })).body.id;
    await send(alice, 'lobby', '周报 大厅版');
    await send(alice, aliceBob, '周报 私聊版');
    await send(bob, bobCarol, '周报 不该被 Alice 看到');
    await send(bob, team, '周报 项目组版');
  });
  after(() => space.close());

  test('不带 roomId 时搜索自己能访问的全部会话', async () => {
    const result = await alice.get('/api/search?q=周报');
    assert.equal(result.status, 200);
    assert.deepEqual(texts(result), ['周报 大厅版', '周报 私聊版', '周报 项目组版']);
    assert.ok(result.body.messages.every(message => message.roomId));
  });

  test('不会搜到别人的私聊和自己不在的群', async () => {
    assert.deepEqual(texts(await carol.get('/api/search?q=周报')), ['周报 不该被 Alice 看到', '周报 大厅版']);
  });

  test('结果按时间从新到旧排列', async () => {
    const seqs = (await bob.get('/api/search?q=周报')).body.messages.map(message => message.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => b - a));
  });

  test('带 roomId 时仍只查该会话，越权仍被拒绝', async () => {
    assert.deepEqual(texts(await alice.get(`/api/search?roomId=${aliceBob}&q=周报`)), ['周报 私聊版']);
    assert.equal((await alice.get(`/api/search?roomId=${bobCarol}&q=周报`)).status, 403);
  });

  test('通配符按普通字符匹配，空关键词返回空结果', async () => {
    await send(alice, 'lobby', '完成率 100%');
    assert.deepEqual(texts(await alice.get('/api/search?q=' + encodeURIComponent('%'))), ['完成率 100%']);
    assert.deepEqual((await alice.get('/api/search?q=')).body.messages, []);
  });

  test('撤回和清空后的消息都搜不到', async () => {
    const message = (await send(alice, 'lobby', '临时口令 blue')).body.message;
    await alice.post('/api/recall-message', { messageId: message.id });
    assert.deepEqual((await alice.get('/api/search?q=临时口令')).body.messages, []);
    assert.equal((await space.owner.post('/api/clear-history', { confirmation: '清空' })).status, 200);
    assert.deepEqual((await alice.get('/api/search?q=周报')).body.messages, []);
  });
});

describe('账号模式下的全局搜索', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('审核通过的成员可以全局搜索，待审核账号不能', async () => {
    const member = await space.member('成员');
    await send(member, 'lobby', '云端 关键词');
    assert.deepEqual(texts(await member.get('/api/search?q=关键词')), ['云端 关键词']);
    assert.equal((await (await space.register('待审核')).get('/api/search?q=关键词')).status, 401);
  });
});

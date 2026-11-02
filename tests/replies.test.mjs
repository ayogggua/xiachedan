import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startCloud, startLocal } from './helpers.mjs';

const find = async (member, roomId, id) => (await member.get(`/api/messages?roomId=${roomId}`)).body.messages.find(message => message.id === id);

describe('引用回复', () => {
  let space, alice, bob, carol, aliceCarol;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    aliceCarol = (await alice.post('/api/rooms', { userId: carol.id })).body.id;
  });
  after(() => space.close());

  test('回复带上原消息的发送人、内容和序号', async () => {
    const original = (await send(alice, 'lobby', '明天几点开会？')).body.message;
    const reply = await send(bob, 'lobby', '十点', { replyTo: original.id });
    assert.equal(reply.status, 201);
    assert.deepEqual(reply.body.message.replyTo, { id: original.id, seq: original.seq, senderId: alice.id, text: '明天几点开会？', attachments: [] });
    assert.deepEqual((await find(carol, 'lobby', reply.body.message.id)).replyTo.text, '明天几点开会？');
    assert.equal(original.replyTo, null);
  });

  test('原消息撤回后，引用只显示已撤回，不再带内容', async () => {
    const original = (await send(alice, 'lobby', '马上撤回的内容')).body.message;
    const reply = (await send(bob, 'lobby', '收到', { replyTo: original.id })).body.message;
    await alice.post('/api/recall-message', { messageId: original.id });
    const quoted = (await find(carol, 'lobby', reply.id)).replyTo;
    assert.equal(quoted.recalled, true);
    assert.equal(quoted.text, undefined);
  });

  test('不能引用其他会话、已撤回或不存在的消息', async () => {
    const secret = (await send(alice, aliceCarol, '只给 Carol 看')).body.message;
    assert.equal((await send(bob, 'lobby', '偷看', { replyTo: secret.id })).status, 400);
    assert.equal((await send(alice, 'lobby', '跨会话引用', { replyTo: secret.id })).status, 400);
    const recalled = (await send(alice, 'lobby', '撤回了')).body.message;
    await alice.post('/api/recall-message', { messageId: recalled.id });
    assert.equal((await send(bob, 'lobby', '回复撤回', { replyTo: recalled.id })).status, 400);
    assert.equal((await send(bob, 'lobby', '回复不存在', { replyTo: 'no-such-message' })).status, 400);
    assert.equal((await send(bob, 'lobby', '格式错误', { replyTo: 42 })).status, 400);
  });

  test('撤回回复本身后，回复不再带引用', async () => {
    const original = (await send(alice, 'lobby', '原话')).body.message;
    const reply = (await send(bob, 'lobby', '回复', { replyTo: original.id })).body.message;
    await bob.post('/api/recall-message', { messageId: reply.id });
    assert.equal((await find(carol, 'lobby', reply.id)).replyTo, null);
  });

  test('同一 clientId 重发返回同一条回复', async () => {
    const original = (await send(alice, 'lobby', '重发测试')).body.message;
    const body = { roomId: 'lobby', clientId: 'reply-retry', text: '只回一次', replyTo: original.id };
    const first = await bob.post('/api/messages', body);
    const second = await bob.post('/api/messages', body);
    assert.equal(second.body.message.id, first.body.message.id);
    assert.equal(second.body.message.replyTo.id, original.id);
  });

  test('搜索结果同样带引用', async () => {
    const original = (await send(alice, 'lobby', '搜索引用原文')).body.message;
    await send(bob, 'lobby', '搜索引用回复 xyz', { replyTo: original.id });
    assert.equal((await carol.get('/api/search?q=xyz')).body.messages[0].replyTo.id, original.id);
  });

  test('清空聊天记录后引用一并清除', async () => {
    assert.equal((await space.owner.post('/api/clear-history', { confirmation: '清空' })).status, 200);
    const original = (await send(alice, 'lobby', '清空后的新消息')).body.message;
    assert.equal((await send(bob, 'lobby', '新回复', { replyTo: original.id })).body.message.replyTo.text, '清空后的新消息');
  });
});

describe('账号模式下的引用回复', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('审核通过的成员可以引用回复', async () => {
    const alice = await space.member('Alice'), bob = await space.member('Bob');
    const original = (await send(alice, 'lobby', '云端原话')).body.message;
    const reply = await send(bob, 'lobby', '云端回复', { replyTo: original.id });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.message.replyTo.senderId, alice.id);
  });
});

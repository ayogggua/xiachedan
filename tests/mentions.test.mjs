import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startCloud, startLocal } from './helpers.mjs';

const unread = async (member, roomId, afterSeq = 0) =>
  (await member.post('/api/unread-counts', { cursors: { [roomId]: afterSeq } })).body.rooms.find(room => room.id === roomId);

describe('@提及', () => {
  let space, alice, bob, carol, team, aliceBob;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    team = (await alice.post('/api/rooms', { name: '项目组', memberIds: [bob.id] })).body.id;
    aliceBob = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
  });
  after(() => space.close());

  test('提及会话成员并随消息返回', async () => {
    const result = await send(alice, team, '@Bob 看一下', { mentions: [bob.id] });
    assert.equal(result.status, 201);
    assert.deepEqual(result.body.message.mentions, [bob.id]);
    const listed = (await bob.get(`/api/messages?roomId=${team}`)).body.messages.find(message => message.id === result.body.message.id);
    assert.deepEqual(listed.mentions, [bob.id]);
  });

  test('不在会话里、正文没写名字、提及自己或格式错误都被拒绝', async () => {
    assert.equal((await send(alice, team, '@Carol 你好', { mentions: [carol.id] })).status, 400);
    assert.equal((await send(alice, team, '偷偷提醒', { mentions: [bob.id] })).status, 400);
    assert.equal((await send(alice, team, '@Alice 自己', { mentions: [alice.id] })).status, 400);
    assert.equal((await send(alice, team, '@Bob', { mentions: 'bob' })).status, 400);
    assert.equal((await send(alice, team, '@Bob', { mentions: [42] })).status, 400);
  });

  test('@所有人：群聊成员可用，私聊不可用，大厅仅空间创建者可用', async () => {
    assert.equal((await send(bob, team, '@所有人 开会', { mentions: ['*'] })).status, 201);
    assert.equal((await send(alice, aliceBob, '@所有人', { mentions: ['*'] })).status, 403);
    assert.equal((await send(alice, 'lobby', '@所有人 通知', { mentions: ['*'] })).status, 403);
    assert.equal((await send(space.owner, 'lobby', '@所有人 通知', { mentions: ['*'] })).status, 201);
    assert.equal((await send(space.owner, 'lobby', '没写', { mentions: ['*'] })).status, 400);
  });

  test('未读里单独统计提及自己的消息，自己发的不算', async () => {
    const start = (await alice.get(`/api/messages?roomId=${team}`)).body.messages.at(-1).seq;
    await send(alice, team, '普通消息');
    await send(alice, team, '@Bob 这条找你', { mentions: [bob.id] });
    await send(bob, team, '@所有人 我自己发的', { mentions: ['*'] });
    const forBob = await unread(bob, team, start);
    assert.equal(forBob.unreadCount, 2);
    assert.equal(forBob.mentionCount, 1);
    const forAlice = await unread(alice, team, start);
    assert.equal(forAlice.mentionCount, 1);
  });

  test('撤回后提及不再计入', async () => {
    const start = (await carol.get('/api/messages?roomId=lobby')).body.messages.at(-1).seq;
    const message = (await send(alice, 'lobby', '@Carol 撤回前', { mentions: [carol.id] })).body.message;
    assert.equal((await unread(carol, 'lobby', start)).mentionCount, 1);
    await alice.post('/api/recall-message', { messageId: message.id });
    assert.equal((await unread(carol, 'lobby', start)).mentionCount, 0);
    assert.deepEqual((await carol.get('/api/messages?roomId=lobby')).body.messages.find(item => item.id === message.id).mentions, []);
  });
});

describe('账号模式下的 @所有人', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('大厅里管理员可以 @所有人，普通成员不可以', async () => {
    const member = await space.member('成员');
    assert.equal((await send(member, 'lobby', '@所有人', { mentions: ['*'] })).status, 403);
    assert.equal((await send(space.admin, 'lobby', '@所有人 公告', { mentions: ['*'] })).status, 201);
  });
});

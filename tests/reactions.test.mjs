import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startCloud, startLocal } from './helpers.mjs';

const reactionsOf = async (member, roomId, id) => (await member.get(`/api/messages?roomId=${roomId}`)).body.messages.find(message => message.id === id).reactions;

describe('表情回应', () => {
  let space, alice, bob, carol, direct;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
  });
  after(() => space.close());

  test('会话状态下发可用的表情', async () => {
    assert.deepEqual((await alice.get('/api/state')).body.reactions, ['👍', '❤️', '😂', '🎉', '😮', '🙏', '✅', '👀']);
  });

  test('回应、合并计数、再点一次取消', async () => {
    const message = (await send(alice, 'lobby', '今天发版')).body.message;
    assert.deepEqual(message.reactions, []);
    assert.deepEqual((await bob.post('/api/reactions', { messageId: message.id, emoji: '🎉' })).body.reactions, [{ emoji: '🎉', users: [bob.id] }]);
    await carol.post('/api/reactions', { messageId: message.id, emoji: '🎉' });
    await carol.post('/api/reactions', { messageId: message.id, emoji: '👍' });
    assert.deepEqual(await reactionsOf(alice, 'lobby', message.id), [{ emoji: '🎉', users: [bob.id, carol.id] }, { emoji: '👍', users: [carol.id] }]);
    await bob.post('/api/reactions', { messageId: message.id, emoji: '🎉' });
    assert.deepEqual(await reactionsOf(alice, 'lobby', message.id), [{ emoji: '🎉', users: [carol.id] }, { emoji: '👍', users: [carol.id] }]);
  });

  test('任意单个表情都可以，文字和多个表情不行；不能回应看不到、已撤回或不存在的消息', async () => {
    const message = (await send(alice, 'lobby', '测试')).body.message;
    assert.equal((await bob.post('/api/reactions', { messageId: message.id, emoji: '💩' })).status, 200);
    assert.equal((await bob.post('/api/reactions', { messageId: message.id, emoji: '👍🏽' })).status, 200);
    assert.equal((await bob.post('/api/reactions', { messageId: message.id, emoji: '<b>' })).status, 400);
    assert.equal((await bob.post('/api/reactions', { messageId: message.id, emoji: '👍👍' })).status, 400);
    assert.equal((await bob.post('/api/reactions', { messageId: message.id, emoji: 'a' })).status, 400);
    const secret = (await send(alice, direct, '私聊')).body.message;
    assert.equal((await carol.post('/api/reactions', { messageId: secret.id, emoji: '👍' })).status, 403);
    await alice.post('/api/recall-message', { messageId: message.id });
    assert.equal((await bob.post('/api/reactions', { messageId: message.id, emoji: '👍' })).status, 400);
    assert.equal((await bob.post('/api/reactions', { messageId: 'missing', emoji: '👍' })).status, 404);
  });

  test('撤回后回应一并清除', async () => {
    const message = (await send(alice, 'lobby', '马上撤回')).body.message;
    await bob.post('/api/reactions', { messageId: message.id, emoji: '😮' });
    await alice.post('/api/recall-message', { messageId: message.id });
    assert.deepEqual(await reactionsOf(carol, 'lobby', message.id), []);
  });

  test('实时推送给会话里的人，不推给会话外的人', async () => {
    const message = (await send(alice, direct, '看这里')).body.message;
    const inside = await listen(space.base, alice), outside = await listen(space.base, carol);
    await settle(); inside.clear(); outside.clear();
    await bob.post('/api/reactions', { messageId: message.id, emoji: '👀' });
    await settle();
    const event = inside.events.find(item => item.type === 'message-reactions');
    assert.deepEqual(event, { type: 'message-reactions', roomId: direct, messageId: message.id, reactions: [{ emoji: '👀', users: [bob.id] }] });
    assert.ok(!outside.received('message-reactions'));
    inside.close(); outside.close();
  });
});

describe('账号模式下的表情回应', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('审核通过的成员可以回应，待审核账号不能', async () => {
    const alice = await space.member('Alice'), bob = await space.member('Bob');
    const message = (await send(alice, 'lobby', '云端')).body.message;
    assert.equal((await bob.post('/api/reactions', { messageId: message.id, emoji: '👍' })).status, 200);
    assert.equal((await (await space.register('待审核')).post('/api/reactions', { messageId: message.id, emoji: '👍' })).status, 401);
  });
});

describe('表情种类上限', () => {
  let space, alice, members;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    members = [];
    for (let index = 0; index < 3; index++) members.push(await space.join(`成员${index}`));
  });
  after(() => space.close());

  test('同一条消息最多 20 种不同表情，已有的表情还能继续加', async () => {
    const message = (await send(alice, 'lobby', '热门')).body.message;
    const emojis = ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚'];
    for (const emoji of emojis) assert.equal((await alice.post('/api/reactions', { messageId: message.id, emoji })).status, 200);
    assert.equal((await members[0].post('/api/reactions', { messageId: message.id, emoji: '🥳' })).status, 400);
    assert.equal((await members[0].post('/api/reactions', { messageId: message.id, emoji: '😀' })).status, 200);
  });
});

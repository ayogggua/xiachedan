import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startCloud, startLocal } from './helpers.mjs';

describe('提到我的', () => {
  let space, alice, bob, carol, group, secret;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '项目组', memberIds: [bob.id] })).body.id;
    secret = (await bob.post('/api/rooms', { name: '小群', memberIds: [carol.id] })).body.id;
  });
  after(() => space.close());
  const activity = async member => (await member.get('/api/activity')).body.items;

  test('@我、@所有人、回复我、话题里回复我、回应我的消息都会列出来，最新的在前', async () => {
    const mine = (await send(alice, group, '我的方案')).body.message;
    await send(bob, group, '@Alice 看一下', { mentions: [alice.id] });
    await send(bob, group, '@所有人 开会', { mentions: ['*'] });
    await send(bob, group, '同意', { replyTo: mine.id });
    await send(bob, group, '话题里补充', { threadOf: mine.id });
    await bob.post('/api/reactions', { messageId: mine.id, emoji: '👍' });
    const items = await activity(alice);
    assert.deepEqual(items.map(item => item.kind).sort(), ['mention', 'mention', 'reaction', 'reply', 'thread']);
    assert.ok(items.every((item, index) => !index || items[index - 1].at >= item.at), '按时间倒序');
    const reaction = items.find(item => item.kind === 'reaction');
    assert.equal(reaction.emoji, '👍');
    assert.equal(reaction.message.id, mine.id);
    assert.equal(reaction.actorId, bob.id);
    assert.equal(items.find(item => item.kind === 'thread').message.threadOf, mine.id);
    assert.equal(items.find(item => item.kind === 'reply').message.text, '同意');
  });

  test('自己做的、看不到的会话、撤回的、自己删掉的都不算', async () => {
    const before = (await activity(alice)).length;
    const mine = (await send(alice, group, '自问自答')).body.message;
    await send(alice, group, '回复自己', { replyTo: mine.id });
    await send(carol, secret, '@Alice 你看不到这里', { mentions: [alice.id] });
    const recalled = (await send(bob, group, '@Alice 撤回了', { mentions: [alice.id] })).body.message;
    await bob.post('/api/recall-message', { messageId: recalled.id });
    const hidden = (await send(bob, group, '@Alice 删掉了', { mentions: [alice.id] })).body.message;
    await alice.post('/api/messages/hide', { messageIds: [hidden.id] });
    assert.equal((await activity(alice)).length, before);
  });

  test('分页：before 之前的更早记录', async () => {
    const items = await activity(alice);
    const older = (await alice.get(`/api/activity?before=${items[1].at}`)).body.items;
    assert.ok(older.every(item => item.at < items[1].at));
  });
});

describe('提到我的（账号模式）', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());
  test('账号模式同样可用', async () => {
    const alice = await space.member('Alice');
    const bob = await space.member('Bob');
    await send(bob, 'lobby', '@Alice 你好', { mentions: [alice.id] });
    assert.deepEqual((await alice.get('/api/activity')).body.items.map(item => item.kind), ['mention']);
  });
});

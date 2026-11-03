import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startCloud, startLocal } from './helpers.mjs';

describe('编辑消息', () => {
  let space, alice, bob, carol, direct;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
  });
  after(() => space.close());

  test('发送人可以改正文，标记已编辑，其他人实时收到', async () => {
    const message = (await send(alice, 'lobby', '周五下午三点开会')).body.message;
    assert.equal(message.editedAt, null);
    const live = await listen(space.base, bob);
    const edited = await alice.post('/api/edit-message', { messageId: message.id, text: '周五下午四点开会' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.message.text, '周五下午四点开会');
    assert.ok(edited.body.message.editedAt);
    await settle();
    assert.equal(live.events.find(event => event.type === 'message-edited').message.text, '周五下午四点开会');
    live.close();
    assert.equal((await bob.get('/api/search?q=四点')).body.messages.length, 1);
    assert.equal((await bob.get('/api/search?q=三点')).body.messages.length, 0);
  });

  test('引用跟着原消息的新内容走', async () => {
    const original = (await send(alice, 'lobby', '原来的说法')).body.message;
    const reply = (await send(bob, 'lobby', '收到', { replyTo: original.id })).body.message;
    await alice.post('/api/edit-message', { messageId: original.id, text: '改过的说法' });
    const messages = (await bob.get('/api/messages?roomId=lobby')).body.messages;
    assert.equal(messages.find(item => item.id === reply.id).replyTo.text, '改过的说法');
  });

  test('只保留正文里仍写着的 @提及，不会新增提醒', async () => {
    const message = (await send(alice, 'lobby', '@Bob @Carol 看一下', { mentions: [bob.id, carol.id] })).body.message;
    const edited = (await alice.post('/api/edit-message', { messageId: message.id, text: '@Bob 看一下 @Alice' })).body.message;
    assert.deepEqual(edited.mentions, [bob.id]);
  });

  test('内容没变不算编辑', async () => {
    const message = (await send(alice, 'lobby', '不变')).body.message;
    assert.equal((await alice.post('/api/edit-message', { messageId: message.id, text: ' 不变 ' })).body.message.editedAt, null);
  });

  test('不能改别人的、撤回的、无权访问的消息，也不能改成空', async () => {
    const message = (await send(alice, direct, '私聊里的话')).body.message;
    assert.equal((await bob.post('/api/edit-message', { messageId: message.id, text: '冒改' })).status, 403);
    assert.equal((await carol.post('/api/edit-message', { messageId: message.id, text: '越权' })).status, 403);
    assert.equal((await alice.post('/api/edit-message', { messageId: message.id, text: '   ' })).status, 400);
    assert.equal((await alice.post('/api/edit-message', { messageId: message.id, text: 'x'.repeat(10001) })).status, 400);
    await alice.post('/api/recall-message', { messageId: message.id });
    assert.equal((await alice.post('/api/edit-message', { messageId: message.id, text: '撤回后' })).status, 400);
    assert.equal((await alice.post('/api/edit-message', { messageId: 'missing', text: 'x' })).status, 404);
  });
});

describe('账号模式编辑消息', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('已审核成员可以编辑自己的消息', async () => {
    const alice = await space.member('Alice');
    const message = (await send(alice, 'lobby', '初稿')).body.message;
    assert.equal((await alice.post('/api/edit-message', { messageId: message.id, text: '定稿' })).body.message.text, '定稿');
  });
});

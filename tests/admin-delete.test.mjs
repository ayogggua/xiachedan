import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startCloud, startLocal } from './helpers.mjs';

describe('管理员删除消息（局域网：空间创建者）', () => {
  let space, alice, bob, direct;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
  });
  after(() => space.close());

  test('空间创建者可以删除任何人在大厅和群里的消息，大家实时看到「管理员删除」', async () => {
    const message = (await send(alice, 'lobby', '不当言论')).body.message;
    const live = await listen(space.base, bob);
    const removed = await space.owner.post('/api/admin/delete-message', { messageId: message.id });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.message.removedBy, space.ownerId);
    assert.equal(removed.body.message.text, '');
    await settle();
    assert.equal(live.events.find(event => event.type === 'message-recalled').message.removedBy, space.ownerId);
    live.close();
    assert.equal((await bob.get('/api/search?q=不当言论')).body.messages.length, 0);
  });

  test('普通成员不能删别人的消息；管理员不能删不在其中的私聊', async () => {
    const message = (await send(alice, 'lobby', '正常发言')).body.message;
    assert.equal((await bob.post('/api/admin/delete-message', { messageId: message.id })).status, 403);
    const secret = (await send(alice, direct, '私聊')).body.message;
    assert.equal((await space.owner.post('/api/admin/delete-message', { messageId: secret.id })).status, 403);
  });

  test('操作日志记下谁删了谁的消息，不保留内容；普通成员看不到日志', async () => {
    const log = await space.owner.get('/api/admin/audit');
    assert.equal(log.status, 200);
    const entry = log.body.entries.find(item => item.action === 'delete-message');
    assert.equal(entry.actor.id, space.ownerId);
    assert.equal(entry.target.name, 'Alice');
    assert.doesNotMatch(entry.detail, /不当言论/);
    assert.equal((await alice.get('/api/admin/audit')).status, 403);
  });
});

describe('账号模式的管理员删除', () => {
  let space, alice, bob;
  before(async () => {
    space = await startCloud();
    alice = await space.member('Alice');
    bob = await space.member('Bob');
  });
  after(() => space.close());

  test('管理员可以删除，日志里也有审核记录；普通成员不行', async () => {
    const message = (await send(alice, 'lobby', '广告')).body.message;
    assert.equal((await bob.post('/api/admin/delete-message', { messageId: message.id })).status, 403);
    assert.equal((await space.admin.post('/api/admin/delete-message', { messageId: message.id })).status, 200);
    assert.equal((await space.admin.post('/api/admin/delete-message', { messageId: message.id })).status, 400);
    const actions = (await space.admin.get('/api/admin/audit')).body.entries.map(item => item.action);
    assert.ok(actions.includes('delete-message') && actions.includes('approve'));
  });
});

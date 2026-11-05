import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, settle, startLocal } from './helpers.mjs';

describe('编辑历史', () => {
  let space, alice, bob, carol, group;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '历史', memberIds: [bob.id] })).body.id;
  });
  after(() => space.close());

  test('会话成员能按先后看到每个版本，没编辑过的只有当前版本', async () => {
    const message = (await send(alice, group, '第一版')).body.message;
    const untouched = (await bob.get(`/api/message-history?id=${message.id}`)).body;
    assert.deepEqual(untouched.versions, []);
    assert.equal(untouched.complete, true);
    await alice.post('/api/edit-message', { messageId: message.id, text: '第二版' });
    await settle(20);
    await alice.post('/api/edit-message', { messageId: message.id, text: '第三版' });
    const history = (await bob.get(`/api/message-history?id=${message.id}`)).body;
    assert.deepEqual(history.versions.map(version => version.text), ['第一版', '第二版']);
    assert.equal(history.versions[0].at, message.createdAt);
    assert.ok(history.versions[1].at >= history.versions[0].at);
    assert.equal(history.current.text, '第三版');
    assert.equal(history.complete, true);
  });

  test('不在会话里看不到；撤回后历史一起删除', async () => {
    const message = (await send(alice, group, '会撤回')).body.message;
    await alice.post('/api/edit-message', { messageId: message.id, text: '改过一次' });
    assert.equal((await carol.get(`/api/message-history?id=${message.id}`)).status, 403);
    await alice.post('/api/recall-message', { messageId: message.id });
    assert.equal((await alice.get(`/api/message-history?id=${message.id}`)).status, 404);
    assert.equal((await alice.get('/api/message-history?id=missing')).status, 404);
  });
});

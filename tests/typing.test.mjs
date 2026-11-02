import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, settle, startLocal } from './helpers.mjs';

describe('正在输入', () => {
  let space, alice, bob, carol, direct, sockets;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice'); bob = await space.join('Bob'); carol = await space.join('Carol');
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
    sockets = { alice: await listen(space.base, alice), bob: await listen(space.base, bob), carol: await listen(space.base, carol) };
    await settle();
  });
  after(async () => { for (const socket of Object.values(sockets)) socket.close(); await space.close(); });
  const reset = () => { for (const socket of Object.values(sockets)) socket.clear(); };
  const typing = socket => socket.events.filter(event => event.type === 'typing');

  test('只转发给同一会话里的其他人，不发回给自己', async () => {
    reset();
    sockets.alice.send({ type: 'typing', roomId: direct });
    await settle();
    assert.deepEqual(typing(sockets.bob), [{ type: 'typing', roomId: direct, userId: alice.id }]);
    assert.equal(typing(sockets.alice).length, 0);
    assert.equal(typing(sockets.carol).length, 0);
  });

  test('两秒内重复发送只转发一次', async () => {
    await settle(2100); reset();
    sockets.bob.send({ type: 'typing', roomId: 'lobby' });
    sockets.bob.send({ type: 'typing', roomId: 'lobby' });
    sockets.bob.send({ type: 'typing', roomId: 'lobby' });
    await settle();
    assert.equal(typing(sockets.carol).length, 1);
    assert.equal(typing(sockets.alice).length, 1);
  });

  test('不能对自己不在的会话发「正在输入」，格式错误直接忽略', async () => {
    await settle(2100); reset();
    sockets.carol.send({ type: 'typing', roomId: direct });
    sockets.carol.send({ type: 'something-else', roomId: 'lobby' });
    await settle();
    assert.equal(typing(sockets.alice).length + typing(sockets.bob).length, 0);
    assert.equal((await carol.get('/api/state')).status, 200);
  });
});

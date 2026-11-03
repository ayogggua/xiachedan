import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, settle, startCloud, startLocal } from './helpers.mjs';

describe('成员备注', () => {
  let space, alice, bob, carol;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
  });
  after(() => space.close());

  test('备注只有写的人自己看得到，并同步到自己的其他连接', async () => {
    const own = await listen(space.base, alice);
    const other = await listen(space.base, bob);
    const saved = await alice.post('/api/user-note', { userId: bob.id, note: '  后端组长，周三请假  ' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.note, '后端组长，周三请假');
    await settle();
    assert.deepEqual(own.events.filter(event => event.type === 'user-note'), [{ type: 'user-note', userId: bob.id, note: '后端组长，周三请假' }]);
    assert.equal(other.events.some(event => event.type === 'user-note'), false);
    own.close(); other.close();
    assert.equal((await alice.get('/api/state')).body.notes[bob.id], '后端组长，周三请假');
    assert.deepEqual((await bob.get('/api/state')).body.notes, {});
    assert.deepEqual((await carol.get('/api/state')).body.notes, {});
    assert.equal(JSON.stringify((await carol.get('/api/state')).body.users).includes('周三请假'), false);
  });

  test('清空即删除；不能给自己写，不能超过 200 字，成员必须存在', async () => {
    await alice.post('/api/user-note', { userId: carol.id, note: '设计' });
    assert.equal((await alice.post('/api/user-note', { userId: carol.id, note: ' ' })).status, 200);
    assert.equal((await alice.get('/api/state')).body.notes[carol.id], undefined);
    assert.equal((await alice.post('/api/user-note', { userId: alice.id, note: '我' })).status, 400);
    assert.equal((await alice.post('/api/user-note', { userId: bob.id, note: 'x'.repeat(201) })).status, 400);
    assert.equal((await alice.post('/api/user-note', { userId: bob.id, note: 3 })).status, 400);
    assert.equal((await alice.post('/api/user-note', { userId: 'missing', note: 'x' })).status, 404);
  });
});

describe('账号模式的成员备注', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('已审核成员可以写备注', async () => {
    const alice = await space.member('Alice');
    const bob = await space.member('Bob');
    assert.equal((await alice.post('/api/user-note', { userId: bob.id, note: '产品' })).status, 200);
    assert.equal((await alice.get('/api/state')).body.notes[bob.id], '产品');
  });
});

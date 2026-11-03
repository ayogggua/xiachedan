import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startCloud } from './helpers.mjs';

describe('管理员重置成员密码', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  async function member(email, name) {
    const client = space.client();
    const registered = await client.post('/api/auth/register', { identifier: email, password: 'Member-pass-2026', name });
    client.id = registered.body.account.id;
    await space.admin.post('/api/admin/review', { userId: client.id, status: 'approved' });
    return client;
  }

  test('临时密码只返回一次，旧密码和旧登录失效，登录后要求先改密码', async () => {
    const alice = await member('alice@example.com', 'Alice');
    assert.equal((await alice.get('/api/state')).status, 200);
    const reset = await space.admin.post('/api/admin/password', { userId: alice.id });
    assert.equal(reset.status, 200);
    assert.match(reset.body.password, /^[A-Za-z]{4}-\d{4}-[A-Za-z\d]{4}$/);
    assert.equal((await alice.get('/api/state')).status, 401);
    const fresh = space.client();
    assert.equal((await fresh.post('/api/auth/login', { identifier: 'alice@example.com', password: 'Member-pass-2026' })).status, 401);
    const login = await fresh.post('/api/auth/login', { identifier: 'alice@example.com', password: reset.body.password });
    assert.equal(login.status, 200);
    assert.equal(login.body.account.mustChangePassword, true);
    const changed = await fresh.post('/api/auth/password', { currentPassword: reset.body.password, password: 'Alice-new-2026' });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.account.mustChangePassword, false);
  });

  test('普通成员不能重置，管理员不能重置自己、超级管理员或其他管理员', async () => {
    const bob = await member('bob@example.com', 'Bob');
    const carol = await member('carol@example.com', 'Carol');
    assert.equal((await bob.post('/api/admin/password', { userId: carol.id })).status, 403);
    assert.equal((await space.admin.post('/api/admin/password', { userId: space.admin.id })).status, 403);
    await space.admin.post('/api/admin/role', { userId: bob.id, role: 'admin' });
    assert.equal((await bob.post('/api/admin/password', { userId: space.admin.id })).status, 403);
    const dave = await member('dave@example.com', 'Dave');
    await space.admin.post('/api/admin/role', { userId: dave.id, role: 'admin' });
    assert.equal((await bob.post('/api/admin/password', { userId: dave.id })).status, 403);
    assert.equal((await bob.post('/api/admin/password', { userId: carol.id })).status, 200);
  });

  test('待审核的账号不能重置', async () => {
    const pending = await space.register('Pending');
    assert.equal((await space.admin.post('/api/admin/password', { userId: pending.id })).status, 400);
  });
});

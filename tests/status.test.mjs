import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, settle, startLocal } from './helpers.mjs';

describe('自定义状态', () => {
  let space, alice, bob;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
  });
  after(() => space.close());
  const statusOf = async (member, id) => (await member.get('/api/state')).body.users.find(user => user.id === id).status;

  test('设置后所有人实时看到，清空即删除', async () => {
    const live = await listen(space.base, bob);
    const until = Date.now() + 3600000;
    const saved = await alice.post('/api/status', { emoji: '🏖', text: ' 休假中，周一回来 ', until });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.status, { emoji: '🏖', text: '休假中，周一回来', until });
    await settle();
    assert.deepEqual(live.events.findLast(event => event.type === 'users').users.find(user => user.id === alice.id).status.text, '休假中，周一回来');
    live.close();
    assert.equal((await statusOf(bob, alice.id)).emoji, '🏖');
    assert.equal((await alice.post('/api/status', { emoji: '', text: '' })).body.status, null);
    assert.equal(await statusOf(bob, alice.id), null);
  });

  test('不自动清除的状态一直显示；到期时间必须在将来 30 天内；文字最多 40 字', async () => {
    assert.equal((await alice.post('/api/status', { emoji: '🎯', text: '专注中', until: null })).body.status.until, null);
    assert.equal((await alice.post('/api/status', { emoji: '🎯', text: '专注中', until: Date.now() - 1000 })).status, 400);
    assert.equal((await alice.post('/api/status', { emoji: '🎯', text: '专注中', until: Date.now() + 31 * 86400000 })).status, 400);
    assert.equal((await alice.post('/api/status', { emoji: '', text: '长'.repeat(41) })).status, 400);
    assert.equal((await statusOf(bob, alice.id)).text, '专注中');
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, settle, startLocal } from './helpers.mjs';

describe('关键词提醒', () => {
  let space, alice, bob;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
  });
  after(() => space.close());

  test('保存时去空白、去重，只推给自己，别人看不到', async () => {
    const own = await listen(space.base, alice);
    const other = await listen(space.base, bob);
    const saved = await alice.post('/api/keywords', { keywords: [' 上线 ', '故障', '上线', '', '  '] });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.keywords, ['上线', '故障']);
    await settle();
    assert.deepEqual(own.events.find(event => event.type === 'keywords').keywords, ['上线', '故障']);
    assert.equal(other.events.some(event => event.type === 'keywords'), false);
    own.close(); other.close();
    assert.deepEqual((await alice.get('/api/state')).body.keywords, ['上线', '故障']);
    assert.deepEqual((await bob.get('/api/state')).body.keywords, []);
    assert.deepEqual((await alice.post('/api/keywords', { keywords: [] })).body.keywords, []);
  });

  test('最多 20 个、每个最多 20 个字', async () => {
    assert.equal((await alice.post('/api/keywords', { keywords: Array.from({ length: 21 }, (_, index) => `词${index}`) })).status, 400);
    assert.equal((await alice.post('/api/keywords', { keywords: ['长'.repeat(21)] })).status, 400);
    assert.equal((await alice.post('/api/keywords', { keywords: '上线' })).status, 400);
  });
});

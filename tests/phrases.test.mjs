import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, settle, startCloud, startLocal } from './helpers.mjs';

describe('常用语', () => {
  let space, alice, bob;
  before(async () => { space = await startLocal(); alice = await space.join('Alice'); bob = await space.join('Bob'); });
  after(() => space.close());

  test('保存后去重、去空白、保留顺序，自己的其他设备实时收到；别人看不到', async () => {
    const live = await listen(space.base, alice);
    const saved = await alice.post('/api/phrases', { phrases: [' 收到，马上处理 ', '好的', '收到，马上处理', '', '多行\n第二行'] });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.phrases, ['收到，马上处理', '好的', '多行\n第二行']);
    await settle();
    assert.deepEqual(live.events.find(event => event.type === 'phrases').phrases, saved.body.phrases);
    live.close();
    assert.deepEqual((await alice.get('/api/state')).body.phrases, saved.body.phrases);
    assert.deepEqual((await bob.get('/api/state')).body.phrases, []);
  });

  test('数量和长度有上限，格式不对时拒绝', async () => {
    assert.equal((await alice.post('/api/phrases', { phrases: Array.from({ length: 31 }, (_, index) => `第 ${index} 条`) })).status, 400);
    assert.equal((await alice.post('/api/phrases', { phrases: ['长'.repeat(501)] })).status, 400);
    assert.equal((await alice.post('/api/phrases', { phrases: 'x' })).status, 400);
    assert.equal((await alice.post('/api/phrases', { phrases: [1] })).status, 400);
  });
});

describe('常用语（账号模式）', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());
  test('账号模式同样跨设备保存', async () => {
    const alice = await space.member('Alice');
    await alice.post('/api/phrases', { phrases: ['在开会，晚点回'] });
    assert.deepEqual((await alice.get('/api/state')).body.phrases, ['在开会，晚点回']);
  });
});

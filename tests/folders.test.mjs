import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, settle, startCloud, startLocal } from './helpers.mjs';

describe('会话文件夹', () => {
  let space, alice, bob, mine, secret;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    mine = (await alice.post('/api/rooms', { name: '工作', memberIds: [bob.id] })).body.id;
    secret = (await bob.post('/api/rooms', { name: '外人看不到', memberIds: [] })).body.id;
  });
  after(() => space.close());

  test('建、改、删文件夹；只留下自己能访问的会话；改动只推给自己', async () => {
    const own = await listen(space.base, alice);
    const other = await listen(space.base, bob);
    const created = await alice.post('/api/folders', { name: '  工作相关  ', roomIds: [mine, 'lobby', secret, 'missing', mine] });
    assert.equal(created.status, 201);
    const folder = created.body.folders[0];
    assert.equal(folder.name, '工作相关');
    assert.deepEqual(folder.roomIds, [mine, 'lobby']);
    await settle();
    assert.equal(own.events.filter(event => event.type === 'folders').length, 1);
    assert.equal(other.events.some(event => event.type === 'folders'), false);
    own.close(); other.close();
    assert.deepEqual((await alice.get('/api/state')).body.folders.map(item => item.name), ['工作相关']);
    assert.deepEqual((await bob.get('/api/state')).body.folders, []);
    const updated = await alice.post('/api/folders/update', { id: folder.id, name: '项目', roomIds: ['lobby'] });
    assert.deepEqual(updated.body.folders[0], { id: folder.id, name: '项目', roomIds: ['lobby'] });
    assert.equal((await bob.post('/api/folders/update', { id: folder.id, name: '偷改', roomIds: [] })).status, 404);
    assert.equal((await bob.post('/api/folders/delete', { id: folder.id })).status, 404);
    assert.deepEqual((await alice.post('/api/folders/delete', { id: folder.id })).body.folders, []);
  });

  test('名称必填，最多 10 个', async () => {
    assert.equal((await alice.post('/api/folders', { name: '  ', roomIds: [] })).status, 400);
    assert.equal((await alice.post('/api/folders', { name: '坏', roomIds: 'lobby' })).status, 400);
    for (let index = 0; index < 10; index++) assert.equal((await alice.post('/api/folders', { name: `F${index}`, roomIds: [] })).status, 201);
    assert.equal((await alice.post('/api/folders', { name: '第十一个', roomIds: [] })).status, 400);
  });
});

describe('账号模式的会话文件夹', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('已审核成员可以建文件夹', async () => {
    const alice = await space.member('Alice');
    assert.equal((await alice.post('/api/folders', { name: '常用', roomIds: ['lobby'] })).status, 201);
  });
});

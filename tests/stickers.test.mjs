import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startCloud, startLocal } from './helpers.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const cookieOf = member => [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
async function upload(space, member, roomId, name, bytes, type) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return (await (await fetch(`${space.base}/api/uploads?roomId=${encodeURIComponent(roomId)}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie: cookieOf(member) }, body: form })).json()).attachment;
}
const download = (space, member, id) => fetch(`${space.base}/api/media?id=${id}`, { headers: { cookie: cookieOf(member) } });

describe('自定义表情', () => {
  let space, alice, bob, carol, group, image;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '表情群', memberIds: [bob.id] })).body.id;
    const file = await upload(space, bob, group, '猫猫.png', PNG, 'image/png');
    image = (await send(bob, group, '', { attachmentIds: [file.id] })).body.message;
  });
  after(() => space.close());

  test('把聊天里的图片收藏成表情，只有自己能看到；原消息撤回后表情还在', async () => {
    const added = await alice.post('/api/stickers', { fileId: image.attachments[0].id });
    assert.equal(added.status, 201);
    const [sticker] = added.body.stickers;
    assert.equal(sticker.mime, 'image/png');
    assert.notEqual(sticker.id, image.attachments[0].id);
    assert.equal((await download(space, alice, sticker.id)).status, 200);
    assert.equal((await download(space, bob, sticker.id)).status, 404);
    await bob.post('/api/recall-message', { messageId: image.id });
    assert.equal((await download(space, alice, sticker.id)).status, 200);
    assert.deepEqual((await alice.get('/api/stickers')).body.stickers.map(item => item.id), [sticker.id]);
  });

  test('发表情：另存为会话附件并标记 sticker，别人能看到', async () => {
    const [sticker] = (await alice.get('/api/stickers')).body.stickers;
    const used = await alice.post('/api/stickers/use', { id: sticker.id, roomId: group });
    assert.equal(used.status, 201);
    const sent = await send(alice, group, '', { attachmentIds: [used.body.attachment.id] });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.attachments[0].sticker, true);
    assert.equal((await download(space, bob, used.body.attachment.id)).status, 200);
    assert.equal((await alice.post('/api/stickers/use', { id: sticker.id, roomId: 'nope' })).status, 403);
    assert.equal((await bob.post('/api/stickers/use', { id: sticker.id, roomId: group })).status, 404);
  });

  test('没发出去的表情副本最多 10 份，避免反复调用占满存储', async () => {
    const [sticker] = (await alice.get('/api/stickers')).body.stickers;
    const statuses = [];
    for (let index = 0; index < 11; index++) statuses.push((await alice.post('/api/stickers/use', { id: sticker.id, roomId: group })).status);
    assert.equal(statuses.filter(status => status === 201).length, 10);
    assert.equal(statuses.at(-1), 429);
  });

  test('不能收藏看不到的或不是图片的文件；删除后不能再用', async () => {
    const secret = (await bob.post('/api/rooms', { name: '小群', memberIds: [alice.id] })).body.id;
    const file = await upload(space, bob, secret, '秘密.png', PNG, 'image/png');
    const hiddenImage = (await send(bob, secret, '', { attachmentIds: [file.id] })).body.message;
    assert.equal((await carol.post('/api/stickers', { fileId: hiddenImage.attachments[0].id })).status, 403);
    const doc = await upload(space, bob, group, '说明.txt', Buffer.from('hello'), 'text/plain');
    const docMessage = (await send(bob, group, '', { attachmentIds: [doc.id] })).body.message;
    assert.equal((await alice.post('/api/stickers', { fileId: docMessage.attachments[0].id })).status, 400);
    const [sticker] = (await alice.get('/api/stickers')).body.stickers;
    assert.equal((await bob.post('/api/stickers/delete', { id: sticker.id })).status, 404);
    assert.equal((await alice.post('/api/stickers/delete', { id: sticker.id })).status, 200);
    assert.equal((await alice.post('/api/stickers/use', { id: sticker.id, roomId: group })).status, 404);
    assert.deepEqual((await alice.get('/api/stickers')).body.stickers, []);
  });
});

describe('自定义表情（账号模式）', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());
  test('账号模式同样可以收藏和发送', async () => {
    const alice = await space.member('Alice');
    const bob = await space.member('Bob');
    const file = await upload(space, bob, 'lobby', 'a.png', PNG, 'image/png');
    const image = (await send(bob, 'lobby', '', { attachmentIds: [file.id] })).body.message;
    const [sticker] = (await alice.post('/api/stickers', { fileId: image.attachments[0].id })).body.stickers;
    const used = await alice.post('/api/stickers/use', { id: sticker.id, roomId: 'lobby' });
    assert.equal((await send(alice, 'lobby', '', { attachmentIds: [used.body.attachment.id] })).body.message.attachments[0].sticker, true);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startLocal } from './helpers.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex');
const JPEG = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255, 217]);
const cookie = member => [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
async function upload(space, member, query, name, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const response = await fetch(`${space.base}/api/uploads?${new URLSearchParams(query)}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie: cookie(member) }, body: form });
  return { status: response.status, body: await response.json() };
}
const media = (space, member, id) => fetch(`${space.base}/api/media?id=${id}`, { headers: { cookie: cookie(member) } });

describe('图片缩略图', () => {
  let space, alice, bob, carol, direct;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
  });
  after(() => space.close());

  test('原图配上缩略图后发送，附件带 thumbId，会话成员能取到小图', async () => {
    const original = (await upload(space, alice, { roomId: direct }, '照片.png', PNG)).body.attachment;
    const thumb = await upload(space, alice, { roomId: direct, thumbnailFor: original.id }, 'thumb.jpg', JPEG);
    assert.equal(thumb.status, 201);
    const message = (await send(alice, direct, '', { attachmentIds: [original.id] })).body.message;
    assert.equal(message.attachments[0].thumbId, thumb.body.thumbnail.id);
    assert.equal((await media(space, bob, thumb.body.thumbnail.id)).status, 200);
    assert.equal((await media(space, carol, thumb.body.thumbnail.id)).status, 403);
  });

  test('缩略图只能挂在自己未发送的图片上，且必须是图片', async () => {
    const original = (await upload(space, alice, { roomId: direct }, '照片.png', PNG)).body.attachment;
    assert.equal((await upload(space, bob, { roomId: direct, thumbnailFor: original.id }, 't.jpg', JPEG)).status, 400);
    assert.equal((await upload(space, alice, { roomId: 'lobby', thumbnailFor: original.id }, 't.jpg', JPEG)).status, 400);
    assert.equal((await upload(space, alice, { roomId: direct, thumbnailFor: original.id }, 't.txt', Buffer.from('not an image'))).status, 400);
    const file = (await upload(space, alice, { roomId: direct }, '说明.txt', Buffer.from('plain text'))).body.attachment;
    assert.equal((await upload(space, alice, { roomId: direct, thumbnailFor: file.id }, 't.jpg', JPEG)).status, 400);
    await send(alice, direct, '', { attachmentIds: [original.id] });
    assert.equal((await upload(space, alice, { roomId: direct, thumbnailFor: original.id }, 't.jpg', JPEG)).status, 400);
  });

  test('撤回时缩略图一起删除；转发的副本不带原会话的缩略图', async () => {
    const original = (await upload(space, alice, { roomId: direct }, '照片.png', PNG)).body.attachment;
    const thumb = (await upload(space, alice, { roomId: direct, thumbnailFor: original.id }, 't.jpg', JPEG)).body.thumbnail;
    const message = (await send(alice, direct, '', { attachmentIds: [original.id] })).body.message;
    const forwarded = (await alice.post('/api/forward', { roomId: 'lobby', messageIds: [message.id] })).body.messages[0];
    assert.equal(forwarded.attachments[0].thumbId, undefined);
    await alice.post('/api/recall-message', { messageId: message.id });
    assert.equal((await media(space, bob, thumb.id)).status, 404);
  });
});

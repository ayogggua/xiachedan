import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startLocal } from './helpers.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex');
async function upload(space, member, roomId, name, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const cookie = [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  const response = await fetch(`${space.base}/api/uploads?roomId=${encodeURIComponent(roomId)}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie }, body: form });
  return (await response.json()).attachment;
}

describe('会话里的图片与文件', () => {
  let space, alice, bob, carol, direct;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
    const image = await upload(space, alice, direct, '截图.png', PNG);
    const pdf = await upload(space, alice, direct, '合同.pdf', Buffer.from('%PDF-1.7 contract'));
    await send(alice, direct, '两个附件', { attachmentIds: [image.id, pdf.id] });
    const second = await upload(space, bob, direct, '第二张.png', PNG);
    await send(bob, direct, '', { attachmentIds: [second.id] });
    await send(alice, direct, '纯文字');
  });
  after(() => space.close());

  test('按图片和文件分开列出，最新的在前', async () => {
    const media = (await bob.get(`/api/room-files?roomId=${direct}&kind=media`)).body.items;
    assert.deepEqual(media.map(item => item.file.name), ['第二张.png', '截图.png']);
    const files = (await bob.get(`/api/room-files?roomId=${direct}&kind=file`)).body.items;
    assert.deepEqual(files.map(item => item.file.name), ['合同.pdf']);
    assert.equal(files[0].senderId, alice.id);
  });

  test('撤回的消息不再列出；外人看不到', async () => {
    const message = (await bob.get(`/api/messages?roomId=${direct}`)).body.messages.find(item => item.text === '两个附件');
    await alice.post('/api/recall-message', { messageId: message.id });
    assert.deepEqual((await bob.get(`/api/room-files?roomId=${direct}&kind=media`)).body.items.map(item => item.file.name), ['第二张.png']);
    assert.equal((await bob.get(`/api/room-files?roomId=${direct}&kind=file`)).body.items.length, 0);
    assert.equal((await carol.get(`/api/room-files?roomId=${direct}`)).status, 403);
  });
});

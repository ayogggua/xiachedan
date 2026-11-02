import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startLocal } from './helpers.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex');

async function upload(space, member, roomId, name, bytes, purpose) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const cookie = [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  const query = purpose === 'avatar' ? 'purpose=avatar' : `roomId=${encodeURIComponent(roomId)}`;
  const response = await fetch(`${space.base}/api/uploads?${query}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie }, body: form });
  return { status: response.status, body: await response.json() };
}
const media = (space, member, id) => fetch(`${space.base}/api/media?id=${id}`, { headers: { cookie: [...member.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });

describe('发送普通文件', () => {
  let space, alice, bob, carol, direct;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
  });
  after(() => space.close());

  test('非图片视频的文件按普通文件保存，可随消息发送', async () => {
    const uploaded = await upload(space, alice, 'lobby', '季度报告.pdf', Buffer.from('%PDF-1.7 fake report'));
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.attachment.mime, 'application/octet-stream');
    assert.equal(uploaded.body.attachment.name, '季度报告.pdf');
    const sent = await send(alice, 'lobby', '', { attachmentIds: [uploaded.body.attachment.id] });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.attachments[0].name, '季度报告.pdf');
    assert.equal((await bob.get('/api/search?q=季度报告')).body.messages.length, 1);
  });

  test('普通文件只能下载，不能在页面里渲染或执行', async () => {
    const page = '<script>alert(1)</script>';
    const uploaded = await upload(space, alice, 'lobby', 'evil.html', Buffer.from(page));
    await send(alice, 'lobby', '', { attachmentIds: [uploaded.body.attachment.id] });
    const response = await media(space, bob, uploaded.body.attachment.id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.match(response.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''evil\.html$/);
    assert.match(response.headers.get('content-security-policy'), /sandbox/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), page);
  });

  test('图片仍按原类型在页面内显示', async () => {
    const uploaded = await upload(space, alice, 'lobby', 'pixel.png', PNG);
    assert.equal(uploaded.body.attachment.mime, 'image/png');
    await send(alice, 'lobby', '', { attachmentIds: [uploaded.body.attachment.id] });
    const response = await media(space, bob, uploaded.body.attachment.id);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('content-disposition'), null);
  });

  test('私聊里的文件只有双方能下载', async () => {
    const uploaded = await upload(space, alice, direct, '合同.docx', Buffer.from('PK fake docx'));
    await send(alice, direct, '', { attachmentIds: [uploaded.body.attachment.id] });
    assert.equal((await media(space, bob, uploaded.body.attachment.id)).status, 200);
    assert.equal((await media(space, carol, uploaded.body.attachment.id)).status, 403);
    assert.equal((await upload(space, carol, direct, 'x.txt', Buffer.from('x'))).status, 403);
  });

  test('头像仍然只接受图片', async () => {
    assert.equal((await upload(space, alice, null, 'avatar.pdf', Buffer.from('%PDF'), 'avatar')).status, 400);
    assert.equal((await upload(space, alice, null, 'avatar.png', PNG, 'avatar')).status, 201);
  });
});

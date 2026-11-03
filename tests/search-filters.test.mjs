import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startLocal } from './helpers.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex');
async function upload(space, member, roomId, name, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const cookie = [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  return (await (await fetch(`${space.base}/api/uploads?roomId=${roomId}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie }, body: form })).json()).attachment;
}

describe('搜索筛选', () => {
  let space, alice, bob, start;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    start = Date.now();
    await send(alice, 'lobby', '方案初稿 https://example.com/plan');
    await send(bob, 'lobby', '方案我看过了');
    const image = await upload(space, bob, 'lobby', '方案截图.png', PNG);
    await send(bob, 'lobby', '', { attachmentIds: [image.id] });
    const pdf = await upload(space, alice, 'lobby', '方案.pdf', Buffer.from('%PDF-1.7 plan'));
    await send(alice, 'lobby', '', { attachmentIds: [pdf.id] });
  });
  after(() => space.close());

  const search = query => bob.get(`/api/search?${new URLSearchParams(query)}`).then(result => result.body.messages);

  test('按发送人筛选', async () => {
    assert.deepEqual((await search({ q: '方案', sender: alice.id })).map(message => message.senderId), [alice.id, alice.id]);
  });

  test('按类型筛选，关键词可以为空', async () => {
    assert.equal((await search({ type: 'image' })).length, 1);
    assert.equal((await search({ type: 'file' }))[0].attachments[0].name, '方案.pdf');
    assert.equal((await search({ q: '方案', type: 'link' }))[0].text, '方案初稿 https://example.com/plan');
  });

  test('按时间筛选', async () => {
    assert.equal((await search({ q: '方案', from: String(Date.now() + 60000) })).length, 0);
    assert.equal((await search({ q: '方案', from: String(start - 1000), to: String(Date.now() + 1000) })).length, 4);
  });

  test('参数无效会被拒绝；没有关键词也没有筛选时返回空', async () => {
    assert.equal((await bob.get('/api/search?type=sticker')).status, 400);
    assert.equal((await bob.get('/api/search?from=yesterday')).status, 400);
    assert.equal((await search({})).length, 0);
  });
});

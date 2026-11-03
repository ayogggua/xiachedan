import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startLocal } from './helpers.mjs';

async function upload(space, member, roomId, name, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const cookie = [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  return (await (await fetch(`${space.base}/api/uploads?roomId=${roomId}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie }, body: form })).json()).attachment;
}
const media = (space, member, id) => fetch(`${space.base}/api/media?id=${id}`, { headers: { cookie: [...member.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });

describe('合并转发', () => {
  let space, alice, bob, carol, direct, group;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
    group = (await alice.post('/api/rooms', { name: '项目组', memberIds: [carol.id] })).body.id;
  });
  after(() => space.close());

  test('多条私聊消息合成一条聊天记录发到群里，附件群成员能打开、原件仍受限', async () => {
    const first = (await send(alice, direct, '方案定了吗')).body.message;
    const pdf = await upload(space, bob, direct, '方案.pdf', Buffer.from('%PDF-1.7 plan'));
    const second = (await send(bob, direct, '定了，附件在这', { attachmentIds: [pdf.id] })).body.message;
    const result = await alice.post('/api/forward', { roomId: group, messageIds: [first.id, second.id], merge: true });
    assert.equal(result.status, 201);
    assert.equal(result.body.messages.length, 1);
    const bundle = result.body.messages[0].bundle;
    assert.equal(bundle.title, 'Alice 和 Bob 的聊天记录');
    assert.deepEqual(bundle.items.map(item => [item.senderName, item.text]), [['Alice', '方案定了吗'], ['Bob', '定了，附件在这']]);
    const copy = bundle.items[1].attachments[0];
    assert.notEqual(copy.id, pdf.id);
    assert.equal((await media(space, carol, copy.id)).status, 200);
    assert.equal((await media(space, carol, pdf.id)).status, 403);
  });

  test('聊天记录可以再转发，附件跟着复制；撤回后附件一并删除', async () => {
    const message = (await carol.get(`/api/messages?roomId=${group}`)).body.messages.at(-1);
    const again = (await carol.post('/api/forward', { roomId: 'lobby', messageIds: [message.id] })).body.messages[0];
    assert.equal(again.bundle.title, 'Alice 和 Bob 的聊天记录');
    const lobbyCopy = again.bundle.items[1].attachments[0].id;
    assert.notEqual(lobbyCopy, message.bundle.items[1].attachments[0].id);
    assert.equal((await media(space, bob, lobbyCopy)).status, 200);
    await carol.post('/api/recall-message', { messageId: again.id });
    assert.equal((await media(space, bob, lobbyCopy)).status, 404);
  });

  test('群聊来源的标题、导出里能看到内容', async () => {
    const one = (await send(alice, group, '周会改到周三')).body.message;
    const forwarded = (await alice.post('/api/forward', { roomId: 'lobby', messageIds: [one.id], merge: true })).body.messages[0];
    assert.equal(forwarded.bundle.title, '「项目组」的聊天记录');
    const text = (await alice.get('/api/export?roomId=lobby')).body;
    assert.match(text, /\[聊天记录\] 「项目组」的聊天记录\n  Alice：周会改到周三/);
  });
});

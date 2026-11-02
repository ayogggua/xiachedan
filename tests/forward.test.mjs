import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startCloud, startLocal } from './helpers.mjs';

async function upload(space, member, roomId, name, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const cookie = [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  return (await (await fetch(`${space.base}/api/uploads?roomId=${encodeURIComponent(roomId)}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie }, body: form })).json()).attachment;
}
const download = (space, member, id) => fetch(`${space.base}/api/media?id=${id}`, { headers: { cookie: [...member.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });

describe('转发', () => {
  let space, alice, bob, carol, aliceBob, team;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    aliceBob = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
    team = (await bob.post('/api/rooms', { name: '项目组', memberIds: [carol.id] })).body.id;
  });
  after(() => space.close());

  test('按原顺序逐条转发，标明原发送人', async () => {
    const first = (await send(alice, aliceBob, '第一条')).body.message;
    const second = (await send(bob, aliceBob, '第二条')).body.message;
    const result = await bob.post('/api/forward', { roomId: team, messageIds: [second.id, first.id] });
    assert.equal(result.status, 201);
    assert.deepEqual(result.body.messages.map(message => message.text), ['第一条', '第二条']);
    assert.ok(result.body.messages.every(message => message.senderId === bob.id && message.roomId === team));
    assert.deepEqual(result.body.messages.map(message => message.forwardedFrom.senderId), [alice.id, bob.id]);
    assert.equal(result.body.messages[0].forwardedFrom.createdAt, first.createdAt);
  });

  test('目标会话的人能下载转发来的附件，即使看不到原会话', async () => {
    const file = await upload(space, alice, aliceBob, '方案.pdf', Buffer.from('%PDF secret plan'));
    const original = (await send(alice, aliceBob, '', { attachmentIds: [file.id] })).body.message;
    assert.equal((await download(space, carol, file.id)).status, 403);
    const forwarded = (await bob.post('/api/forward', { roomId: team, messageIds: [original.id] })).body.messages[0];
    const copy = forwarded.attachments[0];
    assert.notEqual(copy.id, file.id);
    assert.equal(copy.name, '方案.pdf');
    const response = await download(space, carol, copy.id);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '%PDF secret plan');
    assert.equal((await download(space, carol, file.id)).status, 403);
  });

  test('撤回转发出去的那条，不影响原消息的附件', async () => {
    const file = await upload(space, alice, aliceBob, '图纸.txt', Buffer.from('drawing'));
    const original = (await send(alice, aliceBob, '', { attachmentIds: [file.id] })).body.message;
    const forwarded = (await bob.post('/api/forward', { roomId: team, messageIds: [original.id] })).body.messages[0];
    assert.equal((await bob.post('/api/recall-message', { messageId: forwarded.id })).status, 200);
    assert.equal((await download(space, carol, forwarded.attachments[0].id)).status, 404);
    const response = await download(space, bob, file.id);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'drawing');
  });

  test('再次转发仍显示最初的发送人', async () => {
    const original = (await send(alice, aliceBob, '源头')).body.message;
    const once = (await bob.post('/api/forward', { roomId: team, messageIds: [original.id] })).body.messages[0];
    const twice = (await carol.post('/api/forward', { roomId: 'lobby', messageIds: [once.id] })).body.messages[0];
    assert.equal(twice.forwardedFrom.senderId, alice.id);
  });

  test('不能转发看不到的、已撤回的消息，也不能转发到自己不在的会话', async () => {
    const secret = (await send(alice, aliceBob, '只给 Bob')).body.message;
    assert.equal((await carol.post('/api/forward', { roomId: team, messageIds: [secret.id] })).status, 403);
    assert.equal((await alice.post('/api/forward', { roomId: team, messageIds: [secret.id] })).status, 403);
    const recalled = (await send(alice, 'lobby', '撤回了')).body.message;
    await alice.post('/api/recall-message', { messageId: recalled.id });
    assert.equal((await alice.post('/api/forward', { roomId: 'lobby', messageIds: [recalled.id] })).status, 404);
    assert.equal((await alice.post('/api/forward', { roomId: 'lobby', messageIds: [] })).status, 400);
    assert.equal((await alice.post('/api/forward', { roomId: 'lobby', messageIds: ['missing'] })).status, 404);
  });
});

describe('账号模式下的转发', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('审核通过的成员可以转发', async () => {
    const alice = await space.member('Alice'), bob = await space.member('Bob');
    const direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
    const message = (await send(alice, 'lobby', '云端转发')).body.message;
    const result = await alice.post('/api/forward', { roomId: direct, messageIds: [message.id] });
    assert.equal(result.status, 201);
    assert.equal(result.body.messages[0].forwardedFrom.senderId, alice.id);
  });
});

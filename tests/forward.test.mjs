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

  test('多选里夹着名片、拍一拍、已撤回的消息时跳过它们，其余照常转发', async () => {
    const kept = (await send(alice, aliceBob, '留下')).body.message;
    const card = (await alice.post('/api/contact-card', { roomId: aliceBob, userId: carol.id })).body.message;
    const recalled = (await send(alice, aliceBob, '撤回')).body.message;
    await alice.post('/api/recall-message', { messageId: recalled.id });
    for (const merge of [false, true]) {
      const result = await alice.post('/api/forward', { roomId: 'lobby', messageIds: [kept.id, card.id, recalled.id, 'missing'], merge });
      assert.equal(result.status, 201);
      assert.equal(result.body.skipped, 3);
      assert.equal(result.body.messages.length, 1);
      if (merge) assert.deepEqual(result.body.messages[0].bundle.items.map(item => item.text), ['留下']);
      else assert.equal(result.body.messages[0].text, '留下');
    }
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

// 多选一次最多 100 条：逐条转发、合并转发和只对自己删除都按这个数校验，超出时要说清楚是条数超了。
async function checkBatchLimit(sender, roomId, targetId) {
  const ids = [];
  for (let index = 1; index <= 100; index++) ids.push((await send(sender, roomId, `第 ${index} 条`)).body.message.id);
  const each = await sender.post('/api/forward', { roomId: targetId, messageIds: ids });
  assert.equal(each.status, 201);
  assert.deepEqual([each.body.messages.length, each.body.messages.at(-1).text], [100, '第 100 条']);
  const merged = await sender.post('/api/forward', { roomId: targetId, messageIds: ids, merge: true });
  assert.equal(merged.status, 201);
  assert.equal(merged.body.messages[0].bundle.items.length, 100);
  const over = [...ids, 'one-more'];
  assert.deepEqual(await sender.post('/api/forward', { roomId: targetId, messageIds: over }), { status: 400, body: { error: '一次最多转发 100 条消息' } });
  assert.deepEqual(await sender.post('/api/forward', { roomId: targetId, messageIds: over, merge: true }), { status: 400, body: { error: '一次最多转发 100 条消息' } });
  assert.deepEqual(await sender.post('/api/forward', { roomId: targetId, messageIds: [] }), { status: 400, body: { error: '请选择要转发的消息' } });
  assert.deepEqual(await sender.post('/api/messages/hide', { messageIds: over }), { status: 400, body: { error: '一次最多删除 100 条消息' } });
  assert.equal((await sender.post('/api/messages/hide', { messageIds: ids })).status, 200);
}

describe('一次转发、删除的条数上限', () => {
  test('局域网模式', async () => {
    const space = await startLocal();
    try {
      const alice = await space.join('Alice'), bob = await space.join('Bob');
      await checkBatchLimit(alice, 'lobby', (await alice.post('/api/rooms', { userId: bob.id })).body.id);
    } finally { await space.close(); }
  });

  test('账号模式', async () => {
    const space = await startCloud();
    try {
      const alice = await space.member('Alice'), bob = await space.member('Bob');
      await checkBatchLimit(alice, 'lobby', (await alice.post('/api/rooms', { userId: bob.id })).body.id);
    } finally { await space.close(); }
  });
});

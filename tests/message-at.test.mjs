import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { send, startLocal } from './helpers.mjs';

describe('按日期跳到聊天记录', () => {
  let space, alice, bob, group, ids;
  const DAY = 86400000, base = Date.UTC(2026, 9, 1);
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    group = (await alice.post('/api/rooms', { name: '日期群', memberIds: [bob.id] })).body.id;
    ids = [];
    for (const text of ['10 月 1 日', '10 月 3 日', '10 月 5 日']) ids.push((await send(bob, group, text)).body.message.id);
    const db = new DatabaseSync(path.join(space.dataDir, 'chat.sqlite'));
    ids.forEach((id, index) => db.prepare('UPDATE messages SET created_at=? WHERE id=?').run(base + index * 2 * DAY + 3600000, id));
    db.close();
  });
  after(() => space.close());
  const at = (member, time) => member.get(`/api/message-at?roomId=${group}&time=${time}`);

  test('返回那天的第一条；那天没有就返回之后最近的一条；之后都没有就 404', async () => {
    assert.equal((await at(alice, base)).body.id, ids[0]);
    assert.equal((await at(alice, base + DAY)).body.id, ids[1]);
    assert.equal((await at(alice, base + 4 * DAY)).body.id, ids[2]);
    assert.equal((await at(alice, base + 30 * DAY)).status, 404);
  });

  test('跳过自己删掉的；外人不能查；日期无效时拒绝', async () => {
    await alice.post('/api/messages/hide', { messageIds: [ids[1]] });
    assert.equal((await at(alice, base + DAY)).body.id, ids[2]);
    assert.equal((await at(bob, base + DAY)).body.id, ids[1]);
    const carol = await space.join('Carol');
    assert.equal((await at(carol, base)).status, 403);
    assert.equal((await alice.get(`/api/message-at?roomId=${group}&time=abc`)).status, 400);
  });
});

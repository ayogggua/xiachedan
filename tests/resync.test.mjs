import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startLocal } from './helpers.mjs';

describe('断线后补齐消息', () => {
  let space, alice, bob, carol, group;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '补齐', memberIds: [bob.id] })).body.id;
  });
  after(() => space.close());

  test('按 seq 往后取，不含话题回复，超过 200 条分页', async () => {
    const first = (await send(alice, group, '断线前最后一条')).body.message;
    const root = (await send(bob, group, '根消息')).body.message;
    await send(alice, group, '话题回复', { threadOf: root.id });
    const empty = await alice.get(`/api/messages?roomId=${group}&after=${(await alice.get(`/api/messages?roomId=${group}`)).body.messages.at(-1).seq}`);
    assert.deepEqual(empty.body, { messages: [], hasNewer: false });
    const missed = (await alice.get(`/api/messages?roomId=${group}&after=${first.seq}`)).body;
    assert.deepEqual(missed.messages.map(message => message.text), ['根消息']);
    assert.equal(missed.hasNewer, false);
    for (let index = 0; index < 205; index++) await send(index % 2 ? alice : bob, group, `第 ${index} 条`);
    const page = (await alice.get(`/api/messages?roomId=${group}&after=${root.seq}`)).body;
    assert.equal(page.messages.length, 200);
    assert.equal(page.hasNewer, true);
    assert.equal(page.messages[0].text, '第 0 条');
    const rest = (await alice.get(`/api/messages?roomId=${group}&after=${page.messages.at(-1).seq}`)).body;
    assert.deepEqual(rest.messages.map(message => message.text), ['第 200 条', '第 201 条', '第 202 条', '第 203 条', '第 204 条']);
    assert.equal(rest.hasNewer, false);
  });

  test('不在会话里的人不能补齐', async () => {
    assert.equal((await carol.get(`/api/messages?roomId=${group}&after=0`)).status, 403);
  });
});

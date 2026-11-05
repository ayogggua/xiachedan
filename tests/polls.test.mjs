import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, settle, startLocal } from './helpers.mjs';

describe('投票', () => {
  let space, alice, bob, carol, group;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '午饭群', memberIds: [bob.id] })).body.id;
  });
  after(() => space.close());

  test('发起单选投票，成员投票后大家实时看到结果；投过不能改票、不能撤票', async () => {
    const created = await alice.post('/api/polls', { roomId: group, question: '中午吃什么', options: ['面', '饭', '饺子'] });
    assert.equal(created.status, 201);
    const id = created.body.message.id;
    assert.equal(created.body.message.text, '中午吃什么');
    const live = await listen(space.base, alice);
    assert.equal((await bob.post('/api/polls/vote', { messageId: id, options: [1] })).status, 200);
    await settle();
    assert.deepEqual(live.events.find(event => event.type === 'message-poll').poll.options[1].voters, [bob.id]);
    live.close();
    const changed = await bob.post('/api/polls/vote', { messageId: id, options: [2] });
    assert.equal(changed.status, 400);
    assert.equal(changed.body.error, '已经投过票，不能更改');
    assert.equal((await bob.post('/api/polls/vote', { messageId: id, options: [] })).status, 400);
    assert.equal((await alice.post('/api/polls/vote', { messageId: id, options: [0, 1] })).status, 400);
    assert.equal((await alice.post('/api/polls/vote', { messageId: id, options: [] })).status, 400);
    const poll = (await alice.get(`/api/messages?roomId=${group}`)).body.messages.at(-1).poll;
    assert.deepEqual(poll.options.map(option => option.voters.length), [0, 1, 0]);
  });

  test('多选投票可以选多个；发起人结束后不能再投', async () => {
    const id = (await alice.post('/api/polls', { roomId: group, question: '周末去哪', options: ['爬山', '看展', '睡觉'], multiple: true })).body.message.id;
    assert.equal((await bob.post('/api/polls/vote', { messageId: id, options: [0, 2] })).status, 200);
    assert.equal((await bob.post('/api/polls/close', { messageId: id })).status, 403);
    assert.ok((await alice.post('/api/polls/close', { messageId: id })).body.poll.closedAt);
    assert.equal((await alice.post('/api/polls/vote', { messageId: id, options: [1] })).status, 400);
  });

  test('选项要 2–10 个且不重复；外人不能投；投票不能编辑', async () => {
    assert.equal((await alice.post('/api/polls', { roomId: group, question: '只有一个', options: ['甲'] })).status, 400);
    assert.equal((await alice.post('/api/polls', { roomId: group, question: '重复', options: ['甲', '甲'] })).status, 400);
    assert.equal((await alice.post('/api/polls', { roomId: group, question: '', options: ['甲', '乙'] })).status, 400);
    const id = (await alice.post('/api/polls', { roomId: group, question: '内部投票', options: ['甲', '乙'] })).body.message.id;
    assert.equal((await carol.post('/api/polls/vote', { messageId: id, options: [0] })).status, 403);
    assert.equal((await alice.post('/api/edit-message', { messageId: id, text: '改问题' })).status, 400);
  });
});

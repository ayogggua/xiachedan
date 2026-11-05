import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startLocal } from './helpers.mjs';

describe('引用部分文字', () => {
  let space, alice, bob;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
  });
  after(() => space.close());
  const replyOf = async (member, id) => (await member.get('/api/messages?roomId=lobby')).body.messages.find(message => message.id === id).replyTo;

  test('选中渲染后的文字也能引用带格式的原文，引用里只显示这一段', async () => {
    const original = (await send(alice, 'lobby', '通知：**周五** 下午\n三点开会，记得带电脑')).body.message;
    const reply = await send(bob, 'lobby', '收到', { replyTo: original.id, replyQuote: '  周五 下午三点开会 ' });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.message.replyTo.quote, '周五 下午三点开会');
    assert.equal((await replyOf(alice, reply.body.message.id)).quote, '周五 下午三点开会');
    const plain = (await send(bob, 'lobby', '普通引用', { replyTo: original.id })).body.message;
    assert.equal(plain.replyTo.quote, undefined);
  });

  test('不在原文里、过长的引用被拒绝；没有引用目标时忽略', async () => {
    const original = (await send(alice, 'lobby', '只有这一句')).body.message;
    assert.equal((await send(bob, 'lobby', 'x', { replyTo: original.id, replyQuote: '编造的内容' })).status, 400);
    assert.equal((await send(bob, 'lobby', 'x', { replyTo: original.id, replyQuote: '只'.repeat(501) })).status, 400);
    assert.equal((await send(bob, 'lobby', 'x', { replyTo: original.id, replyQuote: '***' })).status, 400);
    assert.equal((await send(bob, 'lobby', '没有引用目标', { replyQuote: '随便' })).status, 201);
  });

  test('原消息撤回后，引用片段一起消失', async () => {
    const original = (await send(alice, 'lobby', '这句话稍后会撤回')).body.message;
    const reply = (await send(bob, 'lobby', '引用', { replyTo: original.id, replyQuote: '稍后会撤回' })).body.message;
    await alice.post('/api/recall-message', { messageId: original.id });
    const replyTo = await replyOf(bob, reply.id);
    assert.equal(replyTo.recalled, true);
    assert.equal(replyTo.quote, undefined);
  });
});

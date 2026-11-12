import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startCloud, startLocal } from './helpers.mjs';

// 两种模式共用：setup 返回 { space, starter, member, outsider, manager, group }，manager 是空间管理者。
async function localSetup() {
  const space = await startLocal();
  const [starter, member, outsider, extra] = [await space.join('Alice'), await space.join('Bob'), await space.join('Carol'), await space.join('Dave')];
  return { space, starter, member, outsider, extra, manager: space.owner, managerId: space.ownerId };
}
async function cloudSetup() {
  const space = await startCloud();
  const [starter, member, outsider, extra] = [await space.member('Alice'), await space.member('Bob'), await space.member('Carol'), await space.member('Dave')];
  return { space, starter, member, outsider, extra, manager: space.admin, managerId: space.admin.id };
}

for (const [mode, setup] of [['局域网', localSetup], ['账号', cloudSetup]]) describe(`接龙（${mode}模式）`, () => {
  let ctx, group, direct;
  const chain = async (id, who = ctx.member) => (await who.get(`/api/messages?roomId=${group}`)).body.messages.find(message => message.id === id)?.chain;
  // 发起接龙每人每分钟最多 10 次：校验类的请求换别人发。
  const create = (extra = {}, who = ctx.starter) => who.post('/api/chains', { roomId: group, title: '周五团建报名', description: '写上名字和人数', example: '张三 2 人', ...extra });
  before(async () => {
    ctx = await setup();
    group = (await ctx.starter.post('/api/rooms', { name: '团建群', memberIds: [ctx.member.id, ctx.extra.id] })).body.id;
    direct = (await ctx.starter.post('/api/rooms', { userId: ctx.member.id })).body.id;
  });
  after(() => ctx.space.close());

  test('发起接龙是一条消息卡片；加入、修改、退出都在原卡片上更新，按加入先后编号', async () => {
    const live = await listen(ctx.space.base, ctx.member);
    const created = await create();
    assert.equal(created.status, 201);
    const message = created.body.message;
    assert.equal(message.text, '周五团建报名');
    assert.deepEqual(message.chain, { description: '写上名字和人数', example: '张三 2 人', closedAt: null, closedBy: null, entries: [] });
    await settle();
    assert.ok(live.events.some(event => event.type === 'message' && event.message.id === message.id));
    live.clear();
    assert.equal((await ctx.member.post('/api/chains/entry', { messageId: message.id, text: 'Bob 1 人' })).status, 200);
    assert.equal((await ctx.starter.post('/api/chains/entry', { messageId: message.id, text: '  Alice\n2 人  ' })).status, 200);
    await settle();
    const updates = live.events.filter(event => event.type === 'message-chain');
    assert.equal(updates.length, 2);
    assert.ok(!live.events.some(event => event.type === 'message'), '接龙更新不是新消息');
    assert.deepEqual(updates.at(-1).chain.entries.map(entry => [entry.userId, entry.text]), [[ctx.member.id, 'Bob 1 人'], [ctx.starter.id, 'Alice 2 人']]);
    // 修改自己的一行：位置不变，记下修改时间。
    await ctx.member.post('/api/chains/entry', { messageId: message.id, text: 'Bob 3 人' });
    let entries = (await chain(message.id)).entries;
    assert.deepEqual(entries.map(entry => entry.text), ['Bob 3 人', 'Alice 2 人']);
    assert.ok(entries[0].editedAt);
    // 退出后后面的人往前顺；再加入排到最后。
    assert.equal((await ctx.member.post('/api/chains/withdraw', { messageId: message.id })).status, 200);
    assert.deepEqual((await chain(message.id)).entries.map(entry => entry.userId), [ctx.starter.id]);
    assert.equal((await ctx.member.post('/api/chains/withdraw', { messageId: message.id })).status, 400);
    await ctx.member.post('/api/chains/entry', { messageId: message.id, text: 'Bob 又来了' });
    entries = (await chain(message.id)).entries;
    assert.deepEqual(entries.map(entry => entry.userId), [ctx.starter.id, ctx.member.id]);
    live.close();
    // 接龙更新不算未读：会话里只有一条接龙消息。
    const unread = (await ctx.extra.post('/api/unread-counts', { cursors: { [group]: 0 } })).body.rooms.find(room => room.id === group);
    assert.equal(unread.unreadCount, 1);
  });

  test('同时加入的人序号不会重复；每人只有一行；最多 200 行', async () => {
    const id = (await create({ title: '并发报名' })).body.message.id;
    const people = [ctx.starter, ctx.member, ctx.extra];
    const results = await Promise.all([...people, ...people].map((who, index) => who.post('/api/chains/entry', { messageId: id, text: `第 ${index} 次` })));
    assert.ok(results.every(result => result.status === 200));
    const entries = (await chain(id)).entries;
    assert.equal(entries.length, 3);
    assert.equal(new Set(entries.map(entry => entry.userId)).size, 3);
    // 编号由位置决定，加入时间单调不减。
    assert.ok(entries.every((entry, index) => !index || entries[index - 1].joinedAt <= entry.joinedAt));
  });

  test('人数上限 200', async () => {
    const id = (await create({ title: '满员测试' })).body.message.id;
    const { DatabaseSync } = await import('node:sqlite');
    const path = await import('node:path');
    const db = new DatabaseSync(path.join(ctx.space.dataDir, 'chat.sqlite'));
    const insert = db.prepare('INSERT INTO chain_entries (message_id,user_id,text,joined_at) VALUES (?,?,?,?)');
    for (let index = 0; index < 200; index++) insert.run(id, `fake-${index}`, `占位 ${index}`, Date.now());
    db.close();
    const full = await ctx.member.post('/api/chains/entry', { messageId: id, text: '挤一下' });
    assert.equal(full.status, 400);
    assert.match(full.body.error, /200/);
  });

  test('标题、说明、示例和每行的长度由服务端校验；私聊里不能发起', async () => {
    assert.equal((await create({ title: '   ' }, ctx.extra)).status, 400);
    assert.equal((await create({ title: '长'.repeat(101) }, ctx.extra)).status, 400);
    assert.equal((await create({ description: '长'.repeat(501) }, ctx.extra)).status, 400);
    assert.equal((await create({ example: '长'.repeat(101) }, ctx.extra)).status, 400);
    assert.equal((await create({ title: '长'.repeat(100), description: '长'.repeat(500), example: '长'.repeat(100) }, ctx.extra)).status, 201);
    const directTry = await ctx.member.post('/api/chains', { roomId: direct, title: '私聊接龙' });
    assert.equal(directTry.status, 400);
    assert.equal(directTry.body.error, '私聊里不能发起接龙');
    assert.equal((await ctx.member.post('/api/chains', { roomId: 'lobby', title: '大厅接龙' })).status, 201);
    const id = (await create({ title: '长度' }, ctx.member)).body.message.id;
    assert.equal((await ctx.member.post('/api/chains/entry', { messageId: id, text: '' })).status, 400);
    assert.equal((await ctx.member.post('/api/chains/entry', { messageId: id, text: '字'.repeat(101) })).status, 400);
    assert.equal((await ctx.member.post('/api/chains/entry', { messageId: id, text: '字'.repeat(100) })).status, 200);
    assert.equal((await ctx.member.post('/api/chains/entry', { messageId: 'nope', text: '不存在' })).status, 404);
  });

  test('外人不能加入或结束；离开群的人那一行保留但改不了', async () => {
    const id = (await create({ title: '权限测试' })).body.message.id;
    assert.equal((await ctx.outsider.post('/api/chains/entry', { messageId: id, text: '外人' })).status, 403);
    assert.equal((await ctx.outsider.post('/api/chains/close', { messageId: id })).status, 403);
    const leaver = await (ctx.space.join ? ctx.space.join('Eve') : ctx.space.member('Eve'));
    await ctx.starter.post('/api/room-members', { roomId: group, memberIds: [leaver.id] });
    assert.equal((await leaver.post('/api/chains/entry', { messageId: id, text: 'Eve 来了' })).status, 200);
    assert.equal((await leaver.post('/api/room-leave', { roomId: group })).status, 200);
    assert.equal((await leaver.post('/api/chains/entry', { messageId: id, text: 'Eve 改一下' })).status, 403);
    assert.equal((await leaver.post('/api/chains/withdraw', { messageId: id })).status, 403);
    assert.deepEqual((await chain(id)).entries.map(entry => [entry.userId, entry.text]), [[leaver.id, 'Eve 来了']]);
  });

  test('被禁言、全员禁言时不能加入、修改或退出', async () => {
    const id = (await create({ title: '禁言测试' })).body.message.id;
    await ctx.member.post('/api/chains/entry', { messageId: id, text: 'Bob' });
    assert.equal((await ctx.starter.post('/api/room-policy', { roomId: group, allMuted: true })).status, 200);
    assert.equal((await ctx.member.post('/api/chains/entry', { messageId: id, text: 'Bob 改' })).status, 403);
    assert.equal((await ctx.member.post('/api/chains/withdraw', { messageId: id })).status, 403);
    assert.equal((await ctx.extra.post('/api/chains/entry', { messageId: id, text: 'Dave' })).status, 403);
    // 群主不受全员禁言限制。
    assert.equal((await ctx.starter.post('/api/chains/entry', { messageId: id, text: 'Alice' })).status, 200);
    await ctx.starter.post('/api/room-policy', { roomId: group, allMuted: false });
    assert.equal((await ctx.manager.post('/api/admin/mute', { userId: ctx.extra.id, minutes: 10 })).status, 200);
    assert.equal((await ctx.extra.post('/api/chains/entry', { messageId: id, text: 'Dave' })).status, 403);
    assert.equal((await ctx.extra.post('/api/chains', { roomId: group, title: '禁言发起' })).status, 403);
    await ctx.manager.post('/api/admin/mute', { userId: ctx.extra.id, muted: false });
    assert.equal((await ctx.extra.post('/api/chains/entry', { messageId: id, text: 'Dave' })).status, 200);
  });

  test('发起人、群主和群管理员可以结束；结束后谁都不能加入、修改或退出', async () => {
    const id = (await create({ title: '结束测试' })).body.message.id;
    await ctx.member.post('/api/chains/entry', { messageId: id, text: 'Bob' });
    assert.equal((await ctx.member.post('/api/chains/close', { messageId: id })).status, 403);
    const closed = await ctx.starter.post('/api/chains/close', { messageId: id });
    assert.equal(closed.status, 200);
    assert.ok(closed.body.chain.closedAt);
    assert.equal(closed.body.chain.closedBy, ctx.starter.id);
    for (const [who, route] of [[ctx.member, 'entry'], [ctx.member, 'withdraw'], [ctx.extra, 'entry'], [ctx.starter, 'entry']]) {
      const result = await who.post(`/api/chains/${route}`, { messageId: id, text: '晚了' });
      assert.equal(result.status, 400);
      assert.equal(result.body.error, '接龙已结束');
    }
    // 别人发起的接龙：群管理员也能结束。
    const other = (await ctx.member.post('/api/chains', { roomId: group, title: 'Bob 发起' })).body.message.id;
    assert.equal((await ctx.extra.post('/api/chains/close', { messageId: other })).status, 403);
    await ctx.starter.post('/api/room-admins', { roomId: group, userId: ctx.extra.id, admin: true });
    assert.equal((await ctx.extra.post('/api/chains/close', { messageId: other })).status, 200);
    // 大厅里由空间管理者结束别人发起的接龙。
    const lobby = (await ctx.member.post('/api/chains', { roomId: 'lobby', title: '大厅报名' })).body.message.id;
    assert.equal((await ctx.starter.post('/api/chains/close', { messageId: lobby })).status, 403);
    assert.equal((await ctx.manager.post('/api/chains/close', { messageId: lobby })).status, 200);
  });

  test('不能编辑；撤回后卡片和每一行都清掉；预览、引用、搜索、导出都显示 [接龙] 标题', async () => {
    const message = (await create({ title: '午饭订餐' })).body.message;
    await ctx.member.post('/api/chains/entry', { messageId: message.id, text: '黄焖鸡' });
    assert.equal((await ctx.starter.post('/api/edit-message', { messageId: message.id, text: '改标题' })).status, 400);
    const room = (await ctx.member.get('/api/state')).body.rooms.find(item => item.id === group);
    assert.equal(room.lastMessage.id, message.id);
    const reply = (await send(ctx.member, group, '我也要', { replyTo: message.id })).body.message;
    assert.equal(reply.replyTo.chain, true);
    assert.equal(reply.replyTo.text, '午饭订餐');
    const found = (await ctx.member.get(`/api/search?roomId=${group}&q=${encodeURIComponent('午饭订餐')}`)).body.messages;
    assert.ok(found.some(item => item.id === message.id && item.chain));
    const exported = (await ctx.member.get(`/api/export?roomId=${group}`)).body;
    assert.match(exported, /\[接龙\] 午饭订餐\n写上名字和人数\n {2}1\. Bob：黄焖鸡/);
    const recalled = await ctx.starter.post('/api/recall-message', { messageId: message.id });
    assert.equal(recalled.status, 200);
    assert.equal(recalled.body.message.chain, null);
    assert.equal((await ctx.member.post('/api/chains/entry', { messageId: message.id, text: '还能接吗' })).status, 404);
    const { DatabaseSync } = await import('node:sqlite');
    const path = await import('node:path');
    const db = new DatabaseSync(path.join(ctx.space.dataDir, 'chat.sqlite'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chain_entries WHERE message_id=?').get(message.id).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chains WHERE message_id=?').get(message.id).n, 0);
    db.close();
  });
});

describe('接龙的预览文字', () => {
  test('previewText 显示 [接龙] 标题', async () => {
    const { previewText } = await import('../shared/preview.js');
    assert.equal(previewText({ text: '周五团建', attachments: [], chain: { entries: [] } }), '[接龙] 周五团建');
    assert.equal(previewText({ text: '周五团建', attachments: [], chain: true }), '[接龙] 周五团建');
  });
});

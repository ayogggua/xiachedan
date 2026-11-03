import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, startCloud, startLocal } from './helpers.mjs';

async function upload(space, member, roomId, name, bytes, query = {}) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const cookie = [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  const response = await fetch(`${space.base}/api/uploads?${new URLSearchParams({ roomId, ...query })}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie }, body: form });
  return (await response.json()).attachment;
}

describe('导出聊天记录', () => {
  let space, alice, bob, carol, direct;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
  });
  after(() => space.close());

  test('导出文字、引用、附件、转发与撤回，带文件名下载', async () => {
    const first = (await send(alice, 'lobby', '周五聚餐')).body.message;
    await send(bob, 'lobby', '我报名', { replyTo: first.id });
    const file = await upload(space, alice, 'lobby', '菜单.pdf', Buffer.from('%PDF-1.7 menu'));
    await send(alice, 'lobby', '', { attachmentIds: [file.id] });
    const recalled = (await send(bob, 'lobby', '发错了')).body.message;
    await bob.post('/api/recall-message', { messageId: recalled.id });
    const secret = (await send(alice, direct, '私聊里的话')).body.message;
    await bob.post('/api/forward', { roomId: 'lobby', messageIds: [secret.id] });
    const exported = await bob.get('/api/export?roomId=lobby&tz=-480');
    assert.equal(exported.status, 200);
    const text = exported.body;
    assert.match(text, /^虾扯蛋聊天记录\n会话：大厅\n/);
    assert.match(text, /共 5 条消息/);
    assert.match(text, /Alice\n周五聚餐/);
    assert.match(text, /Bob\n↪ 回复 Alice：周五聚餐\n我报名/);
    assert.match(text, /\[附件\] 菜单\.pdf（1 KB）/);
    assert.match(text, /（消息已撤回）/);
    assert.doesNotMatch(text, /发错了/);
    assert.match(text, /Bob（转发自 Alice）\n私聊里的话/);
  });

  test('响应为附件下载，文件名含会话名', async () => {
    const response = await fetch(`${space.base}/api/export?roomId=lobby`, { headers: { cookie: [...alice.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.match(decodeURIComponent(response.headers.get('content-disposition')), /attachment; filename\*=UTF-8''虾扯蛋-大厅-\d{8}\.txt/);
  });

  test('按客户端时区显示时间', async () => {
    const utc = (await alice.get(`/api/export?roomId=${direct}&tz=0`)).body;
    const beijing = (await alice.get(`/api/export?roomId=${direct}&tz=-480`)).body;
    const stamp = text => text.match(/\n\n(\d{4}-\d\d-\d\d \d\d:\d\d)  Alice/)[1];
    assert.equal(new Date(`${stamp(beijing)}Z`) - new Date(`${stamp(utc)}Z`), 8 * 3600000);
    assert.equal((await alice.get(`/api/export?roomId=${direct}&tz=9999`)).status, 400);
  });

  test('私聊以对方名字为标题；无权访问的会话不能导出', async () => {
    assert.match((await alice.get(`/api/export?roomId=${direct}`)).body, /会话：Bob\n/);
    assert.equal((await carol.get(`/api/export?roomId=${direct}`)).status, 403);
    assert.equal((await space.client().get('/api/export?roomId=lobby')).status, 401);
  });

  test('清空后的记录不会被导出', async () => {
    await space.owner.post('/api/clear-history', { confirmation: '清空' });
    await send(alice, 'lobby', '清空之后');
    const text = (await alice.get('/api/export?roomId=lobby')).body;
    assert.match(text, /共 1 条消息/);
    assert.doesNotMatch(text, /周五聚餐/);
  });
});

describe('导出里的新消息类型', () => {
  let space, alice, bob;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
  });
  after(() => space.close());

  test('投票、机器人、编辑和管理员删除都有对应的文字', async () => {
    const poll = (await alice.post('/api/polls', { roomId: 'lobby', question: '周五聚餐', options: ['火锅', '烧烤'] })).body.message;
    await bob.post('/api/polls/vote', { messageId: poll.id, options: [0] });
    const hook = (await space.owner.post('/api/webhooks', { roomId: 'lobby', name: '告警' })).body;
    await fetch(space.base + hook.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '磁盘告警' }) });
    const edited = (await send(alice, 'lobby', '初稿')).body.message;
    await alice.post('/api/edit-message', { messageId: edited.id, text: '定稿' });
    const removed = (await send(bob, 'lobby', '违规内容')).body.message;
    await space.owner.post('/api/admin/delete-message', { messageId: removed.id });
    const text = (await alice.get('/api/export?roomId=lobby')).body;
    assert.match(text, /\[投票\] 周五聚餐\n  · 火锅：1 票\n  · 烧烤：0 票/);
    assert.match(text, /告警（机器人）\n磁盘告警/);
    assert.match(text, /Alice（已编辑）\n定稿/);
    assert.match(text, /（消息已被管理员删除）/);
    assert.doesNotMatch(text, /违规内容/);
  });
});

describe('账号模式导出', () => {
  let space;
  before(async () => { space = await startCloud(); });
  after(() => space.close());

  test('成员可以导出自己能访问的会话', async () => {
    const alice = await space.member('Alice');
    await send(alice, 'lobby', '云端消息');
    const exported = await alice.get('/api/export?roomId=lobby');
    assert.equal(exported.status, 200);
    assert.match(exported.body, /Alice\n云端消息/);
  });
});

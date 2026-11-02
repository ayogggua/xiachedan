import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startServer } from '../server/index.js';
import { client, send, startCloud, startLocal } from './helpers.mjs';

async function upload(space, member, roomId, name, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const cookie = [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  const response = await fetch(`${space.base}/api/uploads?roomId=${encodeURIComponent(roomId)}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie }, body: form });
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

describe('局域网模式自动备份', () => {
  let space, member;
  before(async () => {
    space = await startLocal();
    member = await space.join('成员');
    await send(member, 'lobby', '要备份的消息');
  });
  after(() => space.close());

  test('只有空间创建者能查看和立即备份', async () => {
    assert.equal((await member.get('/api/backups')).status, 403);
    assert.equal((await member.post('/api/backups')).status, 403);
    const created = await space.owner.post('/api/backups');
    assert.equal(created.status, 201);
    assert.match(created.body.backup.name, /^chat-.+\.sqlite$/);
    const listed = await space.owner.get('/api/backups');
    assert.equal(listed.body.backups[0].name, created.body.backup.name);
    assert.equal(listed.body.keep, 7);
  });

  test('只保留最近 7 份', async () => {
    const directory = path.join(space.dataDir, 'backups');
    for (let day = 1; day <= 7; day++) writeFileSync(path.join(directory, `chat-2020-01-0${day}T00-00-00-000Z.sqlite`), '');
    await space.owner.post('/api/backups');
    const names = readdirSync(directory).sort();
    assert.equal(names.length, 7);
    assert.ok(!names.includes('chat-2020-01-01T00-00-00-000Z.sqlite'));
    assert.ok(!names.includes('chat-2020-01-02T00-00-00-000Z.sqlite'));
  });

  test('备份可以直接恢复成一个可用的空间', async () => {
    const { backups } = (await space.owner.get('/api/backups')).body;
    const latest = backups.find(item => item.size > 0);
    const restoreDir = mkdtempSync(path.join(tmpdir(), 'xiachedan-restore-'));
    copyFileSync(path.join(space.dataDir, 'backups', latest.name), path.join(restoreDir, 'chat.sqlite'));
    const restored = await startServer({ dataDir: restoreDir, port: 0, host: '127.0.0.1', serveWeb: false, mode: 'local' });
    try {
      const again = client(restored.address);
      for (const [key, value] of member.jar) again.jar.set(key, value);
      const messages = (await again.get('/api/messages?roomId=lobby')).body.messages;
      assert.ok(messages.some(message => message.text === '要备份的消息'));
    } finally { await restored.close(); rmSync(restoreDir, { recursive: true, force: true }); }
  });

  test('启动时距上次备份超过一天会自动备份', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'xiachedan-auto-'));
    try {
      const first = await startServer({ dataDir, port: 0, host: '127.0.0.1', serveWeb: false, mode: 'local' });
      const setupKey = new URL(first.setupUrl).hash.replace('#setup=', '');
      await client(first.address).post('/api/setup', { name: '主人', spaceName: '空间' }, { 'X-Setup-Key': setupKey });
      await first.close();
      const second = await startServer({ dataDir, port: 0, host: '127.0.0.1', serveWeb: false, mode: 'local' });
      await second.close();
      assert.equal(readdirSync(path.join(dataDir, 'backups')).length, 1);
      const third = await startServer({ dataDir, port: 0, host: '127.0.0.1', serveWeb: false, mode: 'local' });
      await third.close();
      assert.equal(readdirSync(path.join(dataDir, 'backups')).length, 1);
    } finally { rmSync(dataDir, { recursive: true, force: true }); }
  });
});

describe('账号模式的备份与导出', () => {
  let space, alice;
  before(async () => {
    space = await startCloud();
    alice = await space.member('Alice');
  });
  after(() => space.close());

  test('备份接口关闭，管理员也不能使用', async () => {
    assert.equal((await space.admin.get('/api/backups')).status, 403);
    assert.equal((await space.admin.post('/api/backups')).status, 403);
  });

  test('成员可以导出自己能访问的会话', async () => {
    await send(alice, 'lobby', '云端消息');
    const exported = await alice.get('/api/export?roomId=lobby');
    assert.equal(exported.status, 200);
    assert.match(exported.body, /Alice\n云端消息/);
  });
});

import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { startServer } from '../server/index.js';
import { client, listen, send, settle, startCloud, startLocal } from './helpers.mjs';
import { previewText } from '../shared/preview.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex');
const JPEG = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255, 217]);
const cookie = member => [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
const phone = () => { const ecdh = createECDH('prime256v1'); ecdh.generateKeys(); return { endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString('hex')}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } }; };
let counter = 0;
// 每条测试消息一个独有的暗号：断言它不出现在任何不该出现的地方。
const secret = () => `burnsecret${++counter}x${randomBytes(3).toString('hex')}焚`;

for (const mode of ['local', 'cloud']) describe(`阅后即焚（${mode === 'local' ? '局域网' : '账号'}模式）`, () => {
  let space, alice, bob, carol, dan, direct, group, danRoom;
  const pushes = [];
  const base = () => space.base;
  const upload = async (member, query, name, bytes) => {
    const form = new FormData();
    form.append('file', new Blob([bytes]), name);
    const response = await fetch(`${base()}/api/uploads?${new URLSearchParams(query)}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie: cookie(member) }, body: form });
    return (await response.json());
  };
  const media = async (member, id) => (await fetch(`${base()}/api/media?id=${encodeURIComponent(id)}`, { headers: { cookie: cookie(member) } })).status;
  const db = () => new DatabaseSync(path.join(space.dataDir, 'chat.sqlite'));
  const sql = (query, ...args) => { const handle = db(); try { return handle.prepare(query).all(...args); } finally { handle.close(); } };
  const age = (id, ms) => sql('UPDATE message_burns SET opened_at=opened_at-? WHERE message_id=? RETURNING message_id', ms, id);
  const listed = async (member, id, roomId = direct) => (await member.get(`/api/messages?roomId=${roomId}`)).body.messages.find(message => message.id === id);
  // 发一条带图片（和缩略图）的阅后即焚消息，文件名里也带着暗号。
  const sendBurn = async ({ seconds = 10, text = secret(), image = true, extra = {} } = {}) => {
    const ids = [];
    let thumbId = null;
    if (image) {
      const file = (await upload(alice, { roomId: direct }, `${text}.png`, PNG)).attachment;
      thumbId = (await upload(alice, { roomId: direct, thumbnailFor: file.id }, 't.jpg', JPEG)).thumbnail.id;
      ids.push(file.id);
    }
    const result = await send(alice, direct, text, { burn: seconds, attachmentIds: ids, ...extra });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return { message: result.body.message, text, fileId: ids[0], thumbId };
  };

  before(async () => {
    const pushSender = async (subscription, payload) => { pushes.push({ endpoint: subscription.endpoint, payload }); return 201; };
    if (mode === 'local') {
      space = await startLocal({ pushSender, scheduleInterval: 50 });
      [alice, bob, carol, dan] = [await space.join('Alice'), await space.join('Bob'), await space.join('Carol'), await space.join('Dan')];
    } else {
      space = await startCloud({ pushSender, scheduleInterval: 50 });
      [alice, bob, carol, dan] = [await space.member('Alice'), await space.member('Bob'), await space.member('Carol'), await space.member('Dan')];
    }
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
    group = (await alice.post('/api/rooms', { name: '三人组', memberIds: [bob.id, carol.id] })).body.id;
    danRoom = (await alice.post('/api/rooms', { userId: dan.id })).body.id;
  });
  after(() => space.close());

  test('只能在私聊里发、只能选固定时长；不能放进话题、不能 @ 人、不能被引用或开话题', async () => {
    assert.equal((await send(alice, group, '群里不行', { burn: 5 })).status, 400);
    assert.equal((await send(alice, 'lobby', '大厅不行', { burn: 5 })).status, 400);
    for (const burn of [7, '5', true, -1, 3600]) assert.equal((await send(alice, direct, '时长不对', { burn })).status, 400, String(burn));
    const root = (await send(alice, direct, '普通的根消息')).body.message;
    assert.equal((await send(alice, direct, '话题里', { burn: 5, threadOf: root.id })).status, 400);
    assert.equal((await send(alice, direct, '@Bob 你好', { burn: 5, mentions: [bob.id] })).status, 400);
    const { message } = await sendBurn({ image: false });
    assert.equal((await send(bob, direct, '回复它', { replyTo: message.id })).status, 400);
    assert.equal((await send(bob, direct, '引用一段', { replyTo: message.id, replyQuote: 'burn' })).status, 400);
    assert.equal((await send(bob, direct, '开话题', { threadOf: message.id })).status, 400);
    assert.equal((await bob.get(`/api/thread?rootId=${message.id}`)).status, 404);
    // 阅后即焚消息自己可以是回复（对方点开后才看到引用）。
    const quoted = (await send(alice, direct, '被回复的普通消息')).body.message;
    const reply = await send(alice, direct, secret(), { burn: 5, replyTo: quoted.id });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.message.replyTo.id, quoted.id);
    assert.equal((await listed(bob, reply.body.message.id)).replyTo, null);
  });

  test('打开之前接收人拿不到内容：实时事件、消息列表、会话预览、推送、图片地址、搜索、文件、导出都没有', async () => {
    const endpoint = phone();
    await bob.post('/api/push/subscribe', { subscription: endpoint });
    await bob.post('/api/keywords', { keywords: ['burnsecret'] });
    const [bobLive, bobOther, aliceLive] = [await listen(base(), bob), await listen(base(), bob), await listen(base(), alice)];
    const { message, text, fileId, thumbId } = await sendBurn({ text: `${secret()} https://example.com/page` });
    assert.ok(message.text.includes(text), '发送人自己拿到完整内容');
    assert.equal(message.attachments.length, 1);
    assert.deepEqual({ seconds: message.burn.seconds, openedAt: message.burn.openedAt, destroyedAt: message.burn.destroyedAt }, { seconds: 10, openedAt: null, destroyedAt: null });
    await settle();
    for (const live of [bobLive, bobOther]) {
      const event = live.events.find(item => item.type === 'message' && item.message.id === message.id);
      assert.equal(event.message.text, '');
      assert.deepEqual(event.message.attachments, []);
      assert.equal(event.message.burn.openedAt, null);
      assert.ok(!JSON.stringify(live.events).includes(text) && !JSON.stringify(live.events).includes(fileId), '接收人的连接里没有内容和附件标识');
    }
    assert.ok(aliceLive.events.find(item => item.type === 'message' && item.message.id === message.id).message.text.includes(text));
    for (const live of [bobLive, bobOther, aliceLive]) live.close();
    const placeholder = await listed(bob, message.id);
    assert.equal(placeholder.text, '');
    assert.deepEqual(placeholder.attachments, []);
    assert.ok((await listed(alice, message.id)).text.includes(text));
    const bobState = (await bob.get('/api/state')).body;
    assert.ok(!JSON.stringify(bobState).includes(text));
    assert.equal(previewText(bobState.rooms.find(room => room.id === direct).lastMessage), '[阅后即焚消息]');
    assert.equal(previewText((await alice.get('/api/state')).body.rooms.find(room => room.id === direct).lastMessage), '[阅后即焚消息]');
    await settle();
    const pushed = pushes.filter(item => item.endpoint === endpoint.endpoint);
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].payload.body, '[阅后即焚消息]');
    assert.equal(pushed[0].payload.title, 'Alice', '不按内容匹配关键词');
    assert.ok(!JSON.stringify(pushed).includes(text));
    // 拿到泄露的附件地址也打不开；发送人能看，外人照旧不能。
    assert.equal(await media(bob, fileId), 404);
    assert.equal(await media(bob, thumbId), 404);
    assert.equal(await media(alice, fileId), 200);
    assert.equal(await media(alice, thumbId), 200);
    assert.equal(await media(carol, fileId), 403);
    // 已读回执不算打开。
    assert.equal((await bob.post('/api/message-reads', { roomId: direct, messageIds: [message.id] })).status, 200);
    assert.equal((await listed(bob, message.id)).burn.openedAt, null);
    assert.deepEqual((await listed(alice, message.id)).readBy, [bob.id]);
    for (const member of [alice, bob]) {
      for (const query of [`q=${encodeURIComponent(text)}`, 'q=burnsecret', `q=${encodeURIComponent('example.com')}`, 'type=image', 'type=link']) {
        assert.ok(!(await member.get(`/api/search?roomId=${direct}&${query}`)).body.messages.some(item => item.id === message.id), `search ${query}`);
        assert.ok(!(await member.get(`/api/search?${query}`)).body.messages.some(item => item.id === message.id), `global search ${query}`);
      }
      assert.ok(!(await member.get(`/api/room-files?roomId=${direct}`)).body.items.some(item => item.messageId === message.id));
      const exported = (await member.get(`/api/export?roomId=${direct}`)).body;
      assert.ok(exported.includes('[阅后即焚消息]') && !exported.includes(text) && !exported.includes('burnsecret'));
      assert.equal((await member.get(`/api/message-history?id=${message.id}`)).status, 404);
    }
  });

  test('接收人点开才给内容并开始计时；双方所有设备一起看到倒计时；再点开不重新计时', async () => {
    const { message, text, fileId, thumbId } = await sendBurn();
    const [bobOther, aliceLive] = [await listen(base(), bob), await listen(base(), alice)];
    const before = Date.now();
    const opened = await bob.post('/api/burn/open', { messageId: message.id });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.message.text, text);
    assert.deepEqual(opened.body.message.attachments.map(file => file.id), [fileId]);
    const { openedAt, expiresAt } = opened.body.message.burn;
    assert.ok(openedAt >= before && openedAt <= Date.now());
    assert.equal(expiresAt, openedAt + 10000);
    await settle();
    for (const live of [bobOther, aliceLive]) {
      const event = live.events.find(item => item.type === 'message-burn' && item.messageId === message.id);
      assert.equal(event.burn.openedAt, openedAt);
      live.close();
    }
    assert.ok(!JSON.stringify(bobOther.events).includes(text), '另一台设备只收到计时，不收到内容');
    assert.equal(await media(bob, fileId), 200);
    assert.equal(await media(bob, thumbId), 200);
    const again = await bob.post('/api/burn/open', { messageId: message.id });
    assert.equal(again.body.message.burn.openedAt, openedAt);
    assert.equal(again.body.message.text, text);
    assert.equal((await alice.post('/api/burn/open', { messageId: message.id })).status, 400);
    assert.equal((await carol.post('/api/burn/open', { messageId: message.id })).status, 404);
    const listedForBob = await listed(bob, message.id);
    assert.equal(listedForBob.text, '');
    assert.equal(listedForBob.burn.openedAt, openedAt);
  });

  test('到点由服务器销毁：两边只剩「已销毁」，文件从磁盘删除，库文件里不留原文，附件地址失效', async () => {
    const url = 'https://example.com/burn-cache';
    const { message, text, fileId, thumbId } = await sendBurn({ text: `${secret()} ${url}` });
    sql('INSERT OR REPLACE INTO link_previews VALUES (?,?,?,?) RETURNING url', new URL(url).href, JSON.stringify({ url, title: 'x' }), null, Date.now());
    await bob.post('/api/burn/open', { messageId: message.id });
    const stored = () => ['chat.sqlite', 'chat.sqlite-wal'].some(file => existsSync(path.join(space.dataDir, file)) && readFileSync(path.join(space.dataDir, file)).includes(Buffer.from(text)));
    assert.ok(stored(), '销毁前原文确实在库文件或日志里（下面的检查才有意义）');
    const [bobLive, aliceLive] = [await listen(base(), bob), await listen(base(), alice)];
    age(message.id, 10001);
    // 任何一次接口访问都会先销毁到点的消息。
    await carol.get('/api/state');
    await settle();
    for (const live of [bobLive, aliceLive]) {
      const event = live.events.find(item => item.type === 'message-burned' && item.message.id === message.id);
      assert.ok(event?.message.burn.destroyedAt);
      assert.equal(event.message.text, '');
      live.close();
    }
    for (const member of [alice, bob]) {
      const gone = await listed(member, message.id);
      assert.equal(gone.text, '');
      assert.deepEqual(gone.attachments, []);
      assert.ok(gone.burn.destroyedAt);
      assert.equal(await media(member, fileId), 404);
      assert.equal(await media(member, thumbId), 404);
    }
    assert.ok(!existsSync(path.join(space.dataDir, 'uploads', fileId)));
    assert.ok(!existsSync(path.join(space.dataDir, 'uploads', thumbId)));
    assert.equal(sql('SELECT COUNT(*) AS n FROM uploads WHERE id IN (?,?)', fileId, thumbId)[0].n, 0);
    assert.equal(sql('SELECT COUNT(*) AS n FROM burn_files WHERE message_id=?', message.id)[0].n, 0);
    assert.equal(sql('SELECT COUNT(*) AS n FROM link_previews WHERE url=?', new URL(url).href)[0].n, 0);
    assert.ok(!stored(), '库文件和日志里不留原文');
    const reopened = await bob.post('/api/burn/open', { messageId: message.id });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.message.text, '');
    assert.ok(reopened.body.message.burn.destroyedAt);
  });

  test('没人访问时定时任务也会到点销毁', async () => {
    const { message } = await sendBurn({ image: false, seconds: 5 });
    await bob.post('/api/burn/open', { messageId: message.id });
    const aliceLive = await listen(base(), alice);
    age(message.id, 5001);
    await settle(300);
    assert.ok(sql('SELECT destroyed_at FROM message_burns WHERE message_id=?', message.id)[0].destroyed_at);
    assert.ok(aliceLive.events.some(item => item.type === 'message-burned' && item.message.id === message.id));
    aliceLive.close();
  });

  test('不能回应、收藏、置顶、转发（逐条和合并）、编辑、提醒、加成表情', async () => {
    const { message, text, fileId } = await sendBurn();
    await bob.post('/api/burn/open', { messageId: message.id });
    for (const member of [alice, bob]) {
      assert.equal((await member.post('/api/reactions', { messageId: message.id, emoji: '👍' })).status, 400);
      assert.equal((await member.post('/api/saved', { messageId: message.id })).status, 400);
      assert.equal((await member.post('/api/room-pins', { roomId: direct, messageId: message.id })).status, 400);
      assert.equal((await member.post('/api/forward', { roomId: group, messageIds: [message.id] })).status, 400);
      assert.equal((await member.post('/api/forward', { roomId: group, messageIds: [message.id], merge: true })).status, 400);
      assert.equal((await member.post('/api/reminders', { messageId: message.id, remindAt: Date.now() + 3600000 })).status, 400);
      assert.equal((await member.post('/api/stickers', { fileId })).status, 400);
    }
    assert.equal((await alice.post('/api/edit-message', { messageId: message.id, text: '改一下' })).status, 400);
    // 和普通消息一起转发时跳过它。
    const normal = (await send(alice, direct, '可以转发的')).body.message;
    for (const merge of [false, true]) {
      const forwarded = await bob.post('/api/forward', { roomId: group, messageIds: [normal.id, message.id], merge });
      assert.equal(forwarded.status, 201);
      assert.equal(forwarded.body.skipped, 1);
      assert.ok(!JSON.stringify(forwarded.body).includes(text));
    }
    assert.ok(!JSON.stringify((await carol.get(`/api/messages?roomId=${group}`)).body).includes(text));
    assert.equal((await alice.get('/api/saved')).body.items.length, 0);
    assert.equal((await alice.get(`/api/room-pins?roomId=${direct}`)).body.pins.length, 0);
  });

  test('打开前撤回照常：附件删掉，接收人不能再打开', async () => {
    const { message, fileId } = await sendBurn();
    assert.equal((await alice.post('/api/recall-message', { messageId: message.id })).status, 200);
    assert.equal((await bob.post('/api/burn/open', { messageId: message.id })).status, 404);
    assert.ok(!existsSync(path.join(space.dataDir, 'uploads', fileId)));
    const recalled = await listed(bob, message.id);
    assert.ok(recalled.recalledAt);
    assert.equal(previewText(recalled), '消息已撤回');
  });

  test('接收人「只对自己删除」或清空会话后不能再打开；发送人那边照常', async () => {
    const { message, text } = await sendBurn({ image: false });
    await bob.post('/api/messages/hide', { messageIds: [message.id] });
    assert.equal((await bob.post('/api/burn/open', { messageId: message.id })).status, 404);
    assert.ok((await listed(alice, message.id)).text.includes(text));
    const second = await sendBurn({ image: false });
    await bob.post('/api/room-clear', { roomId: direct });
    assert.equal((await bob.post('/api/burn/open', { messageId: second.message.id })).status, 404);
    assert.equal((await listed(alice, second.message.id)).burn.openedAt, null);
  });

  test('一直没打开的按会话的自动删除照常删掉，附件一起删', async () => {
    const { message, fileId } = await sendBurn();
    sql('UPDATE messages SET created_at=created_at-? WHERE id=? RETURNING id', 2 * 86400000, message.id);
    await alice.post('/api/room-auto-delete', { roomId: direct, seconds: 86400 });
    await settle(400);
    assert.equal(await listed(alice, message.id), undefined);
    assert.equal(sql('SELECT COUNT(*) AS n FROM message_burns WHERE message_id=?', message.id)[0].n, 0);
    assert.ok(!existsSync(path.join(space.dataDir, 'uploads', fileId)));
    await alice.post('/api/room-auto-delete', { roomId: direct, seconds: 0 });
  });

  test('接收人被移出空间（账号停用）后不能打开', async () => {
    const result = await send(alice, danRoom, secret(), { burn: 5 });
    if (mode === 'local') assert.equal((await space.owner.post('/api/remove-member', { userId: dan.id })).status, 200);
    else assert.equal((await space.admin.post('/api/admin/review', { userId: dan.id, status: 'suspended' })).status, 200);
    assert.ok([401, 403].includes((await dan.post('/api/burn/open', { messageId: result.body.message.id })).status));
    assert.equal((await listed(alice, result.body.message.id, danRoom)).burn.openedAt, null);
  });

  test('不能发成阅后即焚的接口带着 burn 一律拒绝，不会悄悄发成普通消息', async () => {
    const count = () => sql('SELECT COUNT(*) AS n FROM messages').at(0).n;
    const before = count();
    const normal = (await send(alice, direct, '普通的一条')).body.message;
    const hook = (await alice.post('/api/webhooks', { roomId: group, name: '机器人' })).body;
    const attempts = [
      () => alice.post('/api/scheduled', { roomId: direct, text: secret(), sendAt: Date.now() + 3600000, burn: 5 }),
      () => alice.post('/api/polls', { roomId: direct, question: secret(), options: ['甲', '乙'], burn: 5 }),
      () => alice.post('/api/chains', { roomId: group, title: secret(), burn: 5 }),
      () => alice.post('/api/contact-card', { roomId: direct, userId: carol.id, burn: 5 }),
      () => alice.post('/api/forward', { roomId: direct, messageIds: [normal.id], burn: 5 }),
      () => alice.post('/api/forward', { roomId: direct, messageIds: [normal.id], merge: true, burn: true }),
      () => alice.post('/api/nudge', { roomId: direct, userId: bob.id, burn: 10 }),
      () => alice.post('/api/edit-message', { messageId: normal.id, text: '改成阅后即焚', burn: 5 }),
      () => alice.post(hook.path.replace(/^\/api/, '/api'), { text: secret(), burn: 5 }),
    ];
    for (const attempt of attempts) {
      const result = await attempt();
      assert.equal(result.status, 400, JSON.stringify(result.body));
      assert.equal(result.body.error, '这里不能发阅后即焚消息');
    }
    assert.equal(count(), before + 1, '只多了那条普通消息');
    assert.equal((await alice.get(`/api/scheduled?roomId=${direct}`)).body.items.length, 0);
    // 不带 burn 或 burn 为假值时照常。
    assert.equal((await alice.post('/api/polls', { roomId: direct, question: '普通投票', options: ['甲', '乙'], burn: 0 })).status, 201);
    assert.equal((await send(alice, direct, '普通消息', { burn: false })).status, 201);
  });

  test('阅后即焚只能带图片和视频；附件不能按下载方式取', async () => {
    const text = (await upload(alice, { roomId: direct }, '说明.txt', Buffer.from('plain text'))).attachment;
    const rejected = await send(alice, direct, secret(), { burn: 5, attachmentIds: [text.id] });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, '阅后即焚只能发文字、图片和视频');
    assert.equal(sql('SELECT claimed FROM uploads WHERE id=?', text.id)[0].claimed, 0, '被拒绝的附件没有被占用');
    const { message, fileId, thumbId } = await sendBurn();
    await bob.post('/api/burn/open', { messageId: message.id });
    for (const member of [alice, bob]) for (const id of [fileId, thumbId]) {
      assert.equal((await fetch(`${base()}/api/media?id=${id}&download=1`, { headers: { cookie: cookie(member) } })).status, 403);
      const inline = await fetch(`${base()}/api/media?id=${id}`, { headers: { cookie: cookie(member) } });
      assert.equal(inline.status, 200);
      assert.equal(inline.headers.get('content-disposition'), null);
      assert.equal(inline.headers.get('cache-control'), 'no-store');
    }
  });

  test('撤回、管理员删除、自动删除、保留期限、清空记录：原文和文件同样不留在库文件和日志里', async () => {
    const stored = text => ['chat.sqlite', 'chat.sqlite-wal'].some(file => existsSync(path.join(space.dataDir, file)) && readFileSync(path.join(space.dataDir, file)).includes(Buffer.from(text)));
    const files = (...ids) => ids.filter(Boolean).some(id => existsSync(path.join(space.dataDir, 'uploads', id)));
    // 撤回：没打开的、正在倒计时的。
    for (const open of [false, true]) {
      const { message, text, fileId, thumbId } = await sendBurn();
      if (open) await bob.post('/api/burn/open', { messageId: message.id });
      assert.ok(stored(text));
      assert.equal((await alice.post('/api/recall-message', { messageId: message.id })).status, 200);
      assert.ok(!stored(text), `撤回后${open ? '（计时中）' : '（未打开）'}原文不在库里`);
      assert.ok(!files(fileId, thumbId));
    }
    // 管理员删除（管理员是私聊的一方）。
    const manager = mode === 'local' ? space.owner : space.admin;
    const managerRoom = (await alice.post('/api/rooms', { userId: manager.id ?? space.ownerId })).body.id;
    const removedText = secret();
    const removed = (await send(alice, managerRoom, removedText, { burn: 10 })).body.message;
    assert.equal((await manager.post('/api/admin/delete-message', { messageId: removed.id })).status, 200);
    assert.ok(!stored(removedText), '管理员删除后原文不在库里');
    // 按会话自动删除（没打开）。
    const auto = await sendBurn();
    sql('UPDATE messages SET created_at=created_at-? WHERE id=? RETURNING id', 2 * 86400000, auto.message.id);
    await alice.post('/api/room-auto-delete', { roomId: direct, seconds: 86400 });
    await settle(400);
    await alice.post('/api/room-auto-delete', { roomId: direct, seconds: 0 });
    assert.ok(!stored(auto.text) && !files(auto.fileId, auto.thumbId), '自动删除后原文和文件都不在');
    // 保留期限。
    const kept = await sendBurn({ image: false });
    sql('UPDATE messages SET created_at=created_at-? WHERE id=? RETURNING id', 40 * 86400000, kept.message.id);
    assert.equal((await manager.post('/api/admin/retention', { days: 30 })).status, 200);
    await settle(400);
    await manager.post('/api/admin/retention', { days: 0 });
    assert.equal(sql('SELECT COUNT(*) AS n FROM messages WHERE id=?', kept.message.id)[0].n, 0);
    assert.ok(!stored(kept.text), '保留期限删除后原文不在库里');
    // 清空聊天记录（空间创建者）。
    const last = await sendBurn();
    await bob.post('/api/burn/open', { messageId: last.message.id });
    const owner = mode === 'local' ? space.owner : space.admin;
    assert.equal((await owner.post('/api/clear-history', { confirmation: '清空' })).status, 200);
    assert.ok(!stored(last.text) && !files(last.fileId, last.thumbId), '清空后原文和文件都不在');
    assert.equal(sql('SELECT COUNT(*) AS n FROM message_burns')[0].n, 0);
  });

  test('销毁时清掉链接预览缓存：网址后面紧跟中文标点、剧透符号也能认出来', async () => {
    const urls = ['https://x.example/a', 'https://y.example/b?q=1', 'https://z.example/c'];
    const text = `看 ${urls[0]}，好吗？还有 ${urls[1]}。以及 ${urls[2]}||剧透||`;
    const message = (await send(alice, direct, text, { burn: 5 })).body.message;
    for (const url of urls) sql('INSERT OR REPLACE INTO link_previews VALUES (?,?,?,?) RETURNING url', new URL(url).href, JSON.stringify({ url, title: 'x' }), null, Date.now());
    await bob.post('/api/burn/open', { messageId: message.id });
    age(message.id, 5001);
    await carol.get('/api/state');
    for (const url of urls) assert.equal(sql('SELECT COUNT(*) AS n FROM link_previews WHERE url=?', new URL(url).href)[0].n, 0, url);
  });

  test('外人点开别人的阅后即焚消息，和消息不存在时的回答一样', async () => {
    const { message } = await sendBurn({ image: false });
    const stranger = await carol.post('/api/burn/open', { messageId: message.id });
    const missing = await carol.post('/api/burn/open', { messageId: '00000000-0000-4000-8000-000000000000' });
    assert.equal(stranger.status, 404);
    assert.deepEqual(stranger.body, missing.body);
    assert.equal(sql('SELECT opened_at FROM message_burns WHERE message_id=?', message.id)[0].opened_at, null);
  });

  test('重连后核对已加载的消息：再早的阅后即焚、接龙、投票也按服务器的最新状态，已删除的不再给出', async () => {
    const { message, text } = await sendBurn({ image: false });
    const poll = (await alice.post('/api/polls', { roomId: direct, question: '吃什么', options: ['甲', '乙'] })).body.message;
    const gone = (await send(alice, direct, '这条会被自动删除')).body.message;
    await bob.post('/api/polls/vote', { messageId: poll.id, options: [1] });
    // 接收人拿到的是遮住的；发送人看得到内容。
    const asBob = (await bob.post('/api/message-states', { roomId: direct, messageIds: [message.id, poll.id] })).body.messages;
    assert.equal(asBob.find(item => item.id === message.id).text, '');
    assert.ok((await alice.post('/api/message-states', { roomId: direct, messageIds: [message.id] })).body.messages[0].text.includes(text));
    assert.deepEqual(asBob.find(item => item.id === poll.id).poll.options.map(option => option.voters.length), [0, 1]);
    await bob.post('/api/burn/open', { messageId: message.id });
    age(message.id, 10001);
    sql('DELETE FROM messages WHERE id=? RETURNING id', gone.id);
    const states = (await alice.post('/api/message-states', { roomId: direct, messageIds: [message.id, gone.id] })).body.messages;
    assert.deepEqual(states.map(item => item.id), [message.id]);
    assert.equal(states[0].text, '');
    assert.ok(states[0].burn.destroyedAt);
    assert.equal((await carol.post('/api/message-states', { roomId: direct, messageIds: [message.id] })).status, 403);
    assert.equal((await alice.post('/api/message-states', { roomId: direct, messageIds: Array.from({ length: 201 }, (_, index) => `id-${index}`) })).status, 400);
    // 别的会话里的消息不会借这个会话给出。
    const elsewhere = (await send(alice, group, '群里的')).body.message;
    assert.deepEqual((await alice.post('/api/message-states', { roomId: direct, messageIds: [elsewhere.id] })).body.messages, []);
  });

  test('双方都「只对自己删除」（或清空会话）之后立即销毁；只有一方删除时照旧', async () => {
    const stored = text => ['chat.sqlite', 'chat.sqlite-wal'].some(file => existsSync(path.join(space.dataDir, file)) && readFileSync(path.join(space.dataDir, file)).includes(Buffer.from(text)));
    const destroyed = id => Boolean(sql('SELECT destroyed_at FROM message_burns WHERE message_id=?', id)[0]?.destroyed_at);
    // 只有发送人删了：接收人照样能打开、看到内容。
    const alone = await sendBurn({ image: false });
    assert.equal((await alice.post('/api/messages/hide', { messageIds: [alone.message.id] })).status, 200);
    assert.ok(!destroyed(alone.message.id));
    const opened = await bob.post('/api/burn/open', { messageId: alone.message.id });
    assert.equal(opened.status, 200);
    assert.equal(opened.body.message.text, alone.text);
    // 只有接收人删了：不销毁，发送人仍看得到内容。
    const recipientOnly = await sendBurn({ image: false });
    await bob.post('/api/messages/hide', { messageIds: [recipientOnly.message.id] });
    assert.ok(!destroyed(recipientOnly.message.id));
    assert.equal((await listed(alice, recipientOnly.message.id)).text, recipientOnly.text);
    // 两边都删了（先后顺序都试）：没人能再打开，内容、文件、日志立即清掉。
    // （附件上传每分钟有次数限制，只有第一种顺序带图片。）
    for (const [index, order] of [[bob, alice], [alice, bob]].entries()) {
      const { message, text, fileId, thumbId } = await sendBurn({ image: index === 0 });
      for (const member of order) assert.equal((await member.post('/api/messages/hide', { messageIds: [message.id] })).status, 200);
      assert.ok(destroyed(message.id));
      assert.equal(sql('SELECT text FROM messages WHERE id=?', message.id)[0].text, '');
      if (fileId) assert.ok(!existsSync(path.join(space.dataDir, 'uploads', fileId)) && !existsSync(path.join(space.dataDir, 'uploads', thumbId)));
      assert.ok(!stored(text), '库文件和日志里不留原文');
    }
    // 一方删除、另一方清空会话（仅自己）也算都删了。
    const cleared = await sendBurn({ image: false });
    await alice.post('/api/messages/hide', { messageIds: [cleared.message.id] });
    assert.ok(!destroyed(cleared.message.id));
    assert.equal((await bob.post('/api/room-clear', { roomId: direct })).status, 200);
    assert.ok(destroyed(cleared.message.id));
    assert.ok(!stored(cleared.text));
    // 已经打开、正在计时的，两边都删了同样立即销毁。
    const counting = await sendBurn({ image: false });
    await bob.post('/api/burn/open', { messageId: counting.message.id });
    await bob.post('/api/messages/hide', { messageIds: [counting.message.id] });
    await alice.post('/api/room-clear', { roomId: direct });
    assert.ok(destroyed(counting.message.id) && !stored(counting.text));
  });

  test('停机期间到点的消息启动时就销毁；还在计时的重启后照样到点销毁', async () => {
    const overdue = await sendBurn();
    const counting = await sendBurn({ image: false, seconds: 60 });
    await bob.post('/api/burn/open', { messageId: overdue.message.id });
    await bob.post('/api/burn/open', { messageId: counting.message.id });
    await space.server.close();
    age(overdue.message.id, 10001);
    const restarted = await startServer({ dataDir: space.dataDir, port: 0, host: '127.0.0.1', serveWeb: false, mode, scheduleInterval: 60000 });
    try {
      // 还没有任何请求：启动时已经销毁、文件已经删掉。
      assert.ok(sql('SELECT destroyed_at FROM message_burns WHERE message_id=?', overdue.message.id)[0].destroyed_at);
      assert.ok(!existsSync(path.join(space.dataDir, 'uploads', overdue.fileId)));
      assert.equal(sql('SELECT destroyed_at FROM message_burns WHERE message_id=?', counting.message.id)[0].destroyed_at, null);
      const again = client(restarted.address);
      for (const [key, value] of alice.jar) again.jar.set(key, value);
      const gone = (await again.get(`/api/messages?roomId=${direct}`)).body.messages.find(item => item.id === overdue.message.id);
      assert.equal(gone.text, '');
      assert.ok(gone.burn.destroyedAt);
      // 重启后接口访问同样以服务器时间为准。
      age(counting.message.id, 60001);
      const later = (await again.get(`/api/messages?roomId=${direct}`)).body.messages.find(item => item.id === counting.message.id);
      assert.ok(later.burn.destroyedAt);
      assert.equal(later.text, '');
    } finally { await restarted.close(); }
  });
});

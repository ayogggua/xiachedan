import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { listen, send, settle, startCloud, startLocal } from './helpers.mjs';

const roomOf = async (member, id) => (await member.get('/api/state')).body.rooms.find(room => room.id === id);
const userOf = async (member, id) => (await member.get('/api/state')).body.users.find(user => user.id === id);
const lastMessage = async (member, roomId) => (await member.get(`/api/messages?roomId=${encodeURIComponent(roomId)}`)).body.messages.at(-1);

describe('机器人账号：管理（局域网）', () => {
  let space, alice, bob, carol, group, bot, issued;
  before(async () => {
    space = await startLocal();
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    group = (await alice.post('/api/rooms', { name: '值班群', memberIds: [bob.id] })).body.id;
    await alice.post('/api/room-admins', { roomId: group, userId: bob.id, admin: true });
    issued = await space.owner.post('/api/bots', { name: '助手', bio: '回答值班问题', callbackUrl: 'http://127.0.0.1:9/hook' });
    bot = issued.body.bot;
  });
  after(() => space.close());

  test('空间创建者能创建机器人；令牌和签名密钥只在创建时返回一次', async () => {
    assert.equal(issued.status, 201);
    assert.match(issued.body.token, new RegExp(`^${bot.id}\\.[0-9a-f]{48}$`));
    assert.match(issued.body.secret, /^[0-9a-f]{64}$/);
    assert.equal(bot.avatar, 'bot');
    assert.equal(bot.status, 'enabled');
    const list = (await space.owner.get('/api/bots')).body.bots;
    assert.equal(list.length, 1);
    for (const item of list) for (const key of ['token', 'secret', 'token_hash', 'tokenHash']) assert.ok(!(key in item), key);
    assert.ok(!JSON.stringify(list).includes(issued.body.secret));
  });

  test('普通成员不能管理机器人', async () => {
    assert.equal((await alice.get('/api/bots')).status, 403);
    assert.equal((await alice.post('/api/bots', { name: '偷偷加' })).status, 403);
    for (const path of ['/api/bots/update', '/api/bots/status', '/api/bots/reset', '/api/bots/test', '/api/bots/delete'])
      assert.equal((await alice.post(path, { id: bot.id, name: 'x', enabled: false })).status, 403, path);
    assert.equal((await space.client().get('/api/bots')).status, 401);
  });

  test('创建时检查名字、头像、简介和回调地址', async () => {
    assert.equal((await space.owner.post('/api/bots', { name: '  ' })).status, 400);
    assert.equal((await space.owner.post('/api/bots', { name: 'x', avatar: 'upload:abc' })).status, 400);
    assert.equal((await space.owner.post('/api/bots', { name: 'x', bio: 'x'.repeat(121) })).status, 400);
    for (const url of ['ftp://example.com/', 'http://user:pass@example.com/', `http://example.com/${'a'.repeat(2050)}`, 'not a url', 'http://169.254.169.254/latest'])
      assert.equal((await space.owner.post('/api/bots', { name: 'x', callbackUrl: url })).status, 400, url);
    // 局域网模式下内网和本机地址是常态。
    for (const url of ['http://192.168.1.20:8080/bot', 'http://localhost:3000/x', 'http://[::1]:3000/x']) {
      const created = await space.owner.post('/api/bots', { name: '内网', callbackUrl: url, avatar: 'fish' });
      assert.equal(created.status, 201, url);
      await space.owner.post('/api/bots/delete', { id: created.body.bot.id });
    }
    // 只发不收的机器人可以不填回调地址。
    const sendOnly = await space.owner.post('/api/bots', { name: '播报' });
    assert.equal(sendOnly.status, 201);
    assert.equal(sendOnly.body.bot.callbackUrl, '');
    await space.owner.post('/api/bots/delete', { id: sendOnly.body.bot.id });
  });

  test('机器人出现在成员列表里并带机器人标记，但不能当普通成员用', async () => {
    const view = await userOf(alice, bot.id);
    assert.deepEqual(view.bot, { status: 'enabled', receiveAll: false });
    assert.equal(view.bio, '回答值班问题');
    assert.equal(view.online, false);
    assert.equal((await alice.post('/api/room-members', { roomId: group, memberIds: [bot.id] })).status, 400);
    assert.equal((await alice.post('/api/rooms', { name: '新群', memberIds: [bot.id] })).status, 400);
    assert.equal((await alice.post('/api/room-admins', { roomId: group, userId: bot.id, admin: true })).status, 400);
    assert.equal((await alice.post('/api/room-owner', { roomId: group, userId: bot.id })).status, 400);
    assert.equal((await space.owner.post('/api/admin/mute', { userId: bot.id })).status, 400);
    assert.equal((await space.owner.post('/api/admin/department', { userId: bot.id, department: '研发' })).status, 400);
    assert.equal((await space.owner.post('/api/remove-member', { userId: bot.id })).status, 404);
    assert.equal((await alice.post('/api/contact-card', { roomId: group, userId: bot.id })).status, 404);
    // 备注只给自己看，机器人也可以写。
    assert.equal((await alice.post('/api/user-note', { userId: bot.id, note: '值班用' })).status, 200);
  });

  test('群主、群管理员可以把机器人拉进群；普通成员和群外的人不行', async () => {
    const noMember = await space.join('Dave');
    await alice.post('/api/room-members', { roomId: group, memberIds: [noMember.id] });
    assert.equal((await noMember.post('/api/room-bots', { roomId: group, botId: bot.id, add: true })).status, 403);
    assert.equal((await carol.post('/api/room-bots', { roomId: group, botId: bot.id, add: true })).status, 403);
    assert.equal((await space.owner.post('/api/room-bots', { roomId: group, botId: bot.id, add: true })).status, 403);
    const added = await bob.post('/api/room-bots', { roomId: group, botId: bot.id, add: true });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.bots, [bot.id]);
    const room = await roomOf(alice, group);
    assert.deepEqual(room.bots, [bot.id]);
    assert.ok(!room.members.includes(bot.id), '机器人不写进群成员列表，群主接任等规则不受影响');
    const notice = await lastMessage(alice, group);
    assert.equal(notice.senderId, 'system');
    assert.deepEqual(notice.notice, { kind: 'bot-added', botId: bot.id });
    assert.match(notice.text, /Bob把机器人「助手」加入了群聊，@它的消息会发给它/);
    // 再加一次不重复。
    await alice.post('/api/room-bots', { roomId: group, botId: bot.id, add: true });
    assert.equal((await roomOf(alice, group)).bots.length, 1);
    assert.equal((await alice.get(`/api/messages?roomId=${group}`)).body.messages.filter(message => message.notice).length, 1);
  });

  test('大厅由空间管理者添加；私聊不能添加', async () => {
    assert.equal((await alice.post('/api/room-bots', { roomId: 'lobby', botId: bot.id, add: true })).status, 403);
    assert.equal((await space.owner.post('/api/room-bots', { roomId: 'lobby', botId: bot.id, add: true })).status, 200);
    assert.deepEqual((await roomOf(carol, 'lobby')).bots, [bot.id]);
    assert.match((await lastMessage(carol, 'lobby')).text, /加入了大厅/);
    const direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
    assert.equal((await alice.post('/api/room-bots', { roomId: direct, botId: bot.id, add: true })).status, 400);
  });

  test('打开「接收全部消息」时，机器人所在的每个群和大厅都有提示', async () => {
    const updated = await space.owner.post('/api/bots/update', { id: bot.id, receiveAll: true });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.bot.receiveAll, true);
    for (const roomId of [group, 'lobby']) {
      const notice = await lastMessage(alice, roomId);
      assert.equal(notice.notice.kind, 'receive-all-on');
      assert.match(notice.text, /接收全部消息/);
    }
    assert.equal((await userOf(carol, bot.id)).bot.receiveAll, true);
    // 设置没变时不再发提示。
    const before = (await alice.get(`/api/messages?roomId=${group}`)).body.messages.length;
    await space.owner.post('/api/bots/update', { id: bot.id, receiveAll: true, bio: '新简介' });
    assert.equal((await alice.get(`/api/messages?roomId=${group}`)).body.messages.length, before);
    await space.owner.post('/api/bots/update', { id: bot.id, receiveAll: false });
    assert.equal((await lastMessage(alice, group)).notice.kind, 'receive-all-off');
  });

  test('系统提示不算未读', async () => {
    const quiet = (await alice.post('/api/rooms', { name: '安静群', memberIds: [bob.id] })).body.id;
    const cursor = (await bob.get(`/api/messages?roomId=${quiet}`)).body.messages.at(-1)?.seq || 0;
    await alice.post('/api/room-bots', { roomId: quiet, botId: bot.id, add: true });
    await space.owner.post('/api/bots/update', { id: bot.id, receiveAll: true });
    await space.owner.post('/api/bots/update', { id: bot.id, receiveAll: false });
    await alice.post('/api/room-bots', { roomId: quiet, botId: bot.id, add: false });
    assert.equal((await bob.get(`/api/messages?roomId=${quiet}`)).body.messages.filter(message => message.notice).length, 4);
    const counts = (await bob.post('/api/unread-counts', { cursors: { [quiet]: cursor } })).body.rooms.find(room => room.id === quiet);
    assert.equal(counts.unreadCount, 0);
    await send(alice, quiet, '真消息');
    assert.equal((await bob.post('/api/unread-counts', { cursors: { [quiet]: cursor } })).body.rooms.find(room => room.id === quiet).unreadCount, 1);
  });

  test('系统提示不能编辑、撤回、转发，不出现在搜索里，导出时标成系统', async () => {
    const notice = await lastMessage(alice, group);
    assert.equal((await alice.post('/api/edit-message', { messageId: notice.id, text: '改' })).status, 403);
    assert.equal((await alice.post('/api/recall-message', { messageId: notice.id })).status, 403);
    assert.equal((await alice.post('/api/forward', { roomId: group, messageIds: [notice.id] })).status, 400);
    assert.equal((await alice.get(`/api/search?q=${encodeURIComponent('接收全部消息')}`)).body.messages.length, 0);
    const exported = await alice.get(`/api/export?roomId=${group}`);
    assert.match(exported.body, /\[系统\] 机器人「助手」关闭了接收全部消息/);
  });

  test('成员可以和启用的机器人私聊；私聊里不能阅后即焚、拍一拍', async () => {
    const opened = await carol.post('/api/rooms', { userId: bot.id });
    assert.equal(opened.status, 201);
    const room = await roomOf(carol, opened.body.id);
    assert.equal(room.kind, 'direct');
    assert.deepEqual(room.members, [carol.id, bot.id].sort());
    assert.equal((await carol.post('/api/rooms', { userId: bot.id })).body.id, opened.body.id);
    assert.equal((await send(carol, opened.body.id, '你好')).status, 201);
    assert.equal((await send(carol, opened.body.id, '看完就焚', { burn: 5 })).status, 400);
    assert.equal((await carol.post('/api/nudge', { roomId: opened.body.id, userId: carol.id })).status, 400);
    assert.equal((await carol.post('/api/nudge', { roomId: opened.body.id, userId: bot.id })).status, 400);
  });

  test('停用后不能新开私聊，也不能拉进群；已有的私聊照常打开', async () => {
    const disabled = await space.owner.post('/api/bots/status', { id: bot.id, enabled: false });
    assert.equal(disabled.body.bot.status, 'disabled');
    assert.equal((await userOf(alice, bot.id)).bot.status, 'disabled');
    assert.equal((await bob.post('/api/rooms', { userId: bot.id })).status, 403);
    assert.equal((await carol.post('/api/rooms', { userId: bot.id })).status, 200);
    const other = (await alice.post('/api/rooms', { name: '第二个群', memberIds: [bob.id] })).body.id;
    assert.equal((await alice.post('/api/room-bots', { roomId: other, botId: bot.id, add: true })).status, 400);
    assert.equal((await space.owner.post('/api/bots/status', { id: bot.id, enabled: true })).body.bot.status, 'enabled');
  });

  test('群主、群管理员可以把机器人移出群，并留下提示', async () => {
    const removed = await bob.post('/api/room-bots', { roomId: group, botId: bot.id, add: false });
    assert.equal(removed.status, 200);
    assert.deepEqual((await roomOf(alice, group)).bots, []);
    assert.match((await lastMessage(alice, group)).text, /Bob把机器人「助手」移出了群聊/);
    assert.equal((await bob.post('/api/room-bots', { roomId: group, botId: bot.id, add: false })).status, 404);
  });

  test('删除后令牌失效、退出所有会话；以前的消息还在，和它的私聊不能再发', async () => {
    const direct = (await carol.post('/api/rooms', { userId: bot.id })).body.id;
    assert.equal((await space.owner.post('/api/bots/delete', { id: bot.id })).status, 200);
    assert.equal((await space.owner.get('/api/bots')).body.bots.length, 0);
    const view = await userOf(alice, bot.id);
    assert.equal(view.removed, true);
    assert.equal(view.bot.status, 'deleted');
    assert.deepEqual((await roomOf(alice, 'lobby')).bots, []);
    const notice = await lastMessage(alice, 'lobby');
    assert.deepEqual(notice.notice, { kind: 'bot-deleted', botId: bot.id });
    assert.equal(notice.text, '空间主人删除了机器人「助手」，它已退出大厅');
    assert.equal((await send(carol, direct, '还在吗')).status, 403);
    assert.equal((await carol.post('/api/rooms', { userId: bot.id })).status, 404);
    assert.equal((await space.owner.post('/api/bots/update', { id: bot.id, name: '复活' })).status, 404);
    assert.equal((await space.owner.post('/api/room-bots', { roomId: 'lobby', botId: bot.id, add: true })).status, 404);
    assert.ok((await carol.get(`/api/messages?roomId=${direct}`)).body.messages.some(message => message.text === '你好'));
  });

  test('管理操作记入操作日志', async () => {
    const actions = (await space.owner.get('/api/admin/audit')).body.entries.map(entry => entry.action);
    for (const action of ['bot-create', 'bot-update', 'bot-receive-all', 'bot-disable', 'bot-enable', 'bot-delete']) assert.ok(actions.includes(action), action);
    const entry = (await space.owner.get('/api/admin/audit')).body.entries.find(item => item.action === 'bot-delete');
    assert.equal(entry.target.name, '助手');
  });

  test('删除开着「接收全部消息」的机器人：它所在的每个群聊和大厅都留提示', async () => {
    const listener = (await space.owner.post('/api/bots', { name: '旁听', receiveAll: true })).body.bot;
    const rooms = [(await alice.post('/api/rooms', { name: '甲群', memberIds: [bob.id] })).body.id, (await alice.post('/api/rooms', { name: '乙群', memberIds: [bob.id] })).body.id];
    for (const roomId of rooms) await alice.post('/api/room-bots', { roomId, botId: listener.id, add: true });
    const live = await listen(space.base, bob);
    await space.owner.post('/api/bots/delete', { id: listener.id });
    await settle();
    for (const roomId of rooms) {
      const notice = await lastMessage(bob, roomId);
      assert.equal(notice.notice.kind, 'bot-deleted');
      assert.match(notice.text, /删除了机器人「旁听」，它已退出群聊/);
      assert.ok(live.events.some(event => event.type === 'message' && event.message.id === notice.id), '在线的成员实时收到');
    }
    live.close();
  });

  test('最后一个人退出群聊时，群里的机器人也一起移出', async () => {
    const created = await space.owner.post('/api/bots', { name: '留守' });
    const solo = (await alice.post('/api/rooms', { name: '小群', memberIds: [bob.id] })).body.id;
    await alice.post('/api/room-bots', { roomId: solo, botId: created.body.bot.id, add: true });
    await bob.post('/api/room-leave', { roomId: solo });
    await alice.post('/api/room-leave', { roomId: solo });
    assert.deepEqual((await space.owner.get('/api/bots')).body.bots.find(item => item.id === created.body.bot.id).rooms, []);
  });

  test('机器人不能登录：它的令牌当作会话凭证无效', async () => {
    const created = await space.owner.post('/api/bots', { name: '冒充' });
    const stranger = space.client();
    stranger.jar.set('linliao_session', created.body.token);
    assert.equal((await stranger.get('/api/state')).status, 401);
    stranger.jar.set('linliao_session', created.body.secret);
    assert.equal((await stranger.get('/api/state')).status, 401);
  });
});

describe('机器人账号：管理（账号模式）', () => {
  let space, alice, bob, group;
  before(async () => {
    space = await startCloud();
    alice = await space.member('Alice');
    bob = await space.member('Bob');
    group = (await alice.post('/api/rooms', { name: '项目群', memberIds: [bob.id] })).body.id;
  });
  after(() => space.close());

  test('管理员管理机器人，普通成员不行', async () => {
    assert.equal((await alice.post('/api/bots', { name: '偷偷加' })).status, 403);
    const created = await space.admin.post('/api/bots', { name: '日报', callbackUrl: 'https://bots.example.com/daily' });
    assert.equal(created.status, 201);
    assert.equal((await alice.post('/api/bots/reset', { id: created.body.bot.id })).status, 403);
    const view = (await alice.get('/api/state')).body.users.find(user => user.id === created.body.bot.id);
    assert.equal(view.bot.status, 'enabled');
    // 机器人没有账号，不出现在用户审核列表里。
    const listed = (await space.admin.get('/api/admin/users?status=all')).body.users;
    assert.ok(!listed.some(user => user.id === created.body.bot.id));
  });

  test('账号模式下回调地址不能写内网、本机、元数据等地址', async () => {
    for (const url of ['http://127.0.0.1/x', 'http://10.0.0.8/x', 'http://192.168.1.2/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/', 'http://100.64.0.1/',
      'http://169.254.169.254/', 'http://0x7f000001/', 'http://017700000001/', 'http://2130706433/', 'http://127.1/', 'http://localhost/', 'http://api.localhost./', 'http://0.0.0.0/'])
      assert.equal((await space.admin.post('/api/bots', { name: 'x', callbackUrl: url })).status, 400, url);
  });

  test('群主把机器人拉进群；机器人可以 @，编辑时保留对它的 @', async () => {
    const created = await space.admin.post('/api/bots', { name: '小助手' });
    const botId = created.body.bot.id;
    assert.equal((await bob.post('/api/room-bots', { roomId: group, botId, add: true })).status, 403);
    assert.equal((await alice.post('/api/room-bots', { roomId: group, botId, add: true })).status, 200);
    const sent = await send(alice, group, '@小助手 帮我查一下', { mentions: [botId] });
    assert.equal(sent.status, 201);
    assert.deepEqual(sent.body.message.mentions, [botId]);
    const edited = await alice.post('/api/edit-message', { messageId: sent.body.message.id, text: '@小助手 帮我查两下' });
    assert.deepEqual(edited.body.message.mentions, [botId]);
    // 不在这个群里的机器人不能 @。
    const other = await space.admin.post('/api/bots', { name: '外人' });
    assert.equal((await send(alice, group, '@外人 你好', { mentions: [other.body.bot.id] })).status, 400);
    assert.equal((await space.admin.post('/api/room-bots', { roomId: 'lobby', botId, add: true })).status, 200);
    await settle(50);
  });
});

describe('机器人的名字和简介', () => {
  let space;
  before(async () => { space = await startLocal(); });
  after(() => space.close());

  test('不能带换行、控制字符和改变文字方向的字符；成员昵称不受影响', async () => {
    for (const bad of ['助\n手', '助\r手', '助手\u0000', '\u0007铃', '助\t手', '\u202e手助', '助\u2066手', '助\u200e手', '助\u200f手', '助\u061c手', '助\u2028手', '助\u2029手'])
      for (const field of ['name', 'bio']) assert.equal((await space.owner.post('/api/bots', { name: '好名字', [field]: bad })).status, 400, JSON.stringify([field, bad]));
    // 带 ZWJ 的组合表情、变体选择符要能用。
    const ok = await space.owner.post('/api/bots', { name: '正常👩\u200d💻', bio: '多语言 English 😀 ❤\ufe0f' });
    assert.equal(ok.status, 201);
    assert.equal((await space.owner.post('/api/bots/update', { id: ok.body.bot.id, name: '改\n名' })).status, 400);
    assert.equal((await space.owner.post('/api/bots/update', { id: ok.body.bot.id, bio: '简\r\n介' })).status, 400);
    await space.owner.post('/api/bots/delete', { id: ok.body.bot.id });
    const member = await space.join('Dora');
    assert.equal((await member.post('/api/profile', { name: '多拉', bio: '第一行\n第二行' })).status, 200);
  });
});

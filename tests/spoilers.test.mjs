import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { send, settle, startCloud, startLocal } from './helpers.mjs';
import { cutMasked, maskSpoilers, plainText, previewText, spoilerRanges } from '../shared/preview.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex');
const PUSH = { endpoint: 'https://fcm.googleapis.com/fcm/send/spoiler-test', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };

async function upload(space, member, roomId, name) {
  const form = new FormData();
  form.append('file', new Blob([PNG]), name);
  const cookie = [...member.jar].map(([key, value]) => `${key}=${value}`).join('; ');
  const response = await fetch(`${space.base}/api/uploads?roomId=${encodeURIComponent(roomId)}`, { method: 'POST', headers: { 'X-Linliao': '1', cookie }, body: form });
  return (await response.json()).attachment;
}

describe('剧透：纯文字预览', () => {
  test('||文字|| 换成 [剧透]；代码里的、空白的、没闭合的、跨行的不算', () => {
    assert.equal(plainText('凶手是 ||管家|| 哦'), '凶手是 [剧透] 哦');
    assert.equal(plainText('||**结局**和 `代码`|| 之后'), '[剧透] 之后');
    assert.equal(plainText('`||不是剧透||` 和 ||是||'), '||不是剧透|| 和 [剧透]');
    assert.equal(maskSpoilers('```\n||代码块里||\n```\n||外面||'), '```\n||代码块里||\n```\n[剧透]');
    assert.equal(plainText('|| || 和 ||没闭合'), '|| || 和 ||没闭合');
    assert.equal(plainText('||第一行\n第二行||'), '||第一行\n第二行||');
    assert.equal(plainText('\\||转义|| 不算'), '\\||转义|| 不算');
    assert.deepEqual(spoilerRanges('a ||b|| c'), [{ start: 2, end: 7 }]);
  });
  test('截断遮好的文字时不截在 [剧透] 中间', () => {
    assert.equal(cutMasked('ab[剧透]cd', 4), 'ab');
    assert.equal(cutMasked('ab[剧透]cd', 6), 'ab[剧透]');
    assert.equal(cutMasked('ab[剧本]cd', 4), 'ab[剧');
    assert.equal(cutMasked('abc', 2), 'ab');
  });
  test('标成剧透的图片和视频只说类型，不带文件名', () => {
    assert.equal(previewText({ text: '', attachments: [{ mime: 'image/png', name: '大结局.png', spoiler: true }] }), '[剧透图片]');
    assert.equal(previewText({ text: '', attachments: [{ mime: 'video/mp4', name: '大结局.mp4', spoiler: true }] }), '[剧透视频]');
    assert.equal(previewText({ text: '', attachments: [{ mime: 'image/png', name: 'a.png' }] }), '[图片]');
  });
});

for (const mode of ['local', 'cloud']) describe(`剧透（${mode === 'local' ? '局域网' : '账号'}模式）`, () => {
  let space, alice, bob, group;
  const sent = [];
  before(async () => {
    const pushSender = async (subscription, payload) => { sent.push(payload); return 201; };
    space = mode === 'local' ? await startLocal({ pushSender, scheduleInterval: 50, scheduleMinLead: 0 }) : await startCloud({ pushSender, scheduleInterval: 50, scheduleMinLead: 0 });
    alice = mode === 'local' ? await space.join('Alice') : await space.member('Alice');
    bob = mode === 'local' ? await space.join('Bob') : await space.member('Bob');
    group = (await alice.post('/api/rooms', { name: '追剧群', memberIds: [bob.id] })).body.id;
    assert.equal((await bob.post('/api/push/subscribe', { subscription: PUSH })).status, 200);
  });
  after(() => space.close());

  test('推送里剧透文字换成 [剧透]', async () => {
    sent.length = 0;
    await send(alice, group, '第八集 ||男主是卧底|| 太刺激了');
    await settle();
    assert.equal(sent.at(-1).body, '第八集 [剧透] 太刺激了');
    assert.ok(!JSON.stringify(sent).includes('卧底'));
  });

  test('图片可以标成剧透：只标图片和视频，推送不带文件名；标记不在附件里时拒绝', async () => {
    const spoiler = await upload(space, alice, group, '结局截图.png');
    const plain = await upload(space, alice, group, '普通.png');
    assert.equal((await send(alice, group, '', { attachmentIds: [plain.id], spoilerIds: ['someone-else'] })).status, 400);
    assert.equal((await send(alice, group, '', { attachmentIds: [plain.id], spoilerIds: 'yes' })).status, 400);
    sent.length = 0;
    const created = await send(alice, group, '', { attachmentIds: [spoiler.id, plain.id], spoilerIds: [spoiler.id] });
    assert.equal(created.status, 201);
    const files = created.body.message.attachments;
    assert.equal(files.find(file => file.id === spoiler.id).spoiler, true);
    assert.equal(files.find(file => file.id === plain.id).spoiler, undefined);
    await settle();
    assert.equal(sent.at(-1).body, '[剧透图片]');
    assert.ok(!JSON.stringify(sent).includes('结局截图'));
    // 历史记录、图片与文件里都带着标记，客户端据此遮住。
    const history = (await bob.get(`/api/messages?roomId=${group}`)).body.messages.at(-1);
    assert.equal(history.attachments.find(file => file.id === spoiler.id).spoiler, true);
    const media = (await bob.get(`/api/room-files?roomId=${group}&kind=media`)).body.items;
    assert.equal(media.find(item => item.file.id === spoiler.id).file.spoiler, true);
    assert.equal(media.find(item => item.file.id === plain.id).file.spoiler, undefined);
  });

  test('转发（逐条与合并）后仍然遮住：文字保留 ||，图片保留标记', async () => {
    const spoiler = await upload(space, alice, group, '剧照.png');
    const text = (await send(alice, group, '||他没死||')).body.message;
    const image = (await send(alice, group, '', { attachmentIds: [spoiler.id], spoilerIds: [spoiler.id] })).body.message;
    const direct = (await bob.post('/api/rooms', { userId: alice.id })).body.id;
    const forwarded = (await bob.post('/api/forward', { roomId: direct, messageIds: [text.id, image.id] })).body.messages;
    assert.equal(forwarded[0].text, '||他没死||');
    assert.equal(forwarded[1].attachments[0].spoiler, true);
    assert.notEqual(forwarded[1].attachments[0].id, spoiler.id);
    const merged = (await bob.post('/api/forward', { roomId: direct, messageIds: [text.id, image.id], merge: true })).body.messages[0];
    const bundle = (await bob.get(`/api/messages?roomId=${direct}`)).body.messages.find(message => message.id === merged.id).bundle;
    assert.equal(bundle.items[0].text, '||他没死||');
    assert.equal(bundle.items[1].attachments[0].spoiler, true);
    assert.equal(previewText(bundle.items[0]), '[剧透]');
  });

  test('引用摘要先遮剧透再截断：截在剧透中间也不露出；剧透图在引用里是 [剧透图片]', async () => {
    const long = `结局：||${'凶手其实是管家，'.repeat(30)}||`;
    const original = (await send(alice, group, long)).body.message;
    const reply = (await send(bob, group, '真的吗', { replyTo: original.id })).body.message;
    assert.ok(!reply.replyTo.text.includes('凶手'), reply.replyTo.text);
    assert.equal(reply.replyTo.text, '结局：[剧透]');
    const listed = (await alice.get(`/api/messages?roomId=${group}`)).body.messages.find(message => message.id === reply.id);
    assert.ok(!JSON.stringify(listed.replyTo).includes('凶手'));
    const file = await upload(space, alice, group, '真相.png');
    const image = (await send(alice, group, '', { attachmentIds: [file.id], spoilerIds: [file.id] })).body.message;
    const toImage = (await send(bob, group, '啊？', { replyTo: image.id })).body.message;
    assert.equal(previewText(toImage.replyTo), '[剧透图片]');
    assert.ok(!JSON.stringify(toImage.replyTo).includes('真相'));
  });

  test('引用摘要和导出里的短引用不会截成半个 [剧透]', async () => {
    const room = (await alice.post('/api/rooms', { name: '截断群', memberIds: [bob.id] })).body.id;
    for (const [length, cut] of [[197, 200], [37, 40]]) {
      const original = (await send(alice, room, `${'甲'.repeat(length)}||秘密||尾巴`)).body.message;
      const reply = (await send(bob, room, `回 ${length}`, { replyTo: original.id })).body.message;
      if (cut === 200) assert.equal(reply.replyTo.text, '甲'.repeat(197));
    }
    const exported = (await bob.get(`/api/export?roomId=${room}&tz=0`)).body;
    assert.ok(exported.includes(`：${'甲'.repeat(37)}\n`), exported);
    assert.ok(!/\[剧(?!透\])/.test(exported) && !exported.includes('秘密'));
  });

  test('部分引用不能带出剧透：碰到剧透的片段被拒；原文后来改成剧透，已有的引用片段不再给出', async () => {
    const original = (await send(alice, group, '前情 ||反派是师父|| 后续')).body.message;
    assert.equal((await send(bob, group, '嗯', { replyTo: original.id, replyQuote: '反派是师父' })).status, 400);
    assert.equal((await send(bob, group, '嗯', { replyTo: original.id, replyQuote: '前情 反派' })).status, 400);
    assert.equal((await send(bob, group, '嗯', { replyTo: original.id, replyQuote: '前情' })).status, 201);
    const plain = (await send(alice, group, '师父其实没死')).body.message;
    const quoted = (await send(bob, group, '真的', { replyTo: plain.id, replyQuote: '其实没死' })).body.message;
    assert.equal(quoted.replyTo.quote, '其实没死');
    assert.equal((await alice.post('/api/edit-message', { messageId: plain.id, text: '师父||其实没死||' })).status, 200);
    const after = (await bob.get(`/api/messages?roomId=${group}`)).body.messages.find(message => message.id === quoted.id);
    assert.equal(after.replyTo.quote, undefined);
    assert.ok(!JSON.stringify(after.replyTo).includes('没死'));
  });

  test('导出的聊天记录不含剧透文字、剧透图的文件名和引用里的剧透', async () => {
    const room = (await alice.post('/api/rooms', { name: '导出群', memberIds: [bob.id] })).body.id;
    const file = await upload(space, alice, room, '最终话.png');
    const text = (await send(alice, room, `开头 ||${'秘密情节'.repeat(60)}||`)).body.message;
    await send(alice, room, '', { attachmentIds: [file.id], spoilerIds: [file.id] });
    await send(bob, room, '回一下', { replyTo: text.id });
    const exported = (await bob.get(`/api/export?roomId=${room}&tz=0`)).body;
    assert.equal(typeof exported, 'string');
    assert.ok(exported.includes('开头 [剧透]'));
    assert.ok(exported.includes('[附件] [剧透图片]'));
    assert.ok(!exported.includes('秘密') && !exported.includes('最终话'), exported);
  });

  test('搜索搜不到剧透里的文字和剧透图的文件名（会话内和全局）', async () => {
    const room = (await alice.post('/api/rooms', { name: '搜索群', memberIds: [bob.id] })).body.id;
    const file = await upload(space, alice, room, '隐藏结局XQ.png');
    await send(alice, room, '公开的话 ||只在剧透里XQ||');
    await send(alice, room, '', { attachmentIds: [file.id], spoilerIds: [file.id] });
    await send(alice, room, '链接藏在 ||https://example.com/hidden|| 里');
    for (const scope of [`roomId=${room}&`, '']) {
      assert.equal((await bob.get(`/api/search?${scope}q=${encodeURIComponent('只在剧透里')}`)).body.messages.length, 0);
      assert.equal((await bob.get(`/api/search?${scope}q=${encodeURIComponent('隐藏结局')}`)).body.messages.length, 0);
      assert.equal((await bob.get(`/api/search?${scope}q=${encodeURIComponent('公开的话')}`)).body.messages.length, 1);
    }
    // 「剧透」这个词只出现在剧透里时也搜不到（不能被占位 [剧透] 命中）；公开文字里有这个词照常能搜到。
    await send(alice, room, '||剧透警告 凶手是管家||');
    await send(alice, room, '公开提醒：后面有剧透');
    for (const scope of [`roomId=${room}&`, '']) for (const word of ['剧透', '剧']) {
      const found = (await bob.get(`/api/search?${scope}q=${encodeURIComponent(word)}`)).body.messages.filter(message => message.roomId === room);
      assert.deepEqual(found.map(message => message.text), ['公开提醒：后面有剧透'], `${scope}${word}`);
    }
    assert.equal((await bob.get(`/api/search?roomId=${room}&type=link`)).body.messages.length, 0);
    assert.equal((await bob.get(`/api/search?roomId=${room}&type=image`)).body.messages.length, 1);
  });

  test('离线时的提醒推送也不露出剧透', async () => {
    const message = (await send(alice, group, '记得看 ||第十集反转||')).body.message;
    sent.length = 0;
    assert.equal((await bob.post('/api/reminders', { messageId: message.id, remindAt: Date.now() + 100 })).status, 201);
    for (let i = 0; i < 30 && !sent.some(item => item.title === '提醒'); i++) await settle(100);
    const reminder = sent.find(item => item.title === '提醒');
    assert.equal(reminder?.body, '记得看 [剧透]');
  });
});

import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { client, listen, send, settle, startCloud, startLocal } from './helpers.mjs';
import { createVapidKeys, encrypt, validEndpoint, vapidAuthorization } from '../server/webpush.js';

// 模拟浏览器：生成订阅密钥，并能按 RFC 8291 解密收到的推送。
function browser(endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString('hex')}`) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = randomBytes(16);
  const subscription = { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const decrypt = body => {
    const salt = body.subarray(0, 16), keyLength = body[20], asPublic = body.subarray(21, 21 + keyLength);
    const hkdf = (s, ikm, info, length) => Buffer.from(hkdfSync('sha256', ikm, s, info, length));
    const ikm = hkdf(auth, ecdh.computeSecret(asPublic), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]), 32);
    const decipher = createDecipheriv('aes-128-gcm', hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
    const sealed = body.subarray(21 + keyLength);
    decipher.setAuthTag(sealed.subarray(-16));
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
    assert.equal(plain.at(-1), 2);
    return plain.subarray(0, -1).toString();
  };
  return { subscription, decrypt };
}

describe('Web Push 加密与签名', () => {
  test('与 RFC 8291 附录 A 的示例完全一致', () => {
    const body = encrypt('When I grow up, I want to be a watermelon', { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
      { localKey: Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'), salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url') });
    assert.equal(body.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  });

  test('随机密钥加密后，浏览器一侧能解出原文（含中文）', () => {
    const device = browser();
    const text = JSON.stringify({ title: '林晚 · 设计组', body: '今晚上线 🚀' });
    assert.equal(device.decrypt(encrypt(text, device.subscription.keys)), text);
  });

  test('VAPID：ES256 签名可验证，aud 是推送服务的源，有效期不超过 24 小时', () => {
    const jwk = createVapidKeys(), now = Date.now();
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', jwk, 'mailto:ops@example.com', now);
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    const [h, p, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url'));
    assert.equal(claims.aud, 'https://fcm.googleapis.com');
    assert.equal(claims.sub, 'mailto:ops@example.com');
    assert.ok(claims.exp > now / 1000 && claims.exp <= now / 1000 + 24 * 3600);
    const raw = Buffer.from(key, 'base64url');
    assert.equal(raw.length, 65);
    const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  });

  test('推送地址只允许 HTTPS 的已知推送服务', () => {
    for (const url of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://jmt17.google.com/fcm/send/x', 'https://android.googleapis.com/gcm/send/x'])
      assert.ok(validEndpoint(url), url);
    for (const url of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://evil.com/push.apple.com', 'https://google.com.evil.com/x', 'https://script.google.com/macros/s/x/exec', 'https://bucket.storage.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://user@fcm.googleapis.com/x', 'not a url'])
      assert.equal(validEndpoint(url), false, url);
  });
});

describe('手机推送（局域网模式）', () => {
  let space, alice, bob, carol, direct, group;
  const sent = [];
  before(async () => {
    space = await startLocal({ pushSender: async (subscription, payload, options) => { sent.push({ subscription, payload, options }); return subscription.endpoint.includes('gone') ? 410 : 201; } });
    alice = await space.join('Alice');
    bob = await space.join('Bob');
    carol = await space.join('Carol');
    direct = (await alice.post('/api/rooms', { userId: bob.id })).body.id;
    group = (await alice.post('/api/rooms', { name: '设计组', memberIds: [bob.id] })).body.id;
  });
  after(() => space.close());
  const pushedTo = endpoint => sent.filter(item => item.subscription.endpoint === endpoint);

  test('订阅后别人发消息会推送；自己发的不推；没加入的会话不推', async () => {
    const phone = browser();
    assert.ok((await alice.get('/api/push')).body.publicKey.length > 80);
    const subscribed = await alice.post('/api/push/subscribe', { subscription: phone.subscription });
    assert.equal(subscribed.status, 200);
    assert.ok(subscribed.body.id);
    await send(bob, direct, '**晚上**一起吃饭吗');
    await send(alice, direct, '好呀');
    await send(carol, 'lobby', '大家好');
    await send(bob, group, '图纸更新了');
    const others = (await bob.post('/api/rooms', { name: '别的群', memberIds: [carol.id] })).body.id;
    await send(bob, others, 'Alice 不在这个群');
    await settle();
    const items = pushedTo(phone.subscription.endpoint);
    assert.deepEqual(items.map(item => item.payload.body), ['晚上一起吃饭吗', '大家好', '图纸更新了']);
    assert.equal(items[0].payload.title, 'Bob');
    assert.equal(items[0].options.urgency, 'high');
    assert.equal(items[2].payload.title, 'Bob · 设计组');
    assert.equal(items[2].payload.roomId, group);
    assert.match(items[0].options.subject, /^(mailto:|https:)/);
    assert.ok(items[0].options.jwk.d, '用服务端保存的 VAPID 私钥签名');
  });

  test('这台设备设了免打扰的会话不推，被 @ 或命中关键词时照常推；隐私模式不带内容', async () => {
    const phone = browser();
    await alice.post('/api/push/subscribe', { subscription: phone.subscription, muted: [group] });
    await alice.post('/api/keywords', { keywords: ['上线'] });
    await send(bob, group, '普通消息');
    await send(bob, group, '@Alice 看一下', { mentions: [alice.id] });
    await send(bob, group, '今晚上线');
    await settle();
    assert.deepEqual(pushedTo(phone.subscription.endpoint).map(item => item.payload.title), ['[有人@你] Bob · 设计组', '[关键词] Bob · 设计组']);
    await alice.post('/api/push/subscribe', { subscription: phone.subscription, private: true });
    await send(bob, direct, '密码是 1234');
    await settle();
    const last = pushedTo(phone.subscription.endpoint).at(-1).payload;
    assert.equal(last.title, '虾扯蛋');
    assert.equal(last.body, '你有一条新消息');
  });

  test('页面开着且在前台时不推；切到后台后照常推', async () => {
    const phone = browser();
    const { id } = (await alice.post('/api/push/subscribe', { subscription: phone.subscription })).body;
    const live = await listen(space.base, alice);
    live.send({ type: 'presence', pushId: id, visible: true });
    await settle();
    await send(bob, direct, '在吗');
    await settle();
    assert.equal(pushedTo(phone.subscription.endpoint).length, 0);
    live.send({ type: 'presence', pushId: id, visible: false });
    await settle();
    await send(bob, direct, '人呢');
    await settle();
    assert.equal(pushedTo(phone.subscription.endpoint).length, 1);
    live.close();
  });

  test('别人不能借用我的订阅号屏蔽我的推送', async () => {
    const phone = browser();
    const { id } = (await alice.post('/api/push/subscribe', { subscription: phone.subscription })).body;
    const live = await listen(space.base, carol);
    live.send({ type: 'presence', pushId: id, visible: true });
    await settle();
    await send(bob, direct, '还在吗');
    await settle();
    assert.equal(pushedTo(phone.subscription.endpoint).length, 1);
    live.close();
  });

  test('拍一拍只推给被拍的人', async () => {
    const alicePhone = browser(), bobPhone = browser();
    await alice.post('/api/push/subscribe', { subscription: alicePhone.subscription });
    await bob.post('/api/push/subscribe', { subscription: bobPhone.subscription });
    await carol.post('/api/nudge', { roomId: 'lobby', userId: bob.id });
    await settle();
    assert.equal(pushedTo(alicePhone.subscription.endpoint).length, 0);
    assert.equal(pushedTo(bobPhone.subscription.endpoint)[0].payload.body, '拍了拍你');
  });

  test('订阅无效时拒绝；取消订阅后不再推；推送服务返回 410 后删掉订阅', async () => {
    const phone = browser();
    assert.equal((await alice.post('/api/push/subscribe', { subscription: { ...phone.subscription, endpoint: 'https://127.0.0.1/push' } })).status, 400);
    assert.equal((await alice.post('/api/push/subscribe', { subscription: { ...phone.subscription, keys: { p256dh: 'abc', auth: 'abc' } } })).status, 400);
    assert.equal((await alice.post('/api/push/subscribe', { subscription: phone.subscription, muted: 'x' })).status, 400);
    assert.equal((await client(space.base).post('/api/push/subscribe', { subscription: phone.subscription })).status, 401);
    await alice.post('/api/push/subscribe', { subscription: phone.subscription });
    await alice.post('/api/push/unsubscribe', { endpoint: phone.subscription.endpoint });
    await send(bob, direct, '取消后');
    await settle();
    assert.equal(pushedTo(phone.subscription.endpoint).length, 0);
    const stale = browser('https://fcm.googleapis.com/fcm/send/gone-1');
    await alice.post('/api/push/subscribe', { subscription: stale.subscription });
    await send(bob, direct, '第一次推送返回 410');
    await settle();
    await send(bob, direct, '之后不再推');
    await settle();
    assert.equal(pushedTo(stale.subscription.endpoint).length, 1);
  });

  test('退出登录后这台设备不再收到推送', async () => {
    const dave = await space.join('Dave');
    const phone = browser();
    await dave.post('/api/push/subscribe', { subscription: phone.subscription });
    await dave.post('/api/logout');
    await send(bob, 'lobby', '退出以后');
    await settle();
    assert.equal(pushedTo(phone.subscription.endpoint).length, 0);
  });
});

describe('手机推送（账号模式）', () => {
  let space;
  const sent = [];
  before(async () => { space = await startCloud({ pushSender: async (subscription, payload) => { sent.push({ subscription, payload }); return 201; } }); });
  after(() => space.close());

  test('在设备管理里让手机下线后，不再推送到那台手机', async () => {
    const alice = await space.member('Alice');
    const bob = await space.member('Bob');
    const phoneLogin = space.client();
    await phoneLogin.post('/api/auth/login', { identifier: 'member1@example.com', password: 'Member-pass-2026' }, { 'User-Agent': 'Phone' });
    await phoneLogin.get('/api/state', { 'User-Agent': 'Phone' });
    const phone = browser();
    assert.equal((await phoneLogin.post('/api/push/subscribe', { subscription: phone.subscription })).status, 200);
    const direct = (await bob.post('/api/rooms', { userId: alice.id })).body.id;
    await send(bob, direct, '第一条');
    await settle();
    assert.equal(sent.filter(item => item.subscription.endpoint === phone.subscription.endpoint).length, 1);
    const target = (await alice.get('/api/sessions')).body.sessions.find(item => item.userAgent === 'Phone');
    await alice.post('/api/sessions/revoke', { id: target.id });
    await send(bob, direct, '第二条');
    await settle();
    assert.equal(sent.filter(item => item.subscription.endpoint === phone.subscription.endpoint).length, 1);
  });
});

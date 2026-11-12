import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startServer } from '../server/index.js';
import { fetchPreview, isPublicAddress, pinnedLookup } from '../server/linkPreview.js';
import { get } from 'node:http';
import { ADMIN_PASSWORD, ADMIN_PHONE, client, startCloud } from './helpers.mjs';
import { fakeDns, fromTable } from './bot-helpers.mjs';
import { createHostResolver } from '../server/resolve.js';

describe('链接预览的地址检查', () => {
  test('内网、本机、保留地址都不算公网', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1'])
      assert.equal(isPublicAddress(ip), false, ip);
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
  });

  test('不会去抓本机上的网页', async () => {
    const local = createServer((_req, res) => res.end('<title>secret</title>'));
    await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
    try {
      await assert.rejects(fetchPreview(`http://127.0.0.1:${local.address().port}/`), /公网/);
      await assert.rejects(fetchPreview(`http://localhost:${local.address().port}/`), /公网/);
      await assert.rejects(fetchPreview('ftp://example.com/'), /网页链接/);
    } finally { local.close(); }
  });
});

describe('链接预览连接时固定用检查过的地址', () => {
  test('两种 lookup 调用方式都支持（Node 20 起默认 all: true）', () => {
    const lookup = pinnedLookup({ address: '93.184.216.34', family: 4 });
    lookup('example.com', { all: true }, (error, addresses) => assert.deepEqual([error, addresses], [null, [{ address: '93.184.216.34', family: 4 }]]));
    lookup('example.com', {}, (error, address, family) => assert.deepEqual([error, address, family], [null, '93.184.216.34', 4]));
  });

  test('带域名的网址能按固定的地址连上（不再报 Invalid IP address）', async () => {
    const local = createServer((_req, res) => res.end('<title>pinned</title>'));
    await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
    try {
      const status = await new Promise((resolve, reject) => get({ host: 'preview.test', port: local.address().port, path: '/', lookup: pinnedLookup({ address: '127.0.0.1', family: 4 }) },
        response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
      assert.equal(status, 200);
    } finally { local.close(); }
  });
});

describe('链接预览接口', () => {
  let server, dataDir, owner, calls = 0;
  before(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'xiachedan-preview-'));
    server = await startServer({ dataDir, port: 0, host: '127.0.0.1', serveWeb: false, mode: 'local', previewFetcher: async url => {
      calls++;
      if (url.includes('broken')) throw new Error('网页没有标题');
      return { url, title: '示例站点', description: '一段简介', site: 'example.com' };
    } });
    owner = client(server.address);
    const setupKey = new URL(server.setupUrl).hash.replace('#setup=', '');
    await owner.post('/api/setup', { name: '主人', spaceName: '空间' }, { 'X-Setup-Key': setupKey });
  });
  after(async () => { await server.close(); rmSync(dataDir, { recursive: true, force: true }); });

  test('返回标题和简介，同一网址只抓一次', async () => {
    const first = await owner.get(`/api/link-preview?url=${encodeURIComponent('https://example.com/a')}`);
    assert.equal(first.status, 200);
    assert.equal(first.body.preview.title, '示例站点');
    await owner.get(`/api/link-preview?url=${encodeURIComponent('https://example.com/a')}`);
    assert.equal(calls, 1);
  });

  test('失败也会缓存，不反复抓取', async () => {
    const before = calls;
    assert.equal((await owner.get(`/api/link-preview?url=${encodeURIComponent('https://example.com/broken')}`)).status, 404);
    assert.equal((await owner.get(`/api/link-preview?url=${encodeURIComponent('https://example.com/broken')}`)).status, 404);
    assert.equal(calls, before + 1);
  });

  test('需要登录，且只接受网页链接', async () => {
    assert.equal((await client(server.address).get(`/api/link-preview?url=${encodeURIComponent('https://example.com/a')}`)).status, 401);
    assert.equal((await owner.get('/api/link-preview?url=javascript:alert(1)')).status, 400);
    assert.equal((await owner.get('/api/link-preview?url=not-a-url')).status, 400);
  });
});

describe('链接预览的域名解析（和机器人回调共用，经过真实的 c-ares）', () => {
  let dns;
  const table = {
    'inner.test': ['10.0.0.8'], 'mapped.test': ['::ffff:127.0.0.1'], 'mixed.test': ['93.184.216.34', 'fd00::5'],
    'alias.test': [{ type: 'CNAME', value: 'lan.test' }, { type: 'A', name: 'lan.test', value: '192.168.1.9' }], 'hang.test': 'hang',
  };
  before(async () => { dns = await fakeDns(fromTable(table)); });
  after(() => dns.close());
  const preview = (url, timeout = 400) => fetchPreview(url, { resolver: createHostResolver({ servers: dns.servers }), timeout });

  test('解析到内网、本机、映射地址、混合结果、指向内网的别名，一律不抓', async () => {
    for (const host of ['inner.test', 'mapped.test', 'mixed.test', 'alias.test']) await assert.rejects(preview(`http://${host}/`), /公网/, host);
    await assert.rejects(preview('http://localhost./'), /公网/);
  });

  test('解析挂住时到时间就放弃，域名不存在给出说明', async () => {
    const started = Date.now();
    await assert.rejects(preview('http://hang.test/'), /超时/);
    assert.ok(Date.now() - started < 1000, `${Date.now() - started}ms`);
    await assert.rejects(preview('http://nowhere.test/'), /找不到/);
  });

  test('账号模式：成员发一堆解析会挂住的网址预览，登录和上传照常', async () => {
    const space = await startCloud({ previewFetcher: url => fetchPreview(url, { resolver: createHostResolver({ servers: dns.servers }), timeout: 1500 }) });
    try {
      const member = await space.member('Alice');
      for (let index = 0; index < 6; index++) table[`hang${index}.test`] = 'hang';
      const pending = Array.from({ length: 6 }, (_, index) => member.get(`/api/link-preview?url=${encodeURIComponent(`http://hang${index}.test/`)}`));
      await new Promise(resolve => setTimeout(resolve, 100));
      let started = Date.now();
      const login = await client(space.base).post('/api/auth/login', { identifier: ADMIN_PHONE, password: ADMIN_PASSWORD });
      assert.equal(login.status, 200);
      const loginTook = Date.now() - started;
      const form = new FormData();
      form.append('file', new Blob([Buffer.alloc(200000, 1)], { type: 'application/octet-stream' }), 'a.bin');
      started = Date.now();
      const uploaded = await fetch(`${space.base}/api/uploads?roomId=lobby`, { method: 'POST', headers: { 'X-Linliao': '1', cookie: [...member.jar].map(([name, value]) => `${name}=${value}`).join('; ') }, body: form });
      assert.equal(uploaded.status, 201);
      const uploadTook = Date.now() - started;
      assert.ok(loginTook < 1200 && uploadTook < 1200, `登录 ${loginTook}ms，上传 ${uploadTook}ms`);
      const results = await Promise.all(pending);
      assert.ok(results.every(result => result.status === 404 && /超时/.test(result.body.error)), JSON.stringify(results.map(result => result.body)));
    } finally { await space.close(); }
  });
});

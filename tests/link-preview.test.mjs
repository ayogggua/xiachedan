import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startServer } from '../server/index.js';
import { fetchPreview, isPublicAddress } from '../server/linkPreview.js';
import { client } from './helpers.mjs';

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

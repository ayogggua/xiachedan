// 前端工程加固回归测试：htmlToMarkdown 惰性文档克隆与链接转义、writeStorage 容错、静态资源缓存头区分。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { htmlToMarkdown } from '../src/htmlToMarkdown.js';
import { writeStorage } from '../src/storage.js';
import { startServer } from '../server/index.js';

function createFakeDom(childrenOfBody) {
  const ownerDocument = {
    created: [],
    createElement(tag) {
      const el = makeElement(tag.toUpperCase(), {}, []);
      ownerDocument.created.push(tag);
      return el;
    },
  };
  function makeText(text) {
    return { nodeType: 3, textContent: text, ownerDocument, cloneNode: () => makeText(text) };
  }
  function makeElement(tagName, attrs = {}, childNodes = []) {
    const el = {
      nodeType: 1,
      tagName,
      attrs,
      childNodes: [...childNodes],
      ownerDocument,
      get children() { return this.childNodes.filter(node => node.nodeType === 1); },
      get textContent() { return this.childNodes.map(node => node.textContent).join(''); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
      append(...nodes) { this.childNodes.push(...nodes); },
      cloneNode(deep) { return makeElement(this.tagName, { ...this.attrs }, deep ? this.childNodes.map(child => child.cloneNode(true)) : []); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    };
    return el;
  }
  const body = makeElement('BODY', {}, childrenOfBody({ makeElement, makeText }));
  return { ownerDocument, body };
}

test('htmlToMarkdown rejects oversized HTML (>200000 chars)', () => {
  const huge = `<b>${'a'.repeat(200001)}</b>`;
  assert.equal(htmlToMarkdown(huge), null);
});

test('htmlToMarkdown wraps inline nodes in ownerDocument without touching active document and escapes link hrefs', () => {
  const prevParser = globalThis.DOMParser;
  const prevDocument = globalThis.document;
  let activeTouched = false;
  let inertCreated = [];

  globalThis.document = {
    createElement() {
      activeTouched = true;
      throw new Error('active document must not be touched');
    },
  };
  globalThis.DOMParser = class {
    parseFromString() {
      const { ownerDocument, body } = createFakeDom(({ makeElement, makeText }) => [
        makeElement('STRONG', {}, [
          makeText('重点'),
          makeElement('IMG', { src: 'https://evil.example/pixel.gif' }),
        ]),
        makeText(' '),
        makeElement('A', { href: 'https://example.com/path(1) with space' }, [makeText('文档')]),
      ]);
      inertCreated = ownerDocument.created;
      return { body };
    }
  };

  try {
    const result = htmlToMarkdown('<strong>重点<img src="x"></strong> <a href="https://example.com/path(1) with space">文档</a>');
    assert.equal(activeTouched, false);
    assert.ok(inertCreated.includes('span'));
    assert.equal(result, '**重点** [文档](https://example.com/path%281%29%20with%20space)');
  } finally {
    if (prevParser === undefined) delete globalThis.DOMParser; else globalThis.DOMParser = prevParser;
    if (prevDocument === undefined) delete globalThis.document; else globalThis.document = prevDocument;
  }
});

test('writeStorage safely swallows QuotaExceededError and persists normally when available', () => {
  const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map();
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: { setItem(k, v) { store.set(k, String(v)); } } });
    assert.equal(writeStorage('linliao.test', '1'), true);
    assert.equal(store.get('linliao.test'), '1');

    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: { setItem() { throw new Error('QuotaExceededError'); } } });
    assert.equal(writeStorage('linliao.test', '2'), false);
  } finally {
    if (prevDesc) Object.defineProperty(globalThis, 'localStorage', prevDesc);
    else delete globalThis.localStorage;
  }
});

for (const mode of ['local', 'cloud']) {
  test(`express.static sets immutable cache headers for assets/hextech and no-cache for HTML/SW/manifest (${mode})`, async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'xiachedan-cache-data-'));
    const webDir = mkdtempSync(path.join(tmpdir(), 'xiachedan-cache-web-'));
    mkdirSync(path.join(webDir, 'assets'), { recursive: true });
    mkdirSync(path.join(webDir, 'avatars', 'hextech'), { recursive: true });
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><html><body>ok</body></html>');
    writeFileSync(path.join(webDir, 'sw.js'), 'self.addEventListener("install", () => {});');
    writeFileSync(path.join(webDir, 'manifest.webmanifest'), '{"name":"test"}');
    writeFileSync(path.join(webDir, 'assets', 'index-abc123.js'), 'console.log("ok");');
    writeFileSync(path.join(webDir, 'avatars', 'hextech', 'demo.webp'), 'RIFFdemoWEBP');

    const prevAdminPassword = process.env.CHAT_ADMIN_INITIAL_PASSWORD;
    let server;
    try {
      if (mode === 'cloud') process.env.CHAT_ADMIN_INITIAL_PASSWORD = 'Initial-pass-2026';
      server = await startServer({ dataDir, port: 0, host: '127.0.0.1', mode, serveWeb: true, webDir });
      const assetRes = await fetch(`${server.address}/assets/index-abc123.js`);
      assert.equal(assetRes.status, 200);
      assert.equal(assetRes.headers.get('cache-control'), 'public, max-age=31536000, immutable');

      const avatarRes = await fetch(`${server.address}/avatars/hextech/demo.webp`);
      assert.equal(avatarRes.status, 200);
      assert.equal(avatarRes.headers.get('cache-control'), 'public, max-age=31536000, immutable');

      for (const pathname of ['/', '/index.html', '/sw.js', '/manifest.webmanifest']) {
        const res = await fetch(`${server.address}${pathname}`);
        assert.equal(res.status, 200, pathname);
        assert.equal(res.headers.get('cache-control'), 'no-cache', pathname);
      }
    } finally {
      if (server) await server.close();
      if (prevAdminPassword === undefined) delete process.env.CHAT_ADMIN_INITIAL_PASSWORD;
      else process.env.CHAT_ADMIN_INITIAL_PASSWORD = prevAdminPassword;
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(webDir, { recursive: true, force: true });
    }
  });
}

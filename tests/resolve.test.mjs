import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { addressAllowed } from '../server/address.js';
import { createHostResolver } from '../server/resolve.js';
import { fakeDns, fromTable } from './bot-helpers.mjs';

const PUBLIC4 = '93.184.216.34', PUBLIC6 = '2606:4700::1111';
const later = (ms, value) => () => new Promise(resolve => setTimeout(() => resolve(value), ms));

// 账号模式和链接预览的解析：A、AAAA 有一族先拿到地址后，另一族最多再等一小段宽限（默认 400ms），不再拖到截止时间。
describe('公网解析：一族先回、另一族挂住或晚到', () => {
  const table = {};
  let first, second, third;
  before(async () => { [first, second, third] = await Promise.all([1, 2, 3].map(() => fakeDns(fromTable(table)))); });
  after(() => Promise.all([first, second, third].map(server => server.close())));
  const resolver = (count = 2) => createHostResolver({ servers: [first, second, third].slice(0, count).flatMap(server => server.servers) });
  const timed = async promise => { const started = Date.now(); const value = await promise; return { value, took: Date.now() - started }; };

  test('AAAA 不回应、A 正常：宽限后用 A 的地址，2 个和 3 个 DNS 服务器都远小于截止时间', async () => {
    table['v4only.test'] = type => type === 'A' ? [PUBLIC4] : 'hang';
    for (const count of [2, 3]) {
      const { value, took } = await timed(resolver(count).resolvePublic('v4only.test', Date.now() + 5000));
      assert.deepEqual(value, [PUBLIC4]);
      assert.ok(took >= 350 && took < 1200, `${count} 个服务器用了 ${took}ms`);
    }
  });

  test('A 不回应、AAAA 正常：同样在宽限后用 AAAA 的地址', async () => {
    table['v6only.test'] = type => type === 'AAAA' ? [PUBLIC6] : 'hang';
    const { value, took } = await timed(resolver().resolvePublic('v6only.test', Date.now() + 5000));
    assert.deepEqual(value, [PUBLIC6]);
    assert.ok(took < 1200, `${took}ms`);
  });

  test('A 公网立刻返回、AAAA 内网在宽限期内返回：两族合并，分类时整体拒绝', async () => {
    table['mixed.test'] = type => type === 'A' ? [PUBLIC4] : later(150, ['fd00::7'])();
    const addresses = await resolver().resolvePublic('mixed.test', Date.now() + 5000);
    assert.deepEqual(addresses.sort(), [PUBLIC4, 'fd00::7'].sort());
    assert.ok(addresses.some(ip => !addressAllowed(ip, 'cloud')));
  });

  test('AAAA 公网先回、A 内网在宽限期内返回：同样合并、整体拒绝', async () => {
    table['mixed6.test'] = type => type === 'AAAA' ? [PUBLIC6] : later(150, ['10.9.8.7'])();
    const addresses = await resolver().resolvePublic('mixed6.test', Date.now() + 5000);
    assert.deepEqual(addresses.sort(), [PUBLIC6, '10.9.8.7'].sort());
    assert.ok(addresses.some(ip => !addressAllowed(ip, 'cloud')));
  });

  test('宽限期过了才回来的那一族已经取消，不会被用上', async () => {
    table['late.test'] = type => type === 'A' ? [PUBLIC4] : later(900, ['::1'])();
    assert.deepEqual(await resolver().resolvePublic('late.test', Date.now() + 5000), [PUBLIC4]);
  });

  test('宽限不超过截止时间', async () => {
    const { value, took } = await timed(resolver().resolvePublic('v4only.test', Date.now() + 150));
    assert.deepEqual(value, [PUBLIC4]);
    assert.ok(took < 400, `${took}ms`);
  });

  test('两族都没有地址时行为不变：不存在报 notfound，都不回应时到截止时间报 timeout', async () => {
    await assert.rejects(resolver().resolvePublic('missing.test', Date.now() + 2000), { code: 'notfound' });
    table['silent.test'] = 'hang';
    const started = Date.now();
    await assert.rejects(resolver().resolvePublic('silent.test', Date.now() + 500), { code: 'timeout' });
    assert.ok(Date.now() - started < 900);
  });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addressAllowed, checkCallbackUrl, classifyAddress } from '../server/address.js';
import { isPublicAddress } from '../server/linkPreview.js';

const expect = (table) => { for (const [ip, kind] of table) assert.equal(classifyAddress(ip), kind, ip); };

describe('外发地址分类', () => {
  test('IPv4 各类地址', () => expect([
    ['8.8.8.8', 'public'], ['1.1.1.1', 'public'], ['172.32.0.1', 'public'], ['100.63.255.255', 'public'], ['100.128.0.0', 'public'], ['169.253.255.255', 'public'], ['223.255.255.255', 'public'],
    ['0.0.0.0', 'unspecified'], ['0.1.2.3', 'unspecified'],
    ['127.0.0.1', 'loopback'], ['127.255.255.254', 'loopback'],
    ['10.0.0.1', 'private'], ['172.16.0.1', 'private'], ['172.31.255.255', 'private'], ['192.168.0.1', 'private'],
    ['169.254.1.1', 'link-local'], ['100.64.0.1', 'cgnat'], ['100.127.255.255', 'cgnat'],
    ['169.254.169.254', 'metadata'], ['169.254.170.2', 'metadata'], ['100.100.100.200', 'metadata'], ['168.63.129.16', 'metadata'], ['169.254.0.23', 'metadata'],
    ['224.0.0.1', 'multicast'], ['239.255.255.255', 'multicast'], ['255.255.255.255', 'broadcast'], ['240.0.0.1', 'reserved'],
    ['192.0.0.8', 'reserved'], ['192.0.2.1', 'reserved'], ['198.51.100.1', 'reserved'], ['203.0.113.9', 'reserved'], ['198.18.0.1', 'reserved'], ['198.19.255.255', 'reserved'], ['192.88.99.1', 'reserved'],
  ]));

  test('IPv6 各类地址', () => expect([
    ['2606:4700::1111', 'public'], ['2001:4860:4860::8888', 'public'], ['2400:cb00::1', 'public'],
    ['::', 'unspecified'], ['0:0:0:0:0:0:0:0', 'unspecified'], ['::1', 'loopback'], ['0:0:0:0:0:0:0:1', 'loopback'],
    ['fc00::1', 'private'], ['fd12:3456::1', 'private'], ['fec0::1', 'private'], ['64:ff9b:1::1', 'private'],
    ['fe80::1', 'link-local'], ['febf::1', 'link-local'], ['ff02::1', 'multicast'], ['ff0e::1', 'multicast'],
    ['fd00:ec2::254', 'metadata'], ['FD00:EC2:0:0:0:0:0:254', 'metadata'],
    ['2001:db8::1', 'reserved'], ['2001::1', 'reserved'], ['2001:10::1', 'reserved'], ['3fff::1', 'reserved'], ['100::1', 'reserved'], ['4000::1', 'reserved'], ['::2:3:4:5:6', 'reserved'],
  ]));

  test('内嵌 IPv4 的写法按里面的 IPv4 算：映射、兼容、转换、NAT64、6to4', () => expect([
    ['::ffff:127.0.0.1', 'loopback'], ['::ffff:7f00:1', 'loopback'], ['::FFFF:7F00:0001', 'loopback'], ['0:0:0:0:0:ffff:7f00:1', 'loopback'],
    ['::ffff:10.0.0.1', 'private'], ['::ffff:a00:1', 'private'], ['::ffff:169.254.169.254', 'metadata'], ['::ffff:a9fe:a9fe', 'metadata'], ['::ffff:8.8.8.8', 'public'],
    ['::127.0.0.1', 'loopback'], ['::7f00:1', 'loopback'], ['::a00:1', 'private'],
    ['::ffff:0:127.0.0.1', 'loopback'], ['::ffff:0:7f00:1', 'loopback'],
    ['64:ff9b::127.0.0.1', 'loopback'], ['64:ff9b::7f00:1', 'loopback'], ['64:ff9b::a9fe:a9fe', 'metadata'], ['64:ff9b::808:808', 'public'],
    ['2002:7f00:1::', 'loopback'], ['2002:c0a8:101::1', 'private'], ['2002:808:808::1', 'reserved'],
  ]));

  test('不是规范 IP 的写法一律无效（交给 URL 解析后再判断）', () => expect([
    ['', 'invalid'], ['localhost', 'invalid'], ['example.com', 'invalid'], ['127.1', 'invalid'], ['0x7f.0.0.1', 'invalid'], ['0177.0.0.1', 'invalid'], ['2130706433', 'invalid'],
    ['1.2.3.04', 'invalid'], ['256.0.0.1', 'invalid'], ['1.2.3', 'invalid'], ['1.2.3.4.5', 'invalid'], ['::ffff:1.2.3', 'invalid'], ['1::2::3', 'invalid'], [':::', 'invalid'],
    ['1:2:3:4:5:6:7:8:9', 'invalid'], ['1:2:3:4:5:6:7', 'invalid'], ['fe80::1%en0', 'invalid'], ['12345::', 'invalid'], [':1:2:3:4:5:6:7', 'invalid'],
  ]));

  test('方括号包着的 IPv6 也能识别', () => { assert.equal(classifyAddress('[::1]'), 'loopback'); assert.equal(classifyAddress('[2606:4700::1111]'), 'public'); });

  test('账号模式只连公网；局域网模式允许内网和本机，仍挡住元数据、组播、广播和未指定地址', () => {
    for (const ip of ['8.8.8.8', '2606:4700::1111']) { assert.equal(addressAllowed(ip, 'cloud'), true, ip); assert.equal(addressAllowed(ip, 'local'), true, ip); }
    for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.1.5', 'fd00::1', 'fe80::1', '100.64.0.1', '198.18.0.1', '::ffff:7f00:1']) {
      assert.equal(addressAllowed(ip, 'cloud'), false, ip);
      assert.equal(addressAllowed(ip, 'local'), true, ip);
    }
    for (const ip of ['169.254.169.254', '::ffff:169.254.169.254', 'fd00:ec2::254', '0.0.0.0', '::', '224.0.0.1', 'ff02::1', '255.255.255.255', 'nonsense'])
      for (const mode of ['cloud', 'local']) assert.equal(addressAllowed(ip, mode), false, `${ip} ${mode}`);
  });

  test('链接预览用同一个判断：IPv4 映射的本机地址不算公网', () => {
    assert.equal(isPublicAddress('::ffff:7f00:1'), false);
    assert.equal(isPublicAddress('::7f00:1'), false);
    assert.equal(isPublicAddress(new URL('http://[::ffff:127.0.0.1]/').hostname.slice(1, -1)), false);
    assert.equal(isPublicAddress('93.184.216.34'), true);
  });
});

describe('回调地址的写法', () => {
  const blocked = (raw, mode = 'cloud') => assert.throws(() => checkCallbackUrl(raw, mode), Error, raw);
  test('十进制、八进制、十六进制、简写、全角数字、末尾的点，都按规范化后的 IP 检查', () => {
    for (const raw of ['http://2130706433/', 'http://017700000001/', 'http://0x7f000001/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://127.0.1/',
      'http://127.0.0.1./', 'http://１２７.０.０.１/', 'http://0xa9.0xfe.0xa9.0xfe/', 'http://3232235777/', 'http://0/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]:8080/',
      'http://[0:0:0:0:0:ffff:127.0.0.1]/', 'http://[::127.0.0.1]/', 'http://[64:ff9b::127.0.0.1]/', 'http://[fe80::1]/', 'http://[::]/'])
      blocked(raw);
    assert.equal(checkCallbackUrl('http://0x7f.1:8080/', 'local').ip, '127.0.0.1');
    assert.equal(checkCallbackUrl('http://3232235777/', 'local').ip, '192.168.1.1');
  });

  test('本机域名在账号模式下当场拒绝，其余域名到投递时解析再查', () => {
    for (const raw of ['http://localhost/', 'http://LOCALHOST:3000/', 'http://localhost./', 'http://localhost../', 'http://a.b.localhost/']) blocked(raw);
    const parsed = checkCallbackUrl('https://Bots.Example.com.:8443/hook?x=1', 'cloud');
    assert.equal(parsed.hostname, 'bots.example.com.');
    assert.equal(parsed.ip, null);
    assert.equal(parsed.port, 8443);
    assert.equal(checkCallbackUrl('http://localhost:3000/', 'local').hostname, 'localhost');
  });

  test('国际化域名按 punycode 处理', () => {
    const parsed = checkCallbackUrl('https://机器人.例子.中国/hook', 'cloud');
    assert.match(parsed.hostname, /^xn--/);
    assert.equal(parsed.port, 443);
  });

  test('端口：默认端口按协议补上，写了就用写的，非法端口拒绝', () => {
    assert.equal(checkCallbackUrl('http://example.com/', 'cloud').port, 80);
    assert.equal(checkCallbackUrl('https://example.com/', 'cloud').port, 443);
    assert.equal(checkCallbackUrl('https://example.com:80/', 'cloud').port, 80);
    assert.equal(checkCallbackUrl('http://8.8.8.8:65535/', 'cloud').port, 65535);
    blocked('http://example.com:65536/');
    blocked('http://example.com:0/');
    blocked('http://example.com:0/', 'local');
    blocked('http://127.0.0.1:443/');
  });

  test('只要 http/https，不带账号密码，有长度上限', () => {
    for (const raw of ['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'gopher://example.com/', 'ws://example.com/', 'http://user@example.com/', 'http://:pw@example.com/',
      'http://u:p@example.com/', `https://example.com/${'a'.repeat(2048)}`, '', '   ', 'example.com', 'http://', 'http://[::1/']) blocked(raw);
    blocked(null); blocked(42);
    assert.equal(checkCallbackUrl(`https://example.com/${'a'.repeat(2000)}`, 'cloud').ip, null);
    // 按规范化后的长度算：300 个汉字原文只有 300 多字，编码后是 2700 字。
    assert.throws(() => checkCallbackUrl(`https://example.com/${'中'.repeat(300)}`, 'cloud'), /2048/);
    assert.equal(checkCallbackUrl(`https://example.com/${'中'.repeat(200)}`, 'cloud').url.href.length, 20 + 200 * 9);
    assert.throws(() => checkCallbackUrl(`https://${'例'.repeat(60)}.example.com/${'a'.repeat(1980)}`, 'cloud'), /2048/);
    assert.throws(() => checkCallbackUrl(`https://example.com/${'a'.repeat(9000)}`, 'cloud'), /2048/);
  });
});

// 外发请求的目标地址检查（机器人回调、链接预览共用）：把一个 IP 归到一类，再按运行模式决定能不能连。
// 只接受解析好的规范写法（WHATWG URL 已把十进制、八进制、十六进制和全角数字等写法统一成点分十进制，DNS 结果本身就是规范的）。

const v4 = text => {
  const parts = text.split('.');
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return null;
  return parts.map(Number);
};

// 展开成 8 组 16 位数；带区域标识（%en0）、写法不合法的一律返回 null。
const v6 = text => {
  if (typeof text !== 'string' || !text.includes(':') || text.includes('%')) return null;
  let head = text, tail = [];
  const last = text.lastIndexOf(':');
  // 末尾是点分 IPv4（::ffff:1.2.3.4）：拆成最后两组，前面去掉单个冒号，保留「::」。
  if (text.slice(last + 1).includes('.')) {
    const embedded = v4(text.slice(last + 1));
    if (!embedded) return null;
    tail = [embedded[0] << 8 | embedded[1], embedded[2] << 8 | embedded[3]];
    head = text.slice(0, last + 1);
    if (!head.endsWith('::')) head = head.slice(0, -1);
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const group = part => part === '' ? [] : part.split(':');
  const left = group(halves[0]), right = halves.length === 2 ? group(halves[1]) : [];
  if ([...left, ...right].some(value => !/^[0-9a-f]{1,4}$/i.test(value))) return null;
  const missing = 8 - tail.length - left.length - right.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...left, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...right].map(value => parseInt(value, 16)).concat(tail);
};

const inV4 = (bytes, base, bits) => {
  const value = bytes.reduce((sum, byte) => sum * 256 + byte, 0), start = v4(base).reduce((sum, byte) => sum * 256 + byte, 0);
  return Math.floor(value / 2 ** (32 - bits)) === Math.floor(start / 2 ** (32 - bits));
};

// 云厂商的实例元数据与内部服务地址：AWS、GCP、Azure、阿里云、腾讯云、ECS/EKS 凭证接口等。
const METADATA = new Set(['169.254.169.254', '169.254.170.2', '169.254.170.23', '169.254.0.23', '100.100.100.200', '168.63.129.16', 'fd00:ec2::254', 'fd00:ec2::23']);
const V4_CLASSES = [
  ['0.0.0.0', 8, 'unspecified'], ['10.0.0.0', 8, 'private'], ['100.64.0.0', 10, 'cgnat'], ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local'], ['172.16.0.0', 12, 'private'], ['192.0.0.0', 24, 'reserved'], ['192.0.2.0', 24, 'reserved'],
  ['192.88.99.0', 24, 'reserved'], ['192.168.0.0', 16, 'private'], ['198.18.0.0', 15, 'reserved'], ['198.51.100.0', 24, 'reserved'],
  ['203.0.113.0', 24, 'reserved'], ['224.0.0.0', 4, 'multicast'], ['255.255.255.255', 32, 'broadcast'], ['240.0.0.0', 4, 'reserved'],
];
const classifyV4 = bytes => {
  if (METADATA.has(bytes.join('.'))) return 'metadata';
  return V4_CLASSES.find(([base, bits]) => inV4(bytes, base, bits))?.[2] || 'public';
};
const embeddedV4 = (groups, from) => [groups[from] >> 8, groups[from] & 255, groups[from + 1] >> 8, groups[from + 1] & 255];
const METADATA_V6 = [...METADATA].filter(value => value.includes(':')).map(value => v6(value).join(':'));

/**
 * 地址分类：public 公网；loopback 本机；private 内网（含 IPv6 唯一本地、站点本地、本地 NAT64）；link-local 链路本地；
 * cgnat 运营商级 NAT；multicast 组播；broadcast 广播；unspecified 未指定；metadata 云元数据；reserved 文档、测试、隧道等保留地址；
 * invalid 不是 IP。IPv4 映射（::ffff:a.b.c.d）、IPv4 兼容（::a.b.c.d）、IPv4 转换（::ffff:0:a.b.c.d）、NAT64（64:ff9b::/96）
 * 和 6to4（2002::/16）按里面的 IPv4 算。
 */
export function classifyAddress(ip) {
  const text = typeof ip === 'string' ? ip.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1') : '';
  const bytes = v4(text);
  if (bytes) return classifyV4(bytes);
  const groups = v6(text);
  if (!groups) return 'invalid';
  if (METADATA_V6.includes(groups.join(':'))) return 'metadata';
  const zeros = count => groups.slice(0, count).every(value => value === 0);
  if (zeros(8)) return 'unspecified';
  if (zeros(7) && groups[7] === 1) return 'loopback';
  if (zeros(5) && groups[5] === 0xffff) return classifyV4(embeddedV4(groups, 6));
  if (zeros(4) && groups[4] === 0xffff && groups[5] === 0) return classifyV4(embeddedV4(groups, 6));
  if (zeros(6)) return classifyV4(embeddedV4(groups, 6));
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every(value => value === 0)) return classifyV4(embeddedV4(groups, 6));
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1) return 'private';
  if (groups[0] === 0x2002) { const inner = classifyV4(embeddedV4(groups, 1)); return inner === 'public' ? 'reserved' : inner; }
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return 'reserved';
  if (groups[0] === 0x2001 && groups[1] < 0x0200) return 'reserved';
  if (groups[0] === 0x3fff && groups[1] < 0x1000) return 'reserved';
  if (groups[0] === 0x0100 && groups.slice(1, 4).every(value => value === 0)) return 'reserved';
  if ((groups[0] & 0xfe00) === 0xfc00) return 'private';
  if ((groups[0] & 0xffc0) === 0xfe80) return 'link-local';
  if ((groups[0] & 0xffc0) === 0xfec0) return 'private';
  if ((groups[0] & 0xff00) === 0xff00) return 'multicast';
  if ((groups[0] & 0xe000) === 0x2000) return 'public';
  return 'reserved';
}

// 账号模式（服务器在公网）只连公网地址；局域网模式连内网和本机是常态，只挡掉连不上或不该连的几类。
export function addressAllowed(ip, mode) {
  const kind = classifyAddress(ip);
  if (mode === 'local') return !['invalid', 'unspecified', 'multicast', 'broadcast', 'metadata'].includes(kind);
  return kind === 'public';
}

export const ADDRESS_LABELS = { loopback: '本机地址', private: '内网地址', 'link-local': '链路本地地址', cgnat: '运营商内网地址', multicast: '组播地址',
  broadcast: '广播地址', unspecified: '无效地址', metadata: '云服务器元数据地址', reserved: '保留地址', invalid: '无效地址', public: '公网地址' };

export const CALLBACK_MAX_LENGTH = 2048;

/**
 * 检查回调地址的写法：只要 http/https、不能带用户名密码、长度有上限；IP 直接写在地址里的当场按模式检查，
 * 域名在每次投递时解析后再查（见 botDelivery.js）。返回 { url, hostname, ip, port } 或抛出带中文说明的错误。
 */
export function checkCallbackUrl(raw, mode) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('请填写回调地址');
  const value = raw.trim();
  // 上限按规范化之后的地址算（中文路径、国际化域名规范化后会变长，存下来的也是规范化后的）；原文只挡明显过长的。
  if (value.length > CALLBACK_MAX_LENGTH * 4) throw new Error(`回调地址最多 ${CALLBACK_MAX_LENGTH} 个字符`);
  let url;
  try { url = new URL(value); } catch { throw new Error('回调地址无效'); }
  if (url.href.length > CALLBACK_MAX_LENGTH) throw new Error(`回调地址最多 ${CALLBACK_MAX_LENGTH} 个字符（按规范化后的写法计算）`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('回调地址只能是 http 或 https');
  if (url.username || url.password) throw new Error('回调地址里不能带用户名或密码');
  if (url.port === '0') throw new Error('回调地址的端口无效');
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  if (!hostname) throw new Error('回调地址无效');
  const ip = classifyAddress(hostname) === 'invalid' ? null : hostname;
  if (ip && !addressAllowed(ip, mode)) throw new Error(`回调地址不能指向${ADDRESS_LABELS[classifyAddress(ip)]}`);
  const bare = hostname.replace(/\.+$/, '');
  if (!ip && mode !== 'local' && (bare === 'localhost' || bare.endsWith('.localhost'))) throw new Error('回调地址不能指向本机地址');
  return { url, hostname, ip, port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80) };
}

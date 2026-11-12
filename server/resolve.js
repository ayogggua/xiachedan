import dns from 'node:dns';

// 外发请求（机器人回调、链接预览）共用的域名解析。只负责把域名变成地址，带调用方的截止时间；
// 地址能不能连由调用方用 address.js 逐个分类，连接时钉在检查过的地址上。
//
// public：只连公网地址的去处（账号模式的机器人回调、链接预览）。用 c-ares（dns.Resolver）直接发 DNS 查询，
//   不占 libuv 线程池，到截止时间就 cancel()，挂住的域名不会拖住登录、上传这些用线程池的工作，所以不用限并发。
//   和 getaddrinfo 的区别：不读 /etc/hosts、不追加 resolv.conf 里的搜索域、不走 mDNS（公网地址用不上这些）。
//   A 和 AAAA 都查，结果合在一起；CNAME 链由递归服务器放在应答里，c-ares 会跟到最后的地址。
// lan：局域网模式的机器人回调要认 /etc/hosts 和 .local，只能用 getaddrinfo（dns.lookup）。它跑在线程池上、取消不了，
//   所以同时最多 maxLookups 个；多出来的排队，等到自己的截止时间为止；同一个域名正在解析或排队时，后来的直接共用那一次的结果。
export class ResolveError extends Error {
  // code：timeout 截止时间前没解析完；queued 排队到截止时间也没轮到；notfound 域名不存在或没有地址。
  constructor(code) { super(code); this.code = code; }
}

const defaultLookup = hostname => dns.promises.lookup(hostname, { all: true });
const until = deadline => {
  let timer;
  const promise = new Promise(resolve => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now()), 'expired'); });
  return { promise, clear: () => clearTimeout(timer) };
};

export function createHostResolver({ servers, lookup = defaultLookup, maxLookups = 2, queryTimeout = 1000, tries = 2, familyGrace = 400 } = {}) {
  // 每次解析用一个独立的 Resolver：cancel() 只取消它自己的查询。单次查询 queryTimeout 毫秒、最多 tries 次（c-ares 每次重试把等待时间翻倍），
  // 再加上调用方的截止时间兜底。
  // A 和 AAAA 有一族先拿到了地址：另一族最多再等 familyGrace 毫秒（不超过截止时间），到点就取消它、用已有的地址。
  // 有些域名的 AAAA 查询不回应，配了多个 DNS 服务器时 c-ares 会逐个重试，不设宽限就会把整个截止时间耗光。
  // 宽限期内回来的照常合并；取消掉的那一族即使后来有结果也不会用。返回的地址由调用方全部分类，有一个不允许就整体拒绝。
  async function resolvePublic(hostname, deadline) {
    const resolver = new dns.promises.Resolver({ timeout: queryTimeout, tries });
    if (servers) resolver.setServers(servers);
    const results = {};
    let wake, grace;
    const finished = new Promise(resolve => { wake = resolve; });
    const settle = (family, result) => {
      results[family] = result;
      if (results.v4 && results.v6) return wake('both');
      if (result.addresses?.length && !grace) grace = setTimeout(wake, Math.min(familyGrace, Math.max(0, deadline - Date.now())), 'grace');
    };
    resolver.resolve4(hostname).then(addresses => settle('v4', { addresses }), error => settle('v4', { error }));
    resolver.resolve6(hostname).then(addresses => settle('v6', { addresses }), error => settle('v6', { error }));
    const timer = until(deadline);
    await Promise.race([finished, timer.promise]);
    timer.clear();
    clearTimeout(grace);
    const settled = [results.v4, results.v6].filter(Boolean);
    if (settled.length < 2) resolver.cancel();
    const addresses = settled.flatMap(item => item.addresses || []);
    if (addresses.length) return addresses;
    if (settled.length < 2) throw new ResolveError('timeout');
    throw new ResolveError(settled.some(item => item.error?.code === 'ETIMEOUT') ? 'timeout' : 'notfound');
  }

  const jobs = new Map();
  const waiting = [];
  let running = 0;
  const start = job => {
    running++;
    job.started = true;
    Promise.resolve().then(() => lookup(job.hostname)).then(list => job.settle({ list }), error => job.settle({ error }))
      .finally(() => { running--; if (jobs.get(job.hostname) === job) jobs.delete(job.hostname); next(); });
  };
  // 轮到排队的那个时，如果等它的人都已经放弃（截止时间过了），就不再去占线程。
  const next = () => {
    while (running < maxLookups && waiting.length) {
      const job = waiting.shift();
      if (job.waiters > 0) start(job);
      else { if (jobs.get(job.hostname) === job) jobs.delete(job.hostname); job.settle({ abandoned: true }); }
    }
  };
  async function resolveLan(hostname, deadline) {
    let job = jobs.get(hostname);
    if (!job) {
      job = { hostname, waiters: 0, started: false };
      job.promise = new Promise(resolve => { job.settle = resolve; });
      jobs.set(hostname, job);
      if (running < maxLookups) start(job); else waiting.push(job);
    }
    job.waiters++;
    const timer = until(deadline);
    const outcome = await Promise.race([job.promise, timer.promise]);
    timer.clear();
    job.waiters--;
    if (outcome === 'expired') throw new ResolveError(job.started ? 'timeout' : 'queued');
    const addresses = (outcome.list || []).map(item => typeof item === 'string' ? item : item?.address).filter(Boolean);
    if (!addresses.length) throw new ResolveError('notfound');
    return addresses;
  }

  return { resolvePublic, resolveLan, stats: () => ({ running, waiting: waiting.length, shared: jobs.size }) };
}

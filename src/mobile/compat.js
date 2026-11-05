// iOS 16 与较旧的 Android WebView 缺少部分现代取消请求 API。
if (!AbortSignal.timeout) AbortSignal.timeout = milliseconds => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), milliseconds);
  return controller.signal;
};
if (!AbortSignal.any) AbortSignal.any = signals => {
  const controller = new AbortController();
  const handlers = new Map();
  const cleanup = () => { for (const [signal, handler] of handlers) signal.removeEventListener('abort', handler); handlers.clear(); };
  for (const signal of signals) {
    if (signal.aborted) { controller.abort(signal.reason); cleanup(); break; }
    const handler = () => { controller.abort(signal.reason); cleanup(); };
    handlers.set(signal, handler); signal.addEventListener('abort', handler, { once: true });
  }
  return controller.signal;
};
if (!Array.prototype.findLast) Object.defineProperty(Array.prototype, 'findLast', { configurable: true, writable: true, value(predicate, thisArg) {
  for (let i = this.length - 1; i >= 0; i--) if (predicate.call(thisArg, this[i], i, this)) return this[i];
} });

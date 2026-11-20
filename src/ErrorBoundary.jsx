import React from 'react';

let attemptSeq = 1;
export const nextAttempt = () => attemptSeq++;
export const RetryContext = React.createContext(0);

// 轻量错误边界：捕获子树渲染异常，按需降级并提供恢复能力。
export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(previous) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  reset = () => { this.setState({ error: null }); this.props.onReset?.(); };
  render() {
    if (this.state.error) return this.props.fallback({ error: this.state.error, reset: this.reset });
    return this.props.children;
  }
}

// 可重试的按需加载封装：加载成功后缓存组件引用不再重复挂起；失败时随 RetryContext 递增重新创建 lazy 实例。
export function lazyModule(loader, pick = module => module.default) {
  let resolved = null;
  let pending = null;
  return function LazyComponent(props) {
    const attempt = React.useContext(RetryContext);
    if (resolved) {
      const Resolved = resolved;
      return <Resolved {...props} />;
    }
    if (!pending || pending.attempt !== attempt) {
      pending = {
        attempt,
        Comp: React.lazy(() => loader().then(module => {
          resolved = pick(module);
          return { default: resolved };
        })),
      };
    }
    const Comp = pending.Comp;
    return <Comp {...props} />;
  };
}

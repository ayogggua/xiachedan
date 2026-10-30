// 注入到主窗口每个页面（含同事主机提供的页面），提供与 Electron preload 相同的 window.desktop 契约。
(() => {
  if (window.desktop) return;
  /*INVITATION*/
  // 加入同事空间：#join= 由桌面端带来，在对方页面里完成加入（新旧版本主机通用），成功后重新载入。
  const join = new URLSearchParams(location.hash.slice(1)).get('join');
  if (join) {
    history.replaceState(null, '', location.pathname);
    const headers = { 'Content-Type': 'application/json', 'X-Linliao': '1' };
    fetch('/api/bootstrap', { headers }).then(response => response.json()).then(async bootstrap => {
      if (bootstrap.me || !bootstrap.configured) return;
      const response = await fetch('/api/join', { method: 'POST', headers, body: join });
      if (response.ok) return location.reload();
      const result = await response.json().catch(() => ({}));
      sessionStorage.setItem('linliao.joinError', result.error || '暂时无法加入空间');
      location.reload();
    }).catch(() => { sessionStorage.setItem('linliao.joinError', '连接中断，请检查网络后重新加入'); location.reload(); });
  }
  const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args)
    .catch(error => { throw new Error(typeof error === 'string' ? error : error?.message || '操作失败'); });
  // 标题区拖动窗口、双击缩放：新界面用 data-drag-region 标记，旧版主机页面沿用 .window-bar。
  addEventListener('mousedown', event => {
    if (event.button !== 0 || !event.target.closest?.('[data-drag-region], .window-bar')) return;
    if (event.target.closest('button, a, input, textarea, select, label, summary, [role="button"], [contenteditable="true"]')) return;
    event.preventDefault();
    invoke(event.detail === 2 ? 'desktop_zoom' : 'desktop_drag').catch(() => {});
  }, true);
  const listeners = new Set();
  Object.defineProperty(window, '__linliaoDesktopEmit', { value: event => { for (const listener of listeners) { try { listener(event); } catch {} } } });
  window.desktop = Object.freeze({
    platform: '/*PLATFORM*/',
    material: '/*MATERIAL*/' || null,
    setAppearance: theme => invoke('desktop_appearance', { theme }),
    updates: Object.freeze({ check: () => invoke('desktop_update_check'), install: () => invoke('desktop_update_install') }),
    connect: async (invitation, identity) => {
      const { addresses, inviteCode } = parseInvitation(invitation);
      if (!addresses.length) throw new Error('这只有邀请码，请复制包含内网地址的完整邀请');
      return invoke('desktop_connect', { addresses, inviteCode,
        identity: { name: String(identity?.name || '').trim().slice(0, 24), avatar: String(identity?.avatar || 'cat') } });
    },
    home: () => invoke('desktop_home'),
    copy: text => invoke('desktop_copy', { text }),
    ready: privateMode => invoke('desktop_ready', { privateMode: privateMode === true }),
    getState: () => invoke('desktop_state'),
    settings: value => invoke('desktop_settings', { value }),
    activity: value => invoke('desktop_activity', { value }),
    message: value => invoke('desktop_message', { value }),
    recalled: value => invoke('desktop_recalled', { value }),
    historyCleared: () => invoke('desktop_history_cleared'),
    testNotification: () => invoke('desktop_test_notification'),
    notificationSettings: () => invoke('desktop_notification_settings'),
    onEvent: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  });
})();

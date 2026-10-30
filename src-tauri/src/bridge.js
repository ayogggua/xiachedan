// 注入到主窗口每个页面（含同事主机提供的页面），提供与 Electron preload 相同的 window.desktop 契约。
(() => {
  if (window.desktop) return;
  /*INVITATION*/
  const invoke = (command, args = {}) => window.__TAURI_INTERNALS__.invoke(command, args)
    .catch(error => { throw new Error(typeof error === 'string' ? error : error?.message || '操作失败'); });
  const listeners = new Set();
  Object.defineProperty(window, '__linliaoDesktopEmit', { value: event => { for (const listener of listeners) { try { listener(event); } catch {} } } });
  window.desktop = Object.freeze({
    platform: '/*PLATFORM*/',
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

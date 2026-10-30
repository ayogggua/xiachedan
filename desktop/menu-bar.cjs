const { app, Tray, Menu, nativeImage, Notification, screen, shell } = require('electron');
const path = require('node:path');

const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;

class MenuBar {
  constructor({ window, getConfig, updateConfig, home, quit }) {
    Object.assign(this, { window, getConfig, updateConfig, home, quit });
    this.unread = new Set();
    this.seen = new Set();
    this.notifications = new Map();
    this.currentRoomId = null;
    this.pendingRoom = null;
    this.rendererReady = false;
    this.notificationError = '';
    const icon = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'));
    icon.setTemplateImage(true);
    this.tray = new Tray(icon);
    this.tray.setIgnoreDoubleClickEvents(true);
    this.tray.on('click', () => this.isActive() ? this.window.hide() : this.show());
    this.tray.on('right-click', () => this.tray.popUpContextMenu(this.menu()));
    for (const event of ['show', 'hide', 'focus', 'blur', 'minimize', 'restore']) {
      this.window.on(event, () => this.send('visibility', { active: this.isActive() }));
    }
    this.clearNotifications();
    this.render();
  }

  isActive() {
    return !this.window.isDestroyed() && this.window.isVisible() && this.window.isFocused() && !this.window.isMinimized();
  }

  send(type, data) {
    if (this.rendererReady && !this.window.isDestroyed()) this.window.webContents.send('chat:event', { type, ...data });
  }

  state() {
    const config = this.getConfig();
    return {
      privateMode: config.privateMode !== false,
      notificationsEnabled: config.notificationsEnabled !== false,
      notificationSupported: Notification.isSupported(),
      notificationError: this.notificationError,
      active: this.isActive(),
    };
  }

  ready(initialPrivateMode) {
    if (typeof this.getConfig().privateMode !== 'boolean') {
      this.updateConfig({ privateMode: initialPrivateMode === true });
    }
    this.rendererReady = true;
    const pendingRoom = this.pendingRoom;
    this.pendingRoom = null;
    return { ...this.state(), pendingRoom };
  }

  settings(value) {
    if (!value || typeof value !== 'object') throw new Error('设置无效');
    const patch = {};
    for (const key of ['privateMode', 'notificationsEnabled']) {
      if (key in value) {
        if (typeof value[key] !== 'boolean') throw new Error('设置无效');
        patch[key] = value[key];
      }
    }
    if (patch.privateMode === true || patch.notificationsEnabled === false) this.clearNotifications();
    this.updateConfig(patch);
    this.render();
    this.send('settings', this.state());
    return this.state();
  }

  activity(value) {
    if (!value || !Array.isArray(value.unreadRooms) || value.unreadRooms.length > 5000 ||
        !value.unreadRooms.every(validId) || (value.currentRoomId !== null && !validId(value.currentRoomId))) throw new Error('会话状态无效');
    this.currentRoomId = value.currentRoomId;
    this.unread = new Set(value.unreadRooms);
    for (const roomId of this.notifications.keys()) {
      if (roomId !== '__test__' && !this.unread.has(roomId)) this.clearRoom(roomId);
    }
    this.render();
    return true;
  }

  show(roomId) {
    if (this.window.isDestroyed()) return;
    if (validId(roomId)) {
      if (this.rendererReady) this.send('open-room', { roomId });
      else this.pendingRoom = roomId;
    }
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    if (!this.window.isFullScreen()) {
      const anchor = this.tray.getBounds();
      const area = screen.getDisplayMatching(anchor).workArea;
      const bounds = this.window.getBounds();
      const width = Math.min(bounds.width, area.width - 16);
      const height = Math.min(bounds.height, area.height - 16);
      const x = Math.max(area.x + 8, Math.min(anchor.x + anchor.width - width, area.x + area.width - width - 8));
      const y = Math.max(area.y + 8, Math.min(anchor.y + anchor.height + 8, area.y + area.height - height - 8));
      this.window.setBounds({ x, y, width, height });
    }
    if (process.platform === 'darwin') app.focus({ steal: true });
    this.window.focus();
  }

  message(value) {
    if (!value || !validId(value.id) || !validId(value.roomId) || typeof value.title !== 'string' ||
        value.title.length > 120 || typeof value.body !== 'string' || value.body.length > 240) throw new Error('消息提醒无效');
    if (this.seen.has(value.id)) return false;
    this.seen.add(value.id);
    if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
    if (this.isActive() && this.currentRoomId === value.roomId) return false;
    this.unread.add(value.roomId);
    this.render();
    if (!this.state().notificationsEnabled || !Notification.isSupported()) return false;
    // Both processes enforce masking. Unknown privacy state fails closed.
    const privateMode = this.state().privateMode || value.privateMode !== false;
    return this.display(value.roomId, {
      id: `linliao-${value.id}`, groupId: value.roomId,
      title: privateMode ? '虾扯蛋 · 新消息' : value.title || '虾扯蛋 · 新消息',
      body: privateMode ? '****' : value.body,
    });
  }

  recalled(value) {
    if (!value || !validId(value.id) || !validId(value.roomId)) throw new Error('消息标识无效');
    if (this.notifications.get(value.roomId)?.chatMessageId === `linliao-${value.id}`) this.clearRoom(value.roomId);
    return true;
  }

  display(roomId, options) {
    this.clearRoom(roomId);
    try {
      const notification = new Notification({ ...options, silent: false });
      notification.chatMessageId = options.id;
      this.notifications.set(roomId, notification);
      // Retain the object while it remains in Notification Center, so clicks work
      // after the banner disappears and privacy mode can still remove its preview.
      notification.on('click', () => { this.show(roomId === '__test__' ? null : roomId); this.clearRoom(roomId); });
      notification.on('failed', () => {
        this.notificationError = '系统未能显示提醒，请检查 macOS 的通知设置。';
        this.send('settings', this.state());
      });
      notification.on('show', () => { this.notificationError = ''; this.send('settings', this.state()); });
      notification.show();
      if (this.notifications.size > 50) this.clearRoom(this.notifications.keys().next().value);
      return true;
    } catch {
      this.notificationError = '系统未能显示提醒，请检查 macOS 的通知设置。';
      this.send('settings', this.state());
      return false;
    }
  }

  testNotification() {
    if (!Notification.isSupported()) throw new Error('当前系统不支持通知');
    if (!this.state().notificationsEnabled) throw new Error('请先开启新消息提醒');
    return this.display('__test__', {
      id: 'linliao-test', title: '虾扯蛋 · 测试提醒',
      body: this.state().privateMode ? '****' : '收到新消息时，虾扯蛋会在这里提醒你。',
    });
  }

  openNotificationSettings() {
    return shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension');
  }

  clearRoom(roomId) {
    this.notifications.get(roomId)?.close();
    this.notifications.delete(roomId);
  }

  clearNotifications() {
    for (const roomId of this.notifications.keys()) this.clearRoom(roomId);
    if (process.platform === 'darwin' && Notification.isSupported()) Notification.removeAll();
  }

  resetSpace() {
    this.rendererReady = false;
    this.pendingRoom = null;
    this.currentRoomId = null;
    this.unread.clear();
    this.seen.clear();
    this.clearNotifications();
    this.render();
  }

  render() {
    const count = this.unread.size;
    this.tray.setTitle(count ? (count > 99 ? '99+' : String(count)) : '');
    this.tray.setToolTip(count ? `虾扯蛋 · ${count} 个未读会话` : '虾扯蛋 · 点击打开聊天，右键查看设置');
  }

  menu() {
    const state = this.state();
    return Menu.buildFromTemplate([
      { label: this.unread.size ? `打开虾扯蛋（${this.unread.size} 个未读会话）` : '打开虾扯蛋', click: () => this.show() },
      { type: 'separator' },
      { label: '隐私模式', type: 'checkbox', checked: state.privateMode, click: item => this.settings({ privateMode: item.checked }) },
      { label: '新消息弹窗提醒', type: 'checkbox', checked: state.notificationsEnabled, click: item => this.settings({ notificationsEnabled: item.checked }) },
      { label: '发送测试提醒', enabled: state.notificationsEnabled && state.notificationSupported, click: () => this.testNotification() },
      { label: 'macOS 通知设置…', click: () => this.openNotificationSettings().catch(() => {}) },
      { type: 'separator' },
      { label: '返回本机空间', click: () => { this.home(); this.show(); } },
      { label: '退出虾扯蛋', click: this.quit },
    ]);
  }

  destroy() {
    this.clearNotifications();
    this.tray.destroy();
  }
}

module.exports = { MenuBar };

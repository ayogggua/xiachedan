const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  connect: (invitation, identity) => ipcRenderer.invoke('chat:connect', invitation, identity),
  home: () => ipcRenderer.invoke('chat:home'),
  copy: text => ipcRenderer.invoke('chat:copy', text),
  ready: privateMode => ipcRenderer.invoke('chat:ready', privateMode),
  getState: () => ipcRenderer.invoke('chat:desktop-state'),
  settings: value => ipcRenderer.invoke('chat:settings', value),
  activity: value => ipcRenderer.invoke('chat:activity', value),
  message: value => ipcRenderer.invoke('chat:message', value),
  recalled: value => ipcRenderer.invoke('chat:recalled', value),
  historyCleared: () => ipcRenderer.invoke('chat:history-cleared'),
  testNotification: () => ipcRenderer.invoke('chat:test-notification'),
  notificationSettings: () => ipcRenderer.invoke('chat:notification-settings'),
  onEvent: callback => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('chat:event', handler);
    return () => ipcRenderer.removeListener('chat:event', handler);
  },
});

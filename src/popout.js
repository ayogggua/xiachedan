// 桌面端的会话独立窗口：地址里带 ?popout=会话，只显示这个会话；通知和提示音交给主窗口。
export const popoutRoom = new URLSearchParams(location.search).get('popout') || '';

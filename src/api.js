const setup = new URLSearchParams(location.hash.slice(1)).get('setup');
if (setup) {
  sessionStorage.setItem('linliao.setup', setup);
  history.replaceState(null, '', location.pathname);
}

export async function api(route, body, options = {}) {
  const response = await fetch(`/api/${route}`, {
    signal: AbortSignal.timeout(20000),
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Linliao': '1', 'X-Setup-Key': sessionStorage.getItem('linliao.setup') || '' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...options,
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || '连接暂时不可用'), { status: response.status });
  return data;
}

export function upload(file, query, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads?${new URLSearchParams(query)}`);
    xhr.setRequestHeader('X-Linliao', '1');
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error('上传中断，请检查局域网连接'));
    xhr.ontimeout = () => reject(new Error('上传超时，请重试'));
    xhr.onload = () => {
      try { const data = JSON.parse(xhr.responseText); xhr.status < 300 ? resolve(data) : reject(new Error(data.error)); }
      catch { reject(new Error('上传未完成，请重试')); }
    };
    const body = new FormData();
    body.append('file', file);
    xhr.send(body);
  });
}

export const mediaUrl = (id, download = false) => `/api/media?id=${encodeURIComponent(id)}${download ? '&download=1' : ''}`;
export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export const randomName = () => {
  const descriptions = ['准点下班的', '正在发呆的', '有点机灵的', '爱喝拿铁的', '慢慢来的', '不熬夜的', '周五快乐的', '认真摸鱼的', '带薪散步的', '灵感满格的'];
  const animals = ['海獭', '水豚', '小熊猫', '柴犬', '企鹅', '松鼠', '橘猫', '考拉', '小海豹', '刺猬'];
  return descriptions[Math.floor(Math.random() * descriptions.length)] + animals[Math.floor(Math.random() * animals.length)];
};
export const formatTime = timestamp => new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
export const formatSize = bytes => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

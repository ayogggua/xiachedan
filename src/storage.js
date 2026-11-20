// 安全写入 localStorage：在隐私模式或存储配额已满时不抛出未捕获异常。
export function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

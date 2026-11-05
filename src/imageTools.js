// 发图前压缩：长边超过 2560 或文件超过 1.5 MB 的静态图片，长边缩到 2560 再上传；动图和小图保持原样。
// 带透明的 PNG 转成 WebP（保留透明），其他转成 JPEG；压缩后反而更大时用原图。
const LONGEST = 2560;
const LIMIT = 1.5 * 1024 * 1024;

export async function compressImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return file;
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= LONGEST && file.size <= LIMIT) { bitmap.close(); return file; }
  const scale = Math.min(1, LONGEST / longest);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.86));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + (type === 'image/jpeg' ? '.jpg' : '.webp'), { type });
}

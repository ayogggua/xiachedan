import React, { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { mediaUrl, formatSize } from './api';
import { mobileClient, mobileHeaders, nativeMobile } from './mobile/session';
import { Modal } from './components';
import { CodeBlock, FormattedText } from './markdown';

// 文件预览：文本和代码在 App 里直接看（只当纯文字显示，不执行任何内容）；PDF 交给浏览器自带的阅读器在新标签页打开。
const LANGUAGES = { txt: '', log: '', md: 'markdown', markdown: 'markdown', json: 'json', csv: '', tsv: '', xml: 'xml', html: 'xml', yaml: 'yaml', yml: 'yaml', ini: 'ini', conf: 'ini', toml: 'ini',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', java: 'java', go: 'go', rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', sh: 'bash', sql: 'sql', css: 'css', swift: 'swift', kt: 'kotlin' };
const MAX_TEXT = 2 * 1024 * 1024, SHOWN = 200000;
const extension = file => file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
const isPdf = file => file.mime === 'application/pdf' || extension(file) === 'pdf';
export function previewKind(file) {
  if (isPdf(file)) return window.desktop || nativeMobile ? null : 'pdf';
  if ((file.mime.startsWith('text/') || Object.hasOwn(LANGUAGES, extension(file))) && file.size <= MAX_TEXT) return 'text';
  return null;
}
const fetchFile = async file => {
  const response = await fetch(mediaUrl(file.id, true), { credentials: mobileClient ? 'omit' : 'include', headers: mobileHeaders() });
  if (!response.ok) throw new Error('文件读取失败，请稍后再试');
  return response;
};

// PDF：先同步开一个空白标签页（避免被拦截），读完文件后换成本地地址，交给浏览器的 PDF 阅读器。
export async function openPdf(file, notify) {
  const tab = window.open('', '_blank');
  try {
    const blob = await (await fetchFile(file)).blob();
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (tab) tab.location.href = url;
    else {
      // 浏览器拦截了新标签页时改为下载，不离开当前页面。
      const link = document.createElement('a');
      link.href = url; link.download = file.name; link.click();
      notify?.('浏览器拦截了新窗口，已改为下载');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { tab?.close(); notify?.(error.message); }
}

export function TextPreviewDialog({ file, onClose }) {
  const [text, setText] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    fetchFile(file).then(response => response.arrayBuffer()).then(buffer => { if (alive) setText(new TextDecoder('utf-8').decode(buffer)); }).catch(failure => alive && setError(failure.message));
    return () => { alive = false; };
  }, [file.id]);
  const language = LANGUAGES[extension(file)] ?? '';
  const shown = text && text.length > SHOWN ? text.slice(0, SHOWN) : text;
  return <Modal title={file.name} subtitle={formatSize(file.size)} onClose={onClose}>
    <div className="file-preview">
      {error ? <p className="form-error" role="alert">{error}</p> : text === null ? <p className="inline-note"><LoaderCircle className="spin" size={14} />正在读取…</p>
        : language === 'markdown' ? <div className="file-preview-markdown"><FormattedText text={shown} /></div> : <CodeBlock language={language} text={shown} />}
      {text && text.length > SHOWN && <p className="inline-note">文件较长，只显示前 {SHOWN.toLocaleString()} 个字符，完整内容请下载。</p>}
    </div>
  </Modal>;
}

// 输入框里「/」弹出的格式菜单：选中后在光标处插入对应的 Markdown，并选中需要改写的占位文字。
// before/placeholder/after 拼成插入内容；block 表示这是整行格式，不在行首时先换行。
export const FORMATS = [
  { id: 'h1', label: '一级标题', sample: '#', keys: 'h1 heading title biaoti bt', before: '# ', placeholder: '标题', block: true },
  { id: 'h2', label: '二级标题', sample: '##', keys: 'h2 heading title biaoti bt', before: '## ', placeholder: '标题', block: true },
  { id: 'h3', label: '三级标题', sample: '###', keys: 'h3 heading title biaoti bt', before: '### ', placeholder: '标题', block: true },
  { id: 'bold', label: '粗体', sample: '**文字**', keys: 'bold jiacu cuti ct jc', before: '**', placeholder: '粗体', after: '**' },
  { id: 'italic', label: '斜体', sample: '*文字*', keys: 'italic xieti xt', before: '*', placeholder: '斜体', after: '*' },
  { id: 'strike', label: '删除线', sample: '~~文字~~', keys: 'strike strikethrough shanchuxian scx', before: '~~', placeholder: '删除线', after: '~~' },
  { id: 'spoiler', label: '剧透', sample: '||文字||', keys: 'spoiler jutou jt zhedang', before: '||', placeholder: '剧透内容', after: '||' },
  { id: 'code', label: '行内代码', sample: '`代码`', keys: 'code inline daima dm', before: '`', placeholder: '代码', after: '`' },
  { id: 'codeblock', label: '代码块', sample: '```', keys: 'code block codeblock daimakuai dmk', before: '```\n', placeholder: '', after: '\n```', block: true },
  { id: 'quote', label: '引用', sample: '>', keys: 'quote blockquote yinyong yy', before: '> ', placeholder: '引用内容', block: true },
  { id: 'list', label: '无序列表', sample: '-', keys: 'list bullet ul liebiao lb', before: '- ', placeholder: '列表项', block: true },
  { id: 'ordered', label: '有序列表', sample: '1.', keys: 'list ordered ol numbered liebiao lb', before: '1. ', placeholder: '列表项', block: true },
  { id: 'todo', label: '待办', sample: '- [ ]', keys: 'todo task check daiban db', before: '- [ ] ', placeholder: '待办事项', block: true },
  { id: 'table', label: '表格', sample: '| |', keys: 'table biaoge bg', before: '| ', placeholder: '列 1', after: ' | 列 2 |\n| --- | --- |\n|  |  |', block: true },
  { id: 'divider', label: '分隔线', sample: '---', keys: 'divider hr line fengexian fgx', before: '---\n', placeholder: '', block: true },
  { id: 'link', label: '链接', sample: '[文字](网址)', keys: 'link url lianjie lj', before: '[', placeholder: '文字', after: '](https://)' },
];

export const matchFormats = query => {
  const needle = query.toLowerCase();
  return FORMATS.filter(item => !needle || item.label.includes(query) || item.keys.split(' ').some(key => key.startsWith(needle)));
};

// 把「/关键词」替换成格式；返回新正文和需要选中的范围（占位文字）。
export function applyFormat(text, start, end, item, selected = '') {
  const lineStart = start === 0 || text[start - 1] === '\n';
  const prefix = item.block && !lineStart ? '\n' : '';
  const body = selected || item.placeholder;
  const insert = prefix + item.before + body + (item.after || '');
  const cursor = start + prefix.length + item.before.length;
  return { text: text.slice(0, start) + insert + text.slice(end), selection: [cursor, cursor + body.length] };
}

// 光标是否在还没闭合的 ``` 代码块里：这时回车换行，不发送。
export const insideCodeFence = (text, caret) => (text.slice(0, caret).match(/^[ \t]*```/gm) || []).length % 2 === 1;

export interface CommandDefinition {
  id: string;
  title: string;
  category: string;
  keywords?: string[];
  requiresDocument?: boolean;
}

export const APP_COMMANDS: CommandDefinition[] = [
  { id: 'file.new', title: '新建文件', category: '文件', keywords: ['new', 'draft'] },
  { id: 'file.open', title: '打开文件', category: '文件', keywords: ['open', 'markdown'] },
  { id: 'file.openFolder', title: '打开文件夹', category: '文件', keywords: ['workspace', 'folder'] },
  { id: 'file.save', title: '保存', category: '文件', keywords: ['save'], requiresDocument: true },
  { id: 'edit.find', title: '查找', category: '编辑', keywords: ['search', 'find'] },
  { id: 'edit.replace', title: '替换', category: '编辑', keywords: ['replace', 'search'], requiresDocument: true },
  { id: 'view.block', title: '块编辑模式', category: '视图', keywords: ['block', 'notion'] },
  { id: 'view.edit', title: 'MD 源码模式', category: '视图', keywords: ['edit', 'markdown', 'source'] },
  { id: 'view.preview', title: '预览模式', category: '视图', keywords: ['preview'] },
  { id: 'view.split', title: '双栏模式', category: '视图', keywords: ['split'] },
  { id: 'view.toggleSidebar', title: '切换侧边栏', category: '视图', keywords: ['sidebar'] },
  { id: 'view.toggleOutline', title: '切换大纲', category: '视图', keywords: ['outline'] },
  { id: 'insert.image', title: '插入图片', category: '插入', keywords: ['image', 'asset'], requiresDocument: true },
  { id: 'insert.link', title: '插入链接', category: '插入', keywords: ['link'], requiresDocument: true },
  { id: 'insert.table', title: '插入表格', category: '插入', keywords: ['table'], requiresDocument: true },
  { id: 'insert.code', title: '插入代码块', category: '插入', keywords: ['code'], requiresDocument: true },
  { id: 'insert.hr', title: '插入分割线', category: '插入', keywords: ['divider'], requiresDocument: true },
  { id: 'insert.task', title: '插入任务列表', category: '插入', keywords: ['task', 'todo'], requiresDocument: true },
  { id: 'insert.date', title: '插入日期', category: '插入', keywords: ['date'], requiresDocument: true },
  { id: 'export.pdf', title: '导出 PDF', category: '导出', keywords: ['pdf'], requiresDocument: true },
  { id: 'export.html', title: '导出 HTML', category: '导出', keywords: ['html'], requiresDocument: true },
  { id: 'settings.general', title: '打开通用设置', category: '设置', keywords: ['settings'] },
  { id: 'settings.preview', title: '打开预览设置', category: '设置', keywords: ['code theme', 'preview'] },
  { id: 'settings.shortcuts', title: '打开快捷键设置', category: '设置', keywords: ['shortcut', 'keymap'] },
  { id: 'settings.export', title: '打开导出设置', category: '设置', keywords: ['export'] },
  { id: 'app.checkUpdate', title: '检查更新', category: '系统', keywords: ['update'] },
  { id: 'app.about', title: '关于 Orcha Writer', category: '系统', keywords: ['about'] },
];

export function filterCommands(commands: CommandDefinition[], query: string): CommandDefinition[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return commands;
  return commands.filter(command => {
    const haystack = [
      command.id,
      command.title,
      command.category,
      ...(command.keywords ?? []),
    ].join(' ').toLowerCase();
    return haystack.includes(keyword);
  });
}

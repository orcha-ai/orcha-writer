import type { SlashCommand } from '../types/block';
import { translateText } from '../../../i18n';

const SLASH_COMMAND_SOURCES: SlashCommand[] = [
  {
    id: 'paragraph',
    label: '段落',
    description: '开始普通正文',
    shortcutLabel: '文本',
    keywords: ['paragraph', 'text', 'p', '正文', '段落', '文本'],
    type: 'paragraph',
  },
  {
    id: 'heading_1',
    label: '一级标题',
    description: '用于章节主标题',
    shortcutLabel: 'H1',
    keywords: ['h1', 'heading', 'title', '标题', '一级'],
    type: 'heading_1',
  },
  {
    id: 'heading_2',
    label: '二级标题',
    description: '用于章节小标题',
    shortcutLabel: 'H2',
    keywords: ['h2', 'heading', 'subtitle', '标题', '二级'],
    type: 'heading_2',
  },
  {
    id: 'heading_3',
    label: '三级标题',
    description: '用于段落分组标题',
    shortcutLabel: 'H3',
    keywords: ['h3', 'heading', '标题', '三级'],
    type: 'heading_3',
  },
  {
    id: 'bulleted_list_item',
    label: '无序列表',
    description: '创建一个项目符号',
    shortcutLabel: '-',
    keywords: ['list', 'bullet', 'ul', '列表', '无序'],
    type: 'bulleted_list_item',
  },
  {
    id: 'ordered_list_item',
    label: '有序列表',
    description: '创建一个编号列表项',
    shortcutLabel: '1.',
    keywords: ['list', 'ordered', 'ol', '列表', '有序'],
    type: 'ordered_list_item',
  },
  {
    id: 'todo_item',
    label: '待办事项',
    description: '创建一个任务列表项',
    shortcutLabel: '[ ]',
    keywords: ['todo', 'task', 'check', '待办', '任务'],
    type: 'todo_item',
  },
  {
    id: 'blockquote',
    label: '引用块',
    description: '突出一段引用内容',
    shortcutLabel: '>',
    keywords: ['quote', 'blockquote', '引用'],
    type: 'blockquote',
  },
  {
    id: 'callout',
    label: 'Callout',
    description: '创建提示信息块',
    shortcutLabel: 'NOTE',
    keywords: ['callout', 'note', 'tip', '提示', '注意'],
    type: 'callout',
  },
  {
    id: 'code_block',
    label: '代码块',
    description: '插入 fenced code block',
    shortcutLabel: '{}',
    keywords: ['code', 'shell', 'python', 'java', '代码'],
    type: 'code_block',
  },
  {
    id: 'math_block',
    label: '数学公式',
    description: '插入 $$ 公式块',
    shortcutLabel: '$$',
    keywords: ['math', 'latex', 'formula', '公式', '数学'],
    type: 'math_block',
  },
  {
    id: 'html_block',
    label: 'HTML 块',
    description: '保留原始 HTML 结构',
    shortcutLabel: '<>',
    keywords: ['html', 'div', 'embed', '网页'],
    type: 'html_block',
  },
  {
    id: 'table',
    label: 'Markdown 表格',
    description: '插入基础 Markdown 表格',
    shortcutLabel: '表',
    keywords: ['table', '表格'],
    type: 'table',
  },
  {
    id: 'image',
    label: '图片',
    description: '插入图片 Markdown',
    shortcutLabel: '图',
    keywords: ['image', 'picture', '图片', '图'],
    type: 'image',
  },
  {
    id: 'ai',
    label: 'AI 生成块',
    description: '让 AI 基于当前上下文生成下一个块',
    shortcutLabel: 'AI',
    keywords: ['ai', 'generate', '生成', '智能体'],
    type: 'ai',
  },
];

export function getSlashCommands(language: unknown): SlashCommand[] {
  return SLASH_COMMAND_SOURCES.map(command => ({
    ...command,
    label: translateText(language, command.label),
    description: translateText(language, command.description),
  }));
}

export const SLASH_COMMANDS: SlashCommand[] = getSlashCommands('zh-CN');

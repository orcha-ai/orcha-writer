export type BlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'bulleted_list_item'
  | 'ordered_list_item'
  | 'todo_item'
  | 'blockquote'
  | 'callout'
  | 'code_block'
  | 'frontmatter'
  | 'html_block'
  | 'math_block'
  | 'table'
  | 'image'
  | 'horizontal_rule'
  | 'empty';

export interface BlockSourceRange {
  startLine: number;
  endLine: number;
  startOffset?: number;
  endOffset?: number;
}

export interface BlockViewModel {
  id: string;
  type: BlockType;
  content: string;
  markdown: string;
  sourceRange?: BlockSourceRange;
  attrs?: Record<string, unknown>;
  children?: BlockViewModel[];
  selected?: boolean;
  focused?: boolean;
  collapsed?: boolean;
}

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  shortcutLabel: string;
  keywords: string[];
  type: BlockType | 'ai';
}

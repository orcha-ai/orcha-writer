import { GFM, parser as lezerMarkdownParser } from '@lezer/markdown';
import type { BlockType, BlockViewModel } from '../types/block';

const markdownAstParser = lezerMarkdownParser.configure([GFM]);

interface MarkdownAstBlockRange {
  type: string;
  startLine: number;
  endLine: number;
  from: number;
  to: number;
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function lineOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  lines.forEach((line) => {
    offsets.push(offset);
    offset += line.length + 1;
  });
  return offsets;
}

function lineFromOffset(offsets: number[], offset: number): number {
  let low = 0;
  let high = offsets.length - 1;
  let result = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= offset) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return Math.max(0, Math.min(result, offsets.length - 1));
}

function collectAstBlockRanges(markdown: string, offsets: number[]): Map<number, MarkdownAstBlockRange[]> {
  const ranges = new Map<number, MarkdownAstBlockRange[]>();
  const tree = markdownAstParser.parse(markdown);
  const cursor = tree.cursor();

  const addRange = (type: string, from: number, to: number) => {
    if (to <= from) return;
    const startLine = lineFromOffset(offsets, from);
    const endLine = lineFromOffset(offsets, to - 1);
    const range: MarkdownAstBlockRange = { type, startLine, endLine, from, to };
    ranges.set(startLine, [...(ranges.get(startLine) || []), range]);
  };

  if (!cursor.firstChild()) return ranges;

  do {
    const topType = cursor.name;
    if ((topType === 'BulletList' || topType === 'OrderedList') && cursor.firstChild()) {
      do {
        if (cursor.name === 'ListItem') addRange(topType, cursor.from, cursor.to);
      } while (cursor.nextSibling());
      cursor.parent();
    } else {
      addRange(topType, cursor.from, cursor.to);
    }
  } while (cursor.nextSibling());

  return ranges;
}

function rawBlock(lines: string[], start: number, end: number): string {
  return lines.slice(start, end + 1).join('\n');
}

function createParsedBlock(
  blocks: BlockViewModel[],
  type: BlockType,
  content: string,
  markdown: string,
  startLine: number,
  endLine: number,
  offsets: number[],
  lines: string[],
  attrs?: Record<string, unknown>,
): BlockViewModel {
  const index = blocks.length;
  const startOffset = offsets[startLine];
  const endOffset = offsets[endLine] + lines[endLine].length;

  return {
    id: `block_${index}_${hashText(`${startLine}:${markdown}`)}`,
    type,
    content,
    markdown,
    sourceRange: {
      startLine: startLine + 1,
      endLine: endLine + 1,
      startOffset,
      endOffset,
    },
    attrs,
  };
}

function isFenceStart(line: string): RegExpMatchArray | null {
  return line.match(/^\s*(`{3,}|~{3,})\s*([^`]*)$/);
}

function isFenceEnd(line: string, marker: string): boolean {
  const fenceChar = marker[0];
  const minLength = marker.length;
  const pattern = new RegExp(`^\\s*\\${fenceChar}{${minLength},}\\s*$`);
  return pattern.test(line);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean(lines[index]?.includes('|') && lines[index + 1] && isTableSeparator(lines[index + 1]));
}

function isHorizontalRule(line: string): boolean {
  return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

function isMathFence(line: string): boolean {
  return /^\s*\$\$\s*$/.test(line);
}

const HTML_BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'canvas',
  'details',
  'dialog',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'iframe',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'script',
  'section',
  'style',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'video',
]);

function htmlTagName(line: string): string | null {
  if (/^\s*<!--/.test(line)) return 'comment';
  const tag = line.match(/^\s*<\/?([a-z][a-z0-9-]*)\b/i)?.[1]?.toLowerCase();
  return tag && HTML_BLOCK_TAGS.has(tag) ? tag : null;
}

function isHtmlBlockStart(line: string): boolean {
  return htmlTagName(line) != null;
}

function findHtmlBlockEnd(lines: string[], start: number): number {
  const first = lines[start] || '';
  const tag = htmlTagName(first);
  if (!tag) return start;

  if (tag === 'comment') {
    let index = start;
    while (index < lines.length && !lines[index].includes('-->')) index += 1;
    return Math.min(index, lines.length - 1);
  }

  if (/\/>\s*$/.test(first) || new RegExp(`</${tag}>\\s*$`, 'i').test(first)) return start;

  let index = start + 1;
  const closing = new RegExp(`</${tag}>`, 'i');
  while (index < lines.length) {
    if (closing.test(lines[index])) return index;
    if (!lines[index].trim()) return index - 1;
    index += 1;
  }
  return lines.length - 1;
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] || '';
  if (!line.trim()) return true;
  return Boolean(
    isFenceStart(line)
    || isMathFence(line)
    || isHtmlBlockStart(line)
    || isTableStart(lines, index)
    || isHorizontalRule(line)
    || /^(#{1,6})\s+/.test(line)
    || /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^>\s?/.test(line)
    || /^!\[[^\]]*]\(.*?\)\s*$/.test(line)
  );
}

function stripQuoteMarker(line: string): string {
  return line.replace(/^>\s?/, '');
}

function stripContinuationIndent(line: string, continuationIndent: number): string {
  let index = 0;
  while (index < line.length && index < continuationIndent && line[index] === ' ') index += 1;
  return line.slice(index);
}

function collectListContinuation(lines: string[], start: number, firstContent: string, baseIndent: string) {
  const continuationIndent = baseIndent.length + 2;
  const contentLines = [firstContent];
  let index = start + 1;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) break;
    if (!/^\s{2,}\S/.test(line)) break;
    if (
      isFenceStart(line)
      || isMathFence(line)
      || isHtmlBlockStart(line)
      || isTableStart(lines, index)
      || isHorizontalRule(line)
      || /^(#{1,6})\s+/.test(line)
      || /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)
      || /^\s*[-*+]\s+/.test(line)
      || /^\s*\d+[.)]\s+/.test(line)
      || /^>\s?/.test(line)
    ) {
      break;
    }
    contentLines.push(stripContinuationIndent(line, continuationIndent));
    index += 1;
  }

  return {
    content: contentLines.join('\n'),
    end: index - 1,
  };
}

function collectListAstRange(lines: string[], start: number, end: number, firstContent: string, baseIndent: string) {
  const continuationIndent = baseIndent.length + 2;
  const contentLines = [firstContent];

  for (let index = start + 1; index <= end; index += 1) {
    const line = lines[index] || '';
    contentLines.push(stripContinuationIndent(line, continuationIndent));
  }

  return {
    content: contentLines.join('\n').replace(/\n+$/, ''),
    end,
  };
}

function collectListItem(lines: string[], start: number, firstContent: string, baseIndent: string, astBlock?: MarkdownAstBlockRange) {
  if (astBlock && (astBlock.type === 'BulletList' || astBlock.type === 'OrderedList')) {
    return collectListAstRange(lines, start, astBlock.endLine, firstContent, baseIndent);
  }
  return collectListContinuation(lines, start, firstContent, baseIndent);
}

function stripSetextMarker(raw: string): string {
  const lines = raw.split('\n');
  if (lines.length <= 1) return raw.trim();
  return lines.slice(0, -1).join('\n').trim();
}

function stripIndentedCode(raw: string): string {
  return raw.split('\n').map(line => line.replace(/^( {4}|\t)/, '')).join('\n');
}

function normalizeImageDestination(destination: string): string {
  const trimmed = destination.trim();
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>');
    return end > 0 ? trimmed.slice(1, end) : trimmed;
  }
  const withOptionalTitle = trimmed.match(/^(\S+)(?:\s+["'(].*)?$/);
  return withOptionalTitle?.[1] || trimmed;
}

function formatImageDestination(destination: string): string {
  const normalized = destination.replace(/\\/g, '/');
  return /[\s()<>]/.test(normalized) ? `<${normalized.replace(/>/g, '%3E')}>` : normalized;
}

export function blockTypeLabel(type: BlockType): string {
  const labels: Record<BlockType, string> = {
    paragraph: '段落',
    heading_1: '一级标题',
    heading_2: '二级标题',
    heading_3: '三级标题',
    bulleted_list_item: '无序列表',
    ordered_list_item: '有序列表',
    todo_item: '待办事项',
    blockquote: '引用块',
    callout: 'Callout',
    code_block: '代码块',
    frontmatter: 'Frontmatter',
    html_block: 'HTML 块',
    math_block: '数学公式',
    table: '表格',
    image: '图片',
    horizontal_rule: '分割线',
    empty: '空块',
  };
  return labels[type];
}

export function defaultContentForType(type: BlockType): string {
  switch (type) {
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return '标题';
    case 'bulleted_list_item':
      return '列表项';
    case 'ordered_list_item':
      return '列表项';
    case 'todo_item':
      return '任务';
    case 'blockquote':
      return '引用内容';
    case 'callout':
      return '提示内容';
    case 'code_block':
      return '# 在这里输入代码';
    case 'frontmatter':
      return 'title: Untitled';
    case 'html_block':
      return '<div>\n  内容\n</div>';
    case 'math_block':
      return 'E = mc^2';
    case 'table':
      return '| 列 A | 列 B |\n| --- | --- |\n| 内容 | 内容 |';
    case 'image':
      return '图片描述';
    case 'horizontal_rule':
    case 'empty':
      return '';
    case 'paragraph':
    default:
      return '';
  }
}

export function createBlock(type: BlockType = 'paragraph', content = defaultContentForType(type)): BlockViewModel {
  const block: BlockViewModel = {
    id: `block_new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    content,
    markdown: '',
    attrs: type === 'todo_item'
      ? { checked: false }
      : type === 'code_block'
        ? { language: 'shell' }
        : type === 'callout'
          ? { calloutType: 'NOTE' }
          : type === 'image'
            ? { alt: content || '图片描述', src: 'path/to/image.png' }
            : undefined,
  };
  return { ...block, markdown: blockToMarkdown(block) };
}

export function plainTextFromBlock(block: BlockViewModel): string {
  if (block.type === 'callout') return block.content;
  if (block.type === 'image') return String(block.attrs?.alt || block.content || '');
  if (block.type === 'horizontal_rule') return '';
  return block.content || block.markdown;
}

function singleLine(value: string, fallback: string): string {
  const normalized = value.replace(/\s*\n\s*/g, ' ').trim();
  return normalized || fallback;
}

function prefixLines(prefix: string, content: string, fallback: string): string {
  const value = content.trimEnd() || fallback;
  return value.split('\n').map(line => `${prefix}${line}`).join('\n');
}

function headingMarkdown(block: BlockViewModel, fallbackLevel: number): string {
  const level = typeof block.attrs?.level === 'number'
    ? Math.max(1, Math.min(6, block.attrs.level))
    : fallbackLevel;
  return `${'#'.repeat(level)} ${singleLine(block.content || '', '标题')}`;
}

function serializeListItem(prefix: string, content: string, fallback: string, continuationIndent: string): string {
  const lines = (content.trimEnd() || fallback).split('\n');
  const [first, ...rest] = lines;
  return [
    `${prefix}${first || fallback}`,
    ...rest.map(line => `${continuationIndent}${line}`),
  ].join('\n');
}

export function blockToMarkdown(block: BlockViewModel): string {
  const content = block.content ?? '';
  const indent = typeof block.attrs?.indent === 'string' ? block.attrs.indent : '';

  switch (block.type) {
    case 'heading_1':
      return headingMarkdown(block, 1);
    case 'heading_2':
      return headingMarkdown(block, 2);
    case 'heading_3':
      return headingMarkdown(block, 3);
    case 'bulleted_list_item':
      return serializeListItem(`${indent}${String(block.attrs?.marker || '-')} `, content, '列表项', `${indent}  `);
    case 'ordered_list_item': {
      const start = typeof block.attrs?.start === 'number' ? block.attrs.start : 1;
      const delimiter = String(block.attrs?.delimiter || '.');
      return serializeListItem(`${indent}${start}${delimiter} `, content, '列表项', `${indent}${' '.repeat(String(start).length + 2)}`);
    }
    case 'todo_item': {
      const checked = Boolean(block.attrs?.checked);
      const marker = String(block.attrs?.marker || '-');
      return serializeListItem(`${indent}${marker} [${checked ? 'x' : ' '}] `, content, '任务', `${indent}  `);
    }
    case 'blockquote':
      return prefixLines('> ', content, '引用内容');
    case 'callout': {
      const calloutType = String(block.attrs?.calloutType || 'NOTE').toUpperCase();
      const body = content.trimEnd()
        ? `\n${content.split('\n').map(line => `> ${line}`).join('\n')}`
        : '';
      return `> [!${calloutType}]${body}`;
    }
    case 'code_block': {
      const language = String(block.attrs?.language || '').trim();
      return `\`\`\`${language}\n${content.replace(/\n?$/, '')}\n\`\`\``;
    }
    case 'frontmatter':
      return `---\n${content.replace(/\n?$/, '')}\n---`;
    case 'html_block':
      return content.trimEnd() || defaultContentForType('html_block');
    case 'math_block':
      return `$$\n${content.replace(/\n?$/, '')}\n$$`;
    case 'table':
      return content.trim() || defaultContentForType('table');
    case 'image': {
      const alt = String(block.attrs?.alt || content || '图片描述');
      const src = String(block.attrs?.src || 'path/to/image.png');
      return `![${alt}](${formatImageDestination(src)})`;
    }
    case 'horizontal_rule':
      return '---';
    case 'empty':
      return content;
    case 'paragraph':
    default:
      return content;
  }
}

export function updateBlockContent(block: BlockViewModel, content: string): BlockViewModel {
  const nextAttrs = block.type === 'image'
    ? { ...block.attrs, alt: content || '图片描述' }
    : block.attrs;
  const nextBlock = { ...block, content, attrs: nextAttrs };
  return { ...nextBlock, markdown: blockToMarkdown(nextBlock) };
}

export function updateBlockAttrs(block: BlockViewModel, attrs: Record<string, unknown>): BlockViewModel {
  const nextBlock = { ...block, attrs: { ...block.attrs, ...attrs } };
  return { ...nextBlock, markdown: blockToMarkdown(nextBlock) };
}

export function convertBlock(block: BlockViewModel, type: BlockType): BlockViewModel {
  const content = plainTextFromBlock(block);
  const nextBlock: BlockViewModel = {
    ...block,
    type,
    content: content || defaultContentForType(type),
    attrs: type === 'todo_item'
      ? { checked: false }
      : type === 'code_block'
        ? { language: 'markdown' }
        : type === 'callout'
          ? { calloutType: 'NOTE' }
          : type === 'image'
            ? { alt: content || '图片描述', src: String(block.attrs?.src || 'path/to/image.png') }
            : undefined,
  };
  return { ...nextBlock, markdown: blockToMarkdown(nextBlock) };
}

export function parseMarkdownToBlocks(markdown: string): BlockViewModel[] {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const offsets = lineOffsets(lines);
  const astBlocksByLine = collectAstBlockRanges(normalized, offsets);
  const blocks: BlockViewModel[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const astBlock = astBlocksByLine.get(index)?.[0];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (index === 0 && line.trim() === '---') {
      let end = index + 1;
      while (end < lines.length && lines[end].trim() !== '---') end += 1;
      if (end < lines.length) {
        const raw = rawBlock(lines, index, end);
        const content = lines.slice(index + 1, end).join('\n');
        blocks.push(createParsedBlock(blocks, 'frontmatter', content, raw, index, end, offsets, lines));
        index = end + 1;
        continue;
      }
    }

    if (astBlock?.type === 'SetextHeading1' || astBlock?.type === 'SetextHeading2') {
      const raw = rawBlock(lines, astBlock.startLine, astBlock.endLine);
      const level = astBlock.type === 'SetextHeading1' ? 1 : 2;
      blocks.push(createParsedBlock(
        blocks,
        `heading_${level}` as BlockType,
        stripSetextMarker(raw),
        raw,
        astBlock.startLine,
        astBlock.endLine,
        offsets,
        lines,
        { level, setext: true },
      ));
      index = astBlock.endLine + 1;
      continue;
    }

    const fence = isFenceStart(line);
    if (fence) {
      const marker = fence[1];
      const info = (fence[2] || '').trim();
      const language = info.split(/\s+/)[0] || '';
      const start = index;
      index += 1;
      while (index < lines.length && !isFenceEnd(lines[index], marker)) index += 1;
      const end = Math.min(index, lines.length - 1);
      const contentEnd = isFenceEnd(lines[end], marker) ? end : end + 1;
      const content = lines.slice(start + 1, contentEnd).join('\n');
      const raw = rawBlock(lines, start, end);
      blocks.push(createParsedBlock(blocks, 'code_block', content, raw, start, end, offsets, lines, { language, info }));
      index = end + 1;
      continue;
    }

    if (astBlock?.type === 'CodeBlock') {
      const raw = rawBlock(lines, astBlock.startLine, astBlock.endLine);
      blocks.push(createParsedBlock(
        blocks,
        'code_block',
        stripIndentedCode(raw),
        raw,
        astBlock.startLine,
        astBlock.endLine,
        offsets,
        lines,
        { language: '', indented: true },
      ));
      index = astBlock.endLine + 1;
      continue;
    }

    if (isMathFence(line)) {
      const start = index;
      index += 1;
      while (index < lines.length && !isMathFence(lines[index])) index += 1;
      const end = Math.min(index, lines.length - 1);
      const contentEnd = isMathFence(lines[end]) ? end : end + 1;
      const content = lines.slice(start + 1, contentEnd).join('\n');
      const raw = rawBlock(lines, start, end);
      blocks.push(createParsedBlock(blocks, 'math_block', content, raw, start, end, offsets, lines));
      index = end + 1;
      continue;
    }

    if (astBlock?.type === 'Table' || isTableStart(lines, index)) {
      const start = astBlock?.type === 'Table' ? astBlock.startLine : index;
      let end = astBlock?.type === 'Table' ? astBlock.endLine : index + 1;
      if (astBlock?.type !== 'Table') {
        let nextIndex = index + 2;
        while (nextIndex < lines.length && lines[nextIndex].includes('|') && lines[nextIndex].trim()) nextIndex += 1;
        end = nextIndex - 1;
      }
      const raw = rawBlock(lines, start, end);
      blocks.push(createParsedBlock(blocks, 'table', raw, raw, start, end, offsets, lines));
      index = end + 1;
      continue;
    }

    if (astBlock?.type === 'HTMLBlock' || isHtmlBlockStart(line)) {
      const start = astBlock?.type === 'HTMLBlock' ? astBlock.startLine : index;
      const end = astBlock?.type === 'HTMLBlock' ? astBlock.endLine : findHtmlBlockEnd(lines, start);
      const raw = rawBlock(lines, start, end);
      blocks.push(createParsedBlock(blocks, 'html_block', raw, raw, start, end, offsets, lines));
      index = end + 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push(createParsedBlock(blocks, 'horizontal_rule', '', line, index, index, offsets, lines));
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const type = `heading_${Math.min(level, 3)}` as BlockType;
      blocks.push(createParsedBlock(blocks, type, heading[2], line, index, index, offsets, lines, { level }));
      index += 1;
      continue;
    }

    const todo = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/);
    if (todo) {
      const collected = collectListItem(lines, index, todo[4], todo[1], astBlock);
      const raw = rawBlock(lines, index, collected.end);
      blocks.push(createParsedBlock(blocks, 'todo_item', collected.content, raw, index, collected.end, offsets, lines, {
        checked: todo[3].toLowerCase() === 'x',
        indent: todo[1],
        marker: todo[2],
      }));
      index = collected.end + 1;
      continue;
    }

    const bullet = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (bullet) {
      const collected = collectListItem(lines, index, bullet[3], bullet[1], astBlock);
      const raw = rawBlock(lines, index, collected.end);
      blocks.push(createParsedBlock(blocks, 'bulleted_list_item', collected.content, raw, index, collected.end, offsets, lines, {
        indent: bullet[1],
        marker: bullet[2],
      }));
      index = collected.end + 1;
      continue;
    }

    const ordered = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/);
    if (ordered) {
      const collected = collectListItem(lines, index, ordered[4], ordered[1], astBlock);
      const raw = rawBlock(lines, index, collected.end);
      blocks.push(createParsedBlock(blocks, 'ordered_list_item', collected.content, raw, index, collected.end, offsets, lines, {
        indent: ordered[1],
        start: Number(ordered[2]),
        delimiter: ordered[3],
      }));
      index = collected.end + 1;
      continue;
    }

    if (astBlock?.type === 'Blockquote' || /^>\s?/.test(line)) {
      const start = astBlock?.type === 'Blockquote' ? astBlock.startLine : index;
      let end = astBlock?.type === 'Blockquote' ? astBlock.endLine : index;
      if (astBlock?.type !== 'Blockquote') {
        let nextIndex = index;
        while (nextIndex < lines.length && /^>\s?/.test(lines[nextIndex])) nextIndex += 1;
        end = nextIndex - 1;
      }
      const raw = rawBlock(lines, start, end);
      const quoteLines = lines.slice(start, end + 1).map(stripQuoteMarker);
      const callout = quoteLines[0]?.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*(.*)$/i);

      if (callout) {
        const firstBody = callout[2]?.trim();
        const bodyLines = [firstBody, ...quoteLines.slice(1)].filter((item): item is string => item != null);
        blocks.push(createParsedBlock(blocks, 'callout', bodyLines.join('\n').trim(), raw, start, end, offsets, lines, {
          calloutType: callout[1].toUpperCase(),
        }));
      } else {
        blocks.push(createParsedBlock(blocks, 'blockquote', quoteLines.join('\n'), raw, start, end, offsets, lines));
      }
      index = end + 1;
      continue;
    }

    const image = line.match(/^!\[([^\]]*)]\((.*?)\)\s*$/);
    if (image) {
      const src = normalizeImageDestination(image[2]);
      blocks.push(createParsedBlock(blocks, 'image', image[1], line, index, index, offsets, lines, {
        alt: image[1],
        src,
      }));
      index += 1;
      continue;
    }

    const start = index;
    index += 1;
    while (index < lines.length && !isBlockStart(lines, index)) index += 1;
    const end = index - 1;
    const raw = rawBlock(lines, start, end);
    blocks.push(createParsedBlock(blocks, 'paragraph', raw, raw, start, end, offsets, lines));
  }

  return blocks.length > 0 ? blocks : [createBlock('empty')];
}

export function serializeBlocks(blocks: BlockViewModel[]): string {
  const listTypes = new Set<BlockType>(['bulleted_list_item', 'ordered_list_item', 'todo_item']);
  return blocks
    .map(block => blockToMarkdown(block).replace(/[ \t]+$/gm, ''))
    .reduce((output, markdown, index) => {
      if (index === 0) return markdown;
      const previous = blocks[index - 1];
      const current = blocks[index];
      const separator = listTypes.has(previous.type) && listTypes.has(current.type) ? '\n' : '\n\n';
      return `${output}${separator}${markdown}`;
    }, '')
    .replace(/\n{5,}/g, '\n\n\n\n');
}

export function countBlockCharacters(blocks: BlockViewModel[]): number {
  return Array.from(serializeBlocks(blocks).replace(/\s/g, '')).length;
}

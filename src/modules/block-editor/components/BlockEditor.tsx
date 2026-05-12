import {
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Plus,
  Quote,
  Send,
  Sparkles,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { message } from 'antd';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useApp } from '../../../AppContext';
import { resolveMarkdownImageSource } from '../../../utils/markdownImages';
import { SLASH_COMMANDS } from '../constants/slashCommands';
import {
  blockToMarkdown,
  blockTypeLabel,
  convertBlock,
  createBlock,
  parseMarkdownToBlocks,
  parseMarkdownTable,
  plainTextFromBlock,
  serializeBlocks,
  serializeMarkdownTable,
  updateBlockAttrs,
  updateBlockContent,
} from '../services/markdownBlocks';
import type { MarkdownTableModel } from '../services/markdownBlocks';
import type { BlockType, BlockViewModel, SlashCommand } from '../types/block';
import './styles.css';

interface SlashState {
  blockIndex: number;
  query: string;
  activeIndex: number;
  insertAfter: boolean;
}

type DropPosition = 'before' | 'after';

interface DragTargetState {
  index: number;
  position: DropPosition;
}

interface PointerDragState {
  index: number;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
}

interface BlockContextMenuState {
  x: number;
  y: number;
  blockIndex: number;
}

interface BlockAIPopoverState {
  x: number;
  y: number;
  blockIndex: number;
}

interface BlockAISelectionPayload {
  targetBlocks: BlockViewModel[];
  selection: {
    text: string;
    range: {
      from: number;
      to: number;
    };
  };
}

type BlockAIAction = 'polish' | 'expand' | 'shorten' | 'convert_to_list' | 'generate_next_block';

const CONVERT_OPTIONS: Array<{ type: BlockType; label: string }> = [
  { type: 'paragraph', label: '段落' },
  { type: 'heading_1', label: 'H1' },
  { type: 'heading_2', label: 'H2' },
  { type: 'heading_3', label: 'H3' },
  { type: 'bulleted_list_item', label: '列表' },
  { type: 'ordered_list_item', label: '编号' },
  { type: 'todo_item', label: '待办' },
  { type: 'blockquote', label: '引用' },
  { type: 'callout', label: 'Callout' },
  { type: 'code_block', label: '代码' },
  { type: 'math_block', label: '公式' },
  { type: 'html_block', label: 'HTML' },
  { type: 'table', label: '表格' },
];

const BLOCK_AI_COMMAND_IDS: Record<BlockAIAction, string> = {
  polish: 'block_polish',
  expand: 'block_expand',
  shorten: 'block_shorten',
  convert_to_list: 'block_convert_to_list',
  generate_next_block: 'block_generate_next',
};

const BLOCK_AI_PROMPTS: Record<BlockAIAction, string> = {
  polish: '润色当前块',
  expand: '扩写当前块',
  shorten: '缩短当前块',
  convert_to_list: '当前块转为列表',
  generate_next_block: '生成下一个块',
};

const BLOCK_AI_OPTIONS: Array<{ action: BlockAIAction; label: string }> = [
  { action: 'polish', label: '润色' },
  { action: 'expand', label: '扩写' },
  { action: 'shorten', label: '缩短' },
  { action: 'convert_to_list', label: '转列表' },
  { action: 'generate_next_block', label: '续写' },
];

const BLOCK_AI_POPOVER_WIDTH = 360;
const BLOCK_AI_POPOVER_HEIGHT = 292;

function blockIcon(type: BlockType) {
  switch (type) {
    case 'heading_1':
      return <Heading1 size={15} />;
    case 'heading_2':
      return <Heading2 size={15} />;
    case 'heading_3':
      return <Heading3 size={15} />;
    case 'bulleted_list_item':
      return <List size={15} />;
    case 'ordered_list_item':
      return <ListOrdered size={15} />;
    case 'todo_item':
      return <CheckSquare size={15} />;
    case 'blockquote':
    case 'callout':
      return <Quote size={15} />;
    case 'code_block':
    case 'frontmatter':
    case 'html_block':
    case 'math_block':
      return <Code2 size={15} />;
    case 'table':
      return <Table2 size={15} />;
    case 'image':
      return <ImageIcon size={15} />;
    case 'horizontal_rule':
      return <Minus size={15} />;
    case 'paragraph':
    case 'empty':
    default:
      return <Pilcrow size={15} />;
  }
}

function commandIcon(command: SlashCommand) {
  if (command.type === 'ai') return <Sparkles size={15} />;
  return blockIcon(command.type);
}

function isPrimaryShortcut(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return navigator.platform.toUpperCase().includes('MAC') ? event.metaKey : event.ctrlKey;
}

function clampIndex(index: number | null, length: number): number | null {
  if (index == null || length === 0) return null;
  return Math.max(0, Math.min(index, length - 1));
}

function moveItemToPosition<T>(items: T[], from: number, target: number, position: DropPosition): { items: T[]; index: number } {
  if (from < 0 || from >= items.length || target < 0 || target >= items.length) return { items, index: from };
  const next = [...items];
  const [item] = next.splice(from, 1);
  let insertionIndex = position === 'after' ? target + 1 : target;
  if (from < insertionIndex) insertionIndex -= 1;
  insertionIndex = Math.max(0, Math.min(insertionIndex, next.length));
  next.splice(insertionIndex, 0, item);
  return { items: next, index: insertionIndex };
}

function normalizeIndices(indices: number[], length: number): number[] {
  return Array.from(new Set(indices))
    .filter(index => index >= 0 && index < length)
    .sort((a, b) => a - b);
}

function rangeIndices(from: number, to: number): number[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function isContiguousIndices(indices: number[]): boolean {
  return indices.every((index, position) => position === 0 || index === indices[position - 1] + 1);
}

function cloneBlock(block: BlockViewModel, suffix: string | number): BlockViewModel {
  return {
    ...block,
    id: `block_dup_${Date.now()}_${suffix}`,
    markdown: blockToMarkdown(block),
    sourceRange: undefined,
  };
}

function inferMarkdownBlockFromText(block: BlockViewModel, value: string): BlockViewModel | null {
  if (block.type !== 'paragraph' && block.type !== 'empty') return null;
  if (!value.includes('\n') || !value.includes('|')) return null;

  const parsedBlocks = parseMarkdownToBlocks(value);
  if (parsedBlocks.length !== 1 || parsedBlocks[0]?.type !== 'table') return null;

  return {
    ...parsedBlocks[0],
    id: block.id,
    sourceRange: undefined,
  };
}

function tableMarkdownFromBlock(block: BlockViewModel): string {
  return block.content || block.markdown || blockToMarkdown(block);
}

function cloneTableModel(table: MarkdownTableModel): MarkdownTableModel {
  return {
    headers: [...table.headers],
    alignments: [...table.alignments],
    rows: table.rows.map(row => [...row]),
  };
}

function escapeSearchQuery(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderSearchHighlight(value: string, query: string): ReactNode {
  const text = value || '\u200b';
  const search = query.trim();
  if (!search) return text;

  const regex = new RegExp(escapeSearchQuery(search), 'gi');
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <mark key={`${match.index}-${match[0]}`} className="block-search-hit">
        {match[0]}
      </mark>,
    );
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) regex.lastIndex += 1;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : text;
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('textarea, input, select, [contenteditable="true"]'));
}

function isBlockEditorContentTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('.block-row, .block-ai-popover, .block-context-menu, .slash-command-menu'));
}

function textareaClassName(block: BlockViewModel): string {
  return [
    'block-textarea',
    `block-textarea-${block.type}`,
    ['code_block', 'frontmatter', 'html_block', 'math_block', 'table'].includes(block.type) ? 'is-mono' : '',
  ].filter(Boolean).join(' ');
}

function resizeTextarea(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;
  textarea.style.height = '0px';
  textarea.style.height = `${Math.max(30, textarea.scrollHeight)}px`;
}

function resizeAIPromptTextarea(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;
  textarea.style.height = '0px';
  textarea.style.height = `${Math.min(180, Math.max(76, textarea.scrollHeight))}px`;
}

function countMarkdownCharacters(markdown: string): number {
  return Array.from(markdown.replace(/\s/g, '')).length;
}

function markdownSourceSummary(block: BlockViewModel): string {
  const range = block.sourceRange;
  if (!range) return '运行时新增块';
  return `第 ${range.startLine} - ${range.endLine} 行`;
}

function listIndentPx(block: BlockViewModel): number {
  const indent = typeof block.attrs?.indent === 'string' ? block.attrs.indent : '';
  return Math.min(120, indent.replace(/\t/g, '    ').length * 10);
}

function blockListIndent(block: BlockViewModel): string {
  return typeof block.attrs?.indent === 'string' ? block.attrs.indent : '';
}

function blockListIndentWidth(block: BlockViewModel): number {
  return blockListIndent(block).replace(/\t/g, '    ').length;
}

function isListItemBlock(block: BlockViewModel | undefined): boolean {
  return block?.type === 'bulleted_list_item'
    || block?.type === 'ordered_list_item'
    || block?.type === 'todo_item';
}

function orderedListMarker(blocks: BlockViewModel[], blockIndex: number): string {
  const block = blocks[blockIndex];
  if (!block) return '1.';
  const indent = blockListIndent(block);
  const indentWidth = blockListIndentWidth(block);
  const delimiter = String(block.attrs?.delimiter || '.');
  let firstIndex = blockIndex;
  let previousItemsAtSameLevel = 0;

  for (let index = blockIndex - 1; index >= 0; index -= 1) {
    const previous = blocks[index];
    if (
      !isListItemBlock(previous)
      || blockListIndentWidth(previous) < indentWidth
    ) {
      break;
    }

    if (blockListIndent(previous) !== indent) continue;
    if (previous.type !== 'ordered_list_item') break;

    previousItemsAtSameLevel += 1;
    firstIndex = index;
  }

  const first = blocks[firstIndex];
  const start = typeof first?.attrs?.start === 'number' ? first.attrs.start : 1;
  return `${start + previousItemsAtSameLevel}${delimiter}`;
}

function listMarker(blocks: BlockViewModel[], blockIndex: number): string | null {
  const block = blocks[blockIndex];
  if (!block) return null;
  if (block.type === 'bulleted_list_item') return '';
  if (block.type === 'ordered_list_item') return orderedListMarker(blocks, blockIndex);
  return null;
}

function blockAIPopoverPosition(rect: DOMRect): { x: number; y: number } {
  const margin = 12;
  const x = Math.max(margin, Math.min(rect.left, window.innerWidth - BLOCK_AI_POPOVER_WIDTH - margin));
  const below = rect.bottom + 8;
  const above = rect.top - BLOCK_AI_POPOVER_HEIGHT - 8;
  const y = below + BLOCK_AI_POPOVER_HEIGHT <= window.innerHeight - margin
    ? below
    : Math.max(margin, above);
  return { x, y };
}

function dropPositionFromEvent(element: HTMLElement, clientY: number): DropPosition {
  const rect = element.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function blockRowFromPoint(clientX: number, clientY: number): HTMLElement | null {
  const element = document.elementFromPoint(clientX, clientY);
  return element instanceof HTMLElement ? element.closest<HTMLElement>('.block-row[data-block-index]') : null;
}

function blockIndexFromRow(row: HTMLElement | null, length: number): number | null {
  const parsed = Number.parseInt(row?.dataset.blockIndex || '', 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < length ? parsed : null;
}

function scrollBlockDocumentDuringDrag(clientY: number): void {
  const scroller = document.querySelector<HTMLElement>('.block-document-scroll');
  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  const edge = 56;
  const maxStep = 18;
  if (clientY < rect.top + edge) {
    scroller.scrollTop -= Math.ceil(((rect.top + edge - clientY) / edge) * maxStep);
  } else if (clientY > rect.bottom - edge) {
    scroller.scrollTop += Math.ceil(((clientY - (rect.bottom - edge)) / edge) * maxStep);
  }
}

export default function BlockEditor() {
  const { state, dispatch } = useApp();
  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
  const [blocks, setBlocks] = useState<BlockViewModel[]>(() => parseMarkdownToBlocks(activeTab?.content || ''));
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTargetState | null>(null);
  const [blockMenu, setBlockMenu] = useState<BlockContextMenuState | null>(null);
  const [blockAI, setBlockAI] = useState<BlockAIPopoverState | null>(null);
  const [blockAIPrompt, setBlockAIPrompt] = useState('');
  const textareasRef = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const documentRef = useRef<HTMLDivElement | null>(null);
  const blockMenuRef = useRef<HTMLDivElement | null>(null);
  const blockAIRef = useRef<HTMLDivElement | null>(null);
  const blockAIPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const dragTargetRef = useRef<DragTargetState | null>(null);
  const measuredDocumentWidthRef = useRef(0);
  const historyPastRef = useRef<string[]>([]);
  const historyFutureRef = useRef<string[]>([]);
  const currentTabIdRef = useRef<string | null>(activeTab?.id ?? null);
  const syncedContentRef = useRef(activeTab?.content || '');
  const selectedBlock = selectedIndex == null ? null : blocks[selectedIndex] || null;
  const blockSearchQuery = state.searchQuery.trim();
  const selectedBlocks = useMemo(
    () => normalizeIndices(selectedIndices, blocks.length).map(index => blocks[index]).filter(Boolean),
    [blocks, selectedIndices],
  );

  const resizeBlockTextareas = useCallback(() => {
    Object.values(textareasRef.current).forEach(resizeTextarea);
  }, []);

  const setBlockDragTarget = useCallback((target: DragTargetState | null) => {
    dragTargetRef.current = target;
    setDragTarget((current) => {
      if (current == null && target == null) return current;
      if (current?.index === target?.index && current?.position === target?.position) return current;
      return target;
    });
  }, []);

  const filteredCommands = useMemo(() => {
    const query = slash?.query.trim().toLowerCase() || '';
    const commands = !query
      ? SLASH_COMMANDS
      : SLASH_COMMANDS.filter(command => (
          command.label.toLowerCase().includes(query)
          || command.keywords.some(keyword => keyword.toLowerCase().includes(query))
        ));
    return commands.length > 0 ? commands : SLASH_COMMANDS;
  }, [slash?.query]);

  useEffect(() => {
    setSelectedIndex(null);
    setSelectedIndices([]);
    setSlash(null);
    setDragIndex(null);
    pointerDragRef.current = null;
    document.body.classList.remove('block-pointer-dragging');
    setBlockDragTarget(null);
    setBlockMenu(null);
    setBlockAI(null);
    setBlockAIPrompt('');
    historyPastRef.current = [];
    historyFutureRef.current = [];
  }, [activeTab?.id, setBlockDragTarget]);

  useEffect(() => {
    const nextTabId = activeTab?.id ?? null;
    const nextContent = activeTab?.content || '';
    const tabChanged = currentTabIdRef.current !== nextTabId;
    const contentChangedExternally = syncedContentRef.current !== nextContent;

    if (!tabChanged && !contentChangedExternally) return;

    currentTabIdRef.current = nextTabId;
    syncedContentRef.current = nextContent;
    setBlocks(parseMarkdownToBlocks(nextContent));
  }, [activeTab?.content, activeTab?.id]);

  useEffect(() => {
    setSelectedIndex(current => clampIndex(current, blocks.length));
    setSelectedIndices(current => normalizeIndices(current, blocks.length));
  }, [blocks.length]);

  useLayoutEffect(() => {
    if (state.viewMode !== 'block') return;
    resizeBlockTextareas();
  }, [
    activeTab?.id,
    blocks.length,
    resizeBlockTextareas,
    state.editorSettings.fontFamily,
    state.editorSettings.fontSize,
    state.editorSettings.lineHeight,
    state.viewMode,
  ]);

  useEffect(() => {
    if (state.viewMode !== 'block') return undefined;

    let firstFrame = 0;
    let secondFrame = 0;
    const timeout = window.setTimeout(resizeBlockTextareas, 120);

    firstFrame = window.requestAnimationFrame(() => {
      resizeBlockTextareas();
      secondFrame = window.requestAnimationFrame(resizeBlockTextareas);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(timeout);
    };
  }, [
    activeTab?.id,
    blocks.length,
    resizeBlockTextareas,
    state.editorSettings.fontFamily,
    state.editorSettings.fontSize,
    state.editorSettings.lineHeight,
    state.viewMode,
  ]);

  useEffect(() => {
    if (state.viewMode !== 'block') return undefined;
    const target = documentRef.current;
    if (!target) return undefined;

    const resizeWhenWidthChanges = (width: number) => {
      const roundedWidth = Math.round(width);
      if (roundedWidth === measuredDocumentWidthRef.current) return;
      measuredDocumentWidthRef.current = roundedWidth;
      resizeBlockTextareas();
    };

    const handleWindowResize = () => {
      resizeWhenWidthChanges(target.getBoundingClientRect().width);
    };

    handleWindowResize();
    window.addEventListener('resize', handleWindowResize);

    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', handleWindowResize);
    }

    const observer = new ResizeObserver((entries) => {
      resizeWhenWidthChanges(entries[0]?.contentRect.width ?? target.getBoundingClientRect().width);
    });
    observer.observe(target);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [activeTab?.id, resizeBlockTextareas, state.viewMode]);

  useEffect(() => {
    if (state.viewMode !== 'block') {
      dispatch({ type: 'SET_BLOCK_SELECTION_STATUS', payload: null });
      return;
    }

    if (selectedBlocks.length > 1) {
      dispatch({
        type: 'SET_BLOCK_SELECTION_STATUS',
        payload: {
          id: 'multi-selection',
          typeLabel: `已选 ${selectedBlocks.length} 个块`,
          sourceLabel: '多选',
          characterCount: selectedBlocks.reduce(
            (count, block) => count + Array.from(plainTextFromBlock(block).replace(/\s/g, '')).length,
            0,
          ),
          summary: selectedBlocks.map(block => blockTypeLabel(block.type)).join(' / '),
        },
      });
      return;
    }

    if (!selectedBlock) {
      dispatch({ type: 'SET_BLOCK_SELECTION_STATUS', payload: null });
      return;
    }

    const summary = plainTextFromBlock(selectedBlock).replace(/\s+/g, ' ').trim();
    dispatch({
      type: 'SET_BLOCK_SELECTION_STATUS',
      payload: {
        id: selectedBlock.id,
        typeLabel: blockTypeLabel(selectedBlock.type),
        sourceLabel: markdownSourceSummary(selectedBlock),
        characterCount: Array.from(plainTextFromBlock(selectedBlock).replace(/\s/g, '')).length,
        summary: summary || '空块',
      },
    });
  }, [dispatch, selectedBlock, selectedBlocks, state.viewMode]);

  const pushHistorySnapshot = useCallback((content: string) => {
    const past = historyPastRef.current;
    if (past[past.length - 1] === content) return;
    historyPastRef.current = [...past.slice(-99), content];
    historyFutureRef.current = [];
  }, []);

  const syncBlocks = useCallback((
    nextBlocks: BlockViewModel[],
    nextSelectedIndex: number | null = selectedIndex,
    options: { recordHistory?: boolean; selectedIndices?: number[] } = {},
  ) => {
    if (!activeTab) return;
    if (options.recordHistory !== false) pushHistorySnapshot(activeTab.content);
    const nextContent = serializeBlocks(nextBlocks);
    syncedContentRef.current = nextContent;
    setBlocks(nextBlocks);
    dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: nextContent } });
    dispatch({ type: 'SET_WORD_COUNT', payload: countMarkdownCharacters(nextContent) });
    const nextPrimaryIndex = clampIndex(nextSelectedIndex, nextBlocks.length);
    const nextSelectedIndices = options.selectedIndices == null
      ? (nextPrimaryIndex == null ? [] : [nextPrimaryIndex])
      : normalizeIndices(options.selectedIndices, nextBlocks.length);
    setSelectedIndex(nextPrimaryIndex);
    setSelectedIndices(nextSelectedIndices);
    setBlockMenu(null);
    setBlockAI(null);
  }, [activeTab, dispatch, pushHistorySnapshot, selectedIndex]);

  const replaceBlock = useCallback((blockIndex: number, block: BlockViewModel, nextSelectedIndex = blockIndex) => {
    syncBlocks(blocks.map((item, index) => (index === blockIndex ? block : item)), nextSelectedIndex);
  }, [blocks, syncBlocks]);

  const insertBlockBefore = useCallback((blockIndex: number, block: BlockViewModel = createBlock('paragraph')) => {
    const targetIndex = Math.max(0, Math.min(blockIndex, blocks.length));
    const next = [...blocks.slice(0, targetIndex), block, ...blocks.slice(targetIndex)];
    syncBlocks(next, targetIndex, { selectedIndices: [targetIndex] });
    window.setTimeout(() => textareasRef.current[targetIndex]?.focus(), 0);
  }, [blocks, syncBlocks]);

  const insertBlockAfter = useCallback((blockIndex: number, block: BlockViewModel = createBlock('paragraph')) => {
    const targetIndex = Math.max(0, Math.min(blockIndex + 1, blocks.length));
    const next = [...blocks.slice(0, targetIndex), block, ...blocks.slice(targetIndex)];
    syncBlocks(next, targetIndex, { selectedIndices: [targetIndex] });
    window.setTimeout(() => textareasRef.current[targetIndex]?.focus(), 0);
  }, [blocks, syncBlocks]);

  const getSelectionForBlock = useCallback((blockIndex?: number | null) => {
    const fallbackIndex = blockIndex ?? selectedIndex;
    const base = selectedIndices.length > 0
      ? selectedIndices
      : (fallbackIndex == null ? [] : [fallbackIndex]);
    return normalizeIndices(base, blocks.length);
  }, [blocks.length, selectedIndex, selectedIndices]);

  const deleteBlocksAt = useCallback((indices: number[]) => {
    const targets = normalizeIndices(indices, blocks.length);
    if (targets.length === 0) return;
    if (blocks.length <= targets.length) {
      syncBlocks([createBlock('empty')], 0, { selectedIndices: [0] });
      return;
    }
    const targetSet = new Set(targets);
    const next = blocks.filter((_, index) => !targetSet.has(index));
    const nextIndex = Math.min(targets[0], next.length - 1);
    syncBlocks(next, nextIndex, { selectedIndices: [nextIndex] });
  }, [blocks, syncBlocks]);

  const duplicateBlocksAt = useCallback((indices: number[]) => {
    const targets = normalizeIndices(indices, blocks.length);
    if (targets.length === 0) return;
    const duplicates = targets
      .map((targetIndex, duplicateIndex) => {
        const source = blocks[targetIndex];
        return source ? cloneBlock(source, `${targetIndex}_${duplicateIndex}`) : null;
      })
      .filter((block): block is BlockViewModel => Boolean(block));
    if (duplicates.length === 0) return;
    const insertionIndex = targets[targets.length - 1] + 1;
    const next = [...blocks.slice(0, insertionIndex), ...duplicates, ...blocks.slice(insertionIndex)];
    const nextSelection = duplicates.map((_, index) => insertionIndex + index);
    syncBlocks(next, nextSelection[0], { selectedIndices: nextSelection });
  }, [blocks, syncBlocks]);

  const convertBlocksAt = useCallback((indices: number[], type: BlockType) => {
    const targets = normalizeIndices(indices, blocks.length);
    if (targets.length === 0) return;
    const targetSet = new Set(targets);
    const next = blocks.map((block, index) => (targetSet.has(index) ? convertBlock(block, type) : block));
    syncBlocks(next, targets[0], { selectedIndices: targets });
  }, [blocks, syncBlocks]);

  const convertSelectedBlock = useCallback((blockIndex: number, type: BlockType) => {
    convertBlocksAt(getSelectionForBlock(blockIndex), type);
  }, [convertBlocksAt, getSelectionForBlock]);

  const moveBlockToDropTarget = useCallback((from: number, target: number, position: DropPosition) => {
    const result = moveItemToPosition(blocks, from, target, position);
    syncBlocks(result.items, result.index, { selectedIndices: [result.index] });
  }, [blocks, syncBlocks]);

  const updatePointerDragTarget = useCallback((clientX: number, clientY: number) => {
    const drag = pointerDragRef.current;
    if (!drag) return;

    const row = blockRowFromPoint(clientX, clientY);
    const targetIndex = blockIndexFromRow(row, blocks.length);
    if (targetIndex == null || targetIndex === drag.index || !row) {
      setBlockDragTarget(null);
      return;
    }

    setBlockDragTarget({
      index: targetIndex,
      position: dropPositionFromEvent(row, clientY),
    });
  }, [blocks.length, setBlockDragTarget]);

  const clearBlockDragState = useCallback(() => {
    pointerDragRef.current = null;
    document.body.classList.remove('block-pointer-dragging');
    setDragIndex(null);
    setBlockDragTarget(null);
  }, [setBlockDragTarget]);

  const finishPointerDrag = useCallback((shouldDrop: boolean) => {
    const drag = pointerDragRef.current;
    const target = dragTargetRef.current;
    clearBlockDragState();
    if (!shouldDrop || !drag?.active || !target || target.index === drag.index) return;
    moveBlockToDropTarget(drag.index, target.index, target.position);
  }, [clearBlockDragState, moveBlockToDropTarget]);

  const handleDragPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, blockIndex: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some WebViews can reject pointer capture for detached targets; document listeners still handle the drag.
    }

    pointerDragRef.current = {
      index: blockIndex,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: true,
    };
    document.body.classList.add('block-pointer-dragging');
    setDragIndex(blockIndex);
    setBlockDragTarget(null);
    setSelectedIndex(blockIndex);
    setSelectedIndices([blockIndex]);
    setSlash(null);
    setBlockMenu(null);
    setBlockAI(null);
  }, [setBlockDragTarget]);

  useEffect(() => {
    if (state.viewMode !== 'block') return undefined;

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

      event.preventDefault();
      scrollBlockDocumentDuringDrag(event.clientY);
      updatePointerDragTarget(event.clientX, event.clientY);
    };

    const handlePointerUp = (event: globalThis.PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      finishPointerDrag(true);
    };

    const handlePointerCancel = (event: globalThis.PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      finishPointerDrag(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !pointerDragRef.current) return;
      event.preventDefault();
      finishPointerDrag(false);
    };

    document.addEventListener('pointermove', handlePointerMove, { passive: false });
    document.addEventListener('pointerup', handlePointerUp, { passive: false });
    document.addEventListener('pointercancel', handlePointerCancel, { passive: false });
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
      document.removeEventListener('keydown', handleKeyDown);
      clearBlockDragState();
    };
  }, [clearBlockDragState, finishPointerDrag, state.viewMode, updatePointerDragTarget]);

  const moveSelectedBlocksBy = useCallback((delta: -1 | 1) => {
    const targets = getSelectionForBlock();
    if (targets.length === 0) return;
    const selectedSet = new Set(targets);
    const next = [...blocks];
    const orderedTargets = delta < 0 ? targets : [...targets].reverse();

    orderedTargets.forEach((targetIndex) => {
      const swapIndex = targetIndex + delta;
      if (swapIndex < 0 || swapIndex >= next.length || selectedSet.has(swapIndex)) return;
      [next[targetIndex], next[swapIndex]] = [next[swapIndex], next[targetIndex]];
      selectedSet.delete(targetIndex);
      selectedSet.add(swapIndex);
    });

    const nextSelection = normalizeIndices(Array.from(selectedSet), next.length);
    syncBlocks(next, nextSelection[0] ?? null, { selectedIndices: nextSelection });
  }, [blocks, getSelectionForBlock, syncBlocks]);

  const undoBlockHistory = useCallback(() => {
    if (!activeTab) return false;
    const previous = historyPastRef.current.pop();
    if (previous == null) return false;
    historyFutureRef.current.push(activeTab.content);
    syncedContentRef.current = previous;
    setBlocks(parseMarkdownToBlocks(previous));
    dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: previous } });
    dispatch({ type: 'SET_WORD_COUNT', payload: countMarkdownCharacters(previous) });
    setSelectedIndex(null);
    setSelectedIndices([]);
    setSlash(null);
    return true;
  }, [activeTab, dispatch]);

  const redoBlockHistory = useCallback(() => {
    if (!activeTab) return false;
    const nextContent = historyFutureRef.current.pop();
    if (nextContent == null) return false;
    historyPastRef.current.push(activeTab.content);
    syncedContentRef.current = nextContent;
    setBlocks(parseMarkdownToBlocks(nextContent));
    dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: nextContent } });
    dispatch({ type: 'SET_WORD_COUNT', payload: countMarkdownCharacters(nextContent) });
    setSelectedIndex(null);
    setSelectedIndices([]);
    setSlash(null);
    return true;
  }, [activeTab, dispatch]);

  const selectBlock = useCallback((blockIndex: number, event?: MouseEvent<HTMLElement>) => {
    setBlockMenu(null);
    if (event?.shiftKey) {
      const anchor = selectedIndex ?? selectedIndices[0] ?? blockIndex;
      const nextSelection = normalizeIndices(rangeIndices(anchor, blockIndex), blocks.length);
      setSelectedIndex(blockIndex);
      setSelectedIndices(nextSelection);
      return;
    }

    if (event && isPrimaryShortcut(event)) {
      const base = selectedIndices.length > 0
        ? selectedIndices
        : (selectedIndex == null ? [] : [selectedIndex]);
      const nextSelection = base.includes(blockIndex)
        ? base.filter(index => index !== blockIndex)
        : [...base, blockIndex];
      const normalized = normalizeIndices(nextSelection, blocks.length);
      setSelectedIndex(normalized.includes(blockIndex) ? blockIndex : normalized[normalized.length - 1] ?? null);
      setSelectedIndices(normalized);
      return;
    }

    setSelectedIndex(blockIndex);
    setSelectedIndices([blockIndex]);
  }, [blocks.length, selectedIndex, selectedIndices]);

  const selectedMarkdown = useCallback((indices: number[]) => (
    normalizeIndices(indices, blocks.length)
      .map(index => blocks[index])
      .filter(Boolean)
      .map(block => blockToMarkdown(block))
      .join('\n\n')
  ), [blocks]);

  const selectedPlainText = useCallback((indices: number[]) => (
    normalizeIndices(indices, blocks.length)
      .map(index => blocks[index])
      .filter(Boolean)
      .map(block => plainTextFromBlock(block))
      .join('\n')
  ), [blocks]);

  const copyText = useCallback(async (text: string, successText: string) => {
    if (!text.trim()) {
      message.warning('没有可复制的内容');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      message.success(successText);
    } catch {
      message.error('复制失败，请检查剪贴板权限');
    }
  }, []);

  const buildBlockAISelection = useCallback((blockIndex: number): BlockAISelectionPayload | null => {
    const targets = getSelectionForBlock(blockIndex);
    const targetBlocks = targets
      .map(index => blocks[index])
      .filter((block): block is BlockViewModel => Boolean(block));
    if (targetBlocks.length === 0) return null;
    if (targetBlocks.length > 1 && !isContiguousIndices(targets)) {
      message.warning('AI 多块处理暂只支持连续选择，请用 Shift 点击选择范围');
      return null;
    }

    const sourceBlocks = parseMarkdownToBlocks(syncedContentRef.current);
    const firstRange = sourceBlocks[targets[0]]?.sourceRange;
    const lastRange = sourceBlocks[targets[targets.length - 1]]?.sourceRange;
    if (firstRange?.startOffset == null || lastRange?.endOffset == null) {
      message.warning('选中的块还没有源码映射，请先保存一次块内容');
      return null;
    }

    return {
      targetBlocks,
      selection: {
        text: targetBlocks.map(block => block.markdown || blockToMarkdown(block)).join('\n\n'),
        range: { from: firstRange.startOffset, to: lastRange.endOffset },
      },
    };
  }, [blocks, getSelectionForBlock]);

  const runAIAction = useCallback((action: BlockAIAction, blockIndex: number) => {
    const payload = buildBlockAISelection(blockIndex);
    if (!payload) return;

    window.dispatchEvent(new CustomEvent('orcha-block-ai', {
      detail: {
        prompt: payload.targetBlocks.length > 1
          ? `${BLOCK_AI_PROMPTS[action]}（共 ${payload.targetBlocks.length} 个块）`
          : BLOCK_AI_PROMPTS[action],
        commandId: BLOCK_AI_COMMAND_IDS[action],
        selection: payload.selection,
      },
    }));
    setBlockAI(null);
    setBlockAIPrompt('');
    message.success('已发送到右侧 AI 写作面板');
  }, [buildBlockAISelection]);

  const runCustomBlockAI = useCallback((prompt: string, blockIndex: number) => {
    const value = prompt.trim();
    if (!value) return;
    const payload = buildBlockAISelection(blockIndex);
    if (!payload) return;

    window.dispatchEvent(new CustomEvent('orcha-block-ai', {
      detail: {
        prompt: value,
        resultMode: 'diff',
        selection: payload.selection,
      },
    }));
    setBlockAI(null);
    setBlockAIPrompt('');
    message.success('已发送到右侧 AI 写作面板');
  }, [buildBlockAISelection]);

  const openBlockAIPopover = useCallback((event: MouseEvent<HTMLButtonElement>, blockIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    const keepMultiSelection = selectedIndices.includes(blockIndex);
    if (!keepMultiSelection) {
      setSelectedIndices([blockIndex]);
    }
    setSelectedIndex(blockIndex);
    setSlash(null);
    setBlockMenu(null);
    setBlockAIPrompt('');
    const { x, y } = blockAIPopoverPosition(event.currentTarget.getBoundingClientRect());
    setBlockAI({ x, y, blockIndex });
  }, [selectedIndices]);

  const applySlashCommand = useCallback((command: SlashCommand) => {
    if (!slash) return;
    const blockIndex = slash.blockIndex;

    if (command.type === 'ai') {
      runAIAction('generate_next_block', blockIndex);
      setSlash(null);
      return;
    }

    const nextBlock = createBlock(command.type);
    if (slash.insertAfter) {
      insertBlockAfter(blockIndex, nextBlock);
    } else {
      replaceBlock(blockIndex, nextBlock);
      window.setTimeout(() => textareasRef.current[blockIndex]?.focus(), 0);
    }
    setSlash(null);
  }, [insertBlockAfter, replaceBlock, runAIAction, slash]);

  const updateSlashQuery = useCallback((blockIndex: number, value: string) => {
    if (value.startsWith('/')) {
      setSlash(current => ({
        blockIndex,
        query: value.slice(1),
        activeIndex: current?.blockIndex === blockIndex ? current.activeIndex : 0,
        insertAfter: false,
      }));
    } else if (slash?.blockIndex === blockIndex && !slash.insertAfter) {
      setSlash(null);
    }
  }, [slash]);

  const handleTextChange = useCallback((blockIndex: number, value: string) => {
    const block = blocks[blockIndex];
    if (!block) return;
    replaceBlock(blockIndex, inferMarkdownBlockFromText(block, value) ?? updateBlockContent(block, value));
    updateSlashQuery(blockIndex, value);
  }, [blocks, replaceBlock, updateSlashQuery]);

  const updateTableBlock = useCallback((blockIndex: number, updater: (table: MarkdownTableModel) => MarkdownTableModel) => {
    const block = blocks[blockIndex];
    if (!block || block.type !== 'table') return;
    const table = parseMarkdownTable(tableMarkdownFromBlock(block));
    if (!table) return;
    const nextTable = updater(cloneTableModel(table));
    replaceBlock(blockIndex, updateBlockContent(block, serializeMarkdownTable(nextTable)));
  }, [blocks, replaceBlock]);

  const updateTableCell = useCallback((
    blockIndex: number,
    section: 'header' | 'body',
    rowIndex: number,
    columnIndex: number,
    value: string,
  ) => {
    updateTableBlock(blockIndex, (table) => {
      if (section === 'header') {
        table.headers[columnIndex] = value;
      } else if (table.rows[rowIndex]) {
        table.rows[rowIndex][columnIndex] = value;
      }
      return table;
    });
  }, [updateTableBlock]);

  const addTableRow = useCallback((blockIndex: number) => {
    updateTableBlock(blockIndex, (table) => {
      table.rows.push(Array.from({ length: table.headers.length }, () => ''));
      return table;
    });
  }, [updateTableBlock]);

  const addTableColumn = useCallback((blockIndex: number) => {
    updateTableBlock(blockIndex, (table) => {
      table.headers.push(`列 ${table.headers.length + 1}`);
      table.alignments.push('default');
      table.rows = table.rows.map(row => [...row, '']);
      return table;
    });
  }, [updateTableBlock]);

  const removeTableRow = useCallback((blockIndex: number, rowIndex: number) => {
    updateTableBlock(blockIndex, (table) => {
      if (table.rows.length <= 1) return table;
      table.rows.splice(rowIndex, 1);
      return table;
    });
  }, [updateTableBlock]);

  const removeTableColumn = useCallback((blockIndex: number, columnIndex: number) => {
    updateTableBlock(blockIndex, (table) => {
      if (table.headers.length <= 1) return table;
      table.headers.splice(columnIndex, 1);
      table.alignments.splice(columnIndex, 1);
      table.rows = table.rows.map((row) => {
        const nextRow = [...row];
        nextRow.splice(columnIndex, 1);
        return nextRow;
      });
      return table;
    });
  }, [updateTableBlock]);

  const handleTextareaKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>, blockIndex: number) => {
    if (slash?.blockIndex === blockIndex) {
      if (event.key === 'Backspace' && event.currentTarget.value === '/') {
        event.preventDefault();
        const block = blocks[blockIndex];
        if (block) replaceBlock(blockIndex, updateBlockContent(block, ''));
        setSlash(null);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlash(current => current ? { ...current, activeIndex: (current.activeIndex + 1) % filteredCommands.length } : current);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlash(current => current ? { ...current, activeIndex: (current.activeIndex - 1 + filteredCommands.length) % filteredCommands.length } : current);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        applySlashCommand(filteredCommands[slash.activeIndex] || filteredCommands[0]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlash(null);
        return;
      }
    }

    if (event.key === 'Backspace' && !event.currentTarget.value && blocks.length > 1) {
      event.preventDefault();
      const nextFocusIndex = Math.max(0, blockIndex - 1);
      deleteBlocksAt([blockIndex]);
      window.setTimeout(() => textareasRef.current[nextFocusIndex]?.focus(), 0);
      return;
    }

    if (isPrimaryShortcut(event) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      duplicateBlocksAt(getSelectionForBlock(blockIndex));
    }
  }, [applySlashCommand, blocks, deleteBlocksAt, duplicateBlocksAt, filteredCommands, getSelectionForBlock, replaceBlock, slash]);

  const handlePlusClick = useCallback((event: MouseEvent<HTMLButtonElement>, blockIndex: number) => {
    event.preventDefault();
    setSelectedIndex(blockIndex);
    setSelectedIndices([blockIndex]);
    if (event.altKey) {
      insertBlockAfter(blockIndex, createBlock('paragraph'));
      return;
    }
    setSlash({ blockIndex, query: '', activeIndex: 0, insertAfter: true });
  }, [insertBlockAfter]);

  const handleBlockContextMenu = useCallback((event: MouseEvent<HTMLElement>, blockIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    const keepMultiSelection = selectedIndices.includes(blockIndex);
    if (!keepMultiSelection) {
      setSelectedIndex(blockIndex);
      setSelectedIndices([blockIndex]);
    } else {
      setSelectedIndex(blockIndex);
    }
    setSlash(null);
    setBlockMenu({
      x: Math.max(12, Math.min(event.clientX, window.innerWidth - 208)),
      y: Math.max(12, Math.min(event.clientY, window.innerHeight - 330)),
      blockIndex,
    });
    setBlockAI(null);
  }, [selectedIndices]);

  const contextSelection = blockMenu ? getSelectionForBlock(blockMenu.blockIndex) : [];
  const blockAISelection = blockAI ? getSelectionForBlock(blockAI.blockIndex) : [];
  const blockAIScopeLabel = blockAISelection.length > 1 ? `${blockAISelection.length} 个块` : '当前块';

  const runContextAction = useCallback((action: () => void) => {
    action();
    setBlockMenu(null);
  }, []);

  const clearBlockEditorFloatingState = useCallback(() => {
    setSelectedIndex(null);
    setSelectedIndices([]);
    setSlash(null);
    setBlockMenu(null);
    setBlockAI(null);
  }, []);

  const handleShellMouseDown = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || isBlockEditorContentTarget(event.target)) return;
    clearBlockEditorFloatingState();
  }, [clearBlockEditorFloatingState]);

  const handleShellContextMenuCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
  }, []);

  const handleShellContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    if (isBlockEditorContentTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    clearBlockEditorFloatingState();
  }, [clearBlockEditorFloatingState]);

  useEffect(() => {
    if (!blockAI) return undefined;
    const timer = window.setTimeout(() => {
      resizeAIPromptTextarea(blockAIPromptRef.current);
      blockAIPromptRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [blockAI]);

  useEffect(() => {
    if (state.viewMode !== 'block') return undefined;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (blockAI && event.key === 'Escape') {
        event.preventDefault();
        setBlockAI(null);
        return;
      }
      if (slash) {
        if (event.key === 'Escape') setSlash(null);
        return;
      }
      const primary = isPrimaryShortcut(event);
      if (primary && !event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoBlockHistory();
        else undoBlockHistory();
        return;
      }
      if (primary && !event.altKey && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoBlockHistory();
        return;
      }

      const selection = getSelectionForBlock();
      if (selection.length === 0) return;

      if (!isEditingTarget(event.target) && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        deleteBlocksAt(selection);
        return;
      }
      if (primary && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateBlocksAt(selection);
      }
      if (primary && event.shiftKey && event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelectedBlocksBy(-1);
      }
      if (primary && event.shiftKey && event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelectedBlocksBy(1);
      }
      if (primary && event.altKey && ['0', '1', '2', '3'].includes(event.key)) {
        event.preventDefault();
        const target = event.key === '0' ? 'paragraph' : `heading_${event.key}` as BlockType;
        convertBlocksAt(selection, target);
      }
      if (primary && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        runAIAction('polish', selectedIndex ?? selection[0]);
      }
      if (event.key === 'Escape') {
        clearBlockEditorFloatingState();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    convertBlocksAt,
    deleteBlocksAt,
    duplicateBlocksAt,
    getSelectionForBlock,
    blockAI,
    clearBlockEditorFloatingState,
    moveSelectedBlocksBy,
    redoBlockHistory,
    runAIAction,
    selectedIndex,
    slash,
    state.viewMode,
    undoBlockHistory,
  ]);

  useEffect(() => {
    if (!blockMenu) return undefined;
    const closeMenu = () => setBlockMenu(null);
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && blockMenuRef.current?.contains(target)) return;
      closeMenu();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('scroll', closeMenu, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('scroll', closeMenu, true);
    };
  }, [blockMenu]);

  useEffect(() => {
    if (!blockAI) return undefined;
    const closePopover = () => setBlockAI(null);
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && blockAIRef.current?.contains(target)) return;
      if (event.target instanceof HTMLElement && event.target.closest('.block-toolbar')) return;
      closePopover();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('scroll', closePopover, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('scroll', closePopover, true);
    };
  }, [blockAI]);

  if (state.viewMode !== 'block') return null;

  if (!activeTab) {
    return (
      <section
        className="block-editor-shell"
        onMouseDown={handleShellMouseDown}
        onContextMenuCapture={handleShellContextMenuCapture}
        onContextMenu={handleShellContextMenu}
      >
        <div className="empty-state">
          <p>打开或新建一个 Markdown 文件后，可以使用块编辑模式。</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={['block-editor-shell', dragIndex != null ? 'is-block-dragging' : ''].filter(Boolean).join(' ')}
      onMouseDown={handleShellMouseDown}
      onContextMenuCapture={handleShellContextMenuCapture}
      onContextMenu={handleShellContextMenu}
    >
      <main className="block-document-scroll">
        <div ref={documentRef} className="block-document">
          <div className="block-list">
            {blocks.map((block, index) => {
              const isSelected = selectedIndex === index || selectedIndices.includes(index);
              const isPrimarySelected = selectedIndex === index;
              const isSlashOpen = slash?.blockIndex === index;
              const selectionForThisBlock = isSelected ? getSelectionForBlock(index) : [index];
              const isDropBefore = dragTarget?.index === index && dragTarget.position === 'before';
              const isDropAfter = dragTarget?.index === index && dragTarget.position === 'after';
              const textareaValue = block.type === 'empty' ? block.content : plainTextFromBlock(block);
              const textareaResizeKey = `${block.id}:${textareaValue.length}`;
              const imagePath = block.type === 'image' ? String(block.attrs?.src || '') : '';
              const resolvedImage = block.type === 'image' && imagePath
                ? resolveMarkdownImageSource(imagePath, activeTab.path)
                : null;
              const marker = listMarker(blocks, index);
              const isListBlock = isListItemBlock(block);
              const contentStyle = isListBlock
                ? ({ '--block-list-indent': `${listIndentPx(block)}px` } as CSSProperties)
                : undefined;
              const tableModel = block.type === 'table' ? parseMarkdownTable(tableMarkdownFromBlock(block)) : null;
              return (
                <div
                  key={`block-row-${index}`}
                  data-block-index={index}
                  className={[
                    'block-row',
                    `block-row-${block.type}`,
                    isSelected ? 'is-selected' : '',
                    selectedIndices.length > 1 && isSelected ? 'is-multi-selected' : '',
                    dragIndex === index ? 'is-dragging' : '',
                    isDropBefore ? 'is-drop-before' : '',
                    isDropAfter ? 'is-drop-after' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={(event) => selectBlock(index, event)}
                  onContextMenu={(event) => handleBlockContextMenu(event, index)}
                >
                  <div
                    className="block-handle-rail"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => handleDragPointerDown(event, index)}
                  >
                    <button
                      type="button"
                      className="block-mini-btn block-insert-btn"
                      aria-label="插入块"
                      data-tooltip="插入块"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => handlePlusClick(event, index)}
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      type="button"
                      className="block-mini-btn block-drag-handle"
                      aria-label="拖拽移动块"
                      data-tooltip="拖拽"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <GripVertical size={14} />
                    </button>
                  </div>

                  <div
                    className={[
                      'block-content-wrap',
                      isListBlock ? 'is-list-block' : '',
                      marker != null ? 'has-list-marker' : '',
                      block.type === 'todo_item' ? 'has-list-checkbox' : '',
                    ].filter(Boolean).join(' ')}
                    style={contentStyle}
                  >
                    {block.type === 'horizontal_rule' ? (
                      <div className="block-hr" />
                    ) : (
                      <>
                        {marker != null && (
                          <span
                            className={`block-list-marker ${block.type === 'ordered_list_item' ? 'block-list-marker-ordered' : 'block-list-marker-bullet'}`}
                            aria-hidden="true"
                          >
                            {marker}
                          </span>
                        )}
                        {block.type === 'todo_item' && (
                          <input
                            className="block-checkbox"
                            type="checkbox"
                            checked={Boolean(block.attrs?.checked)}
                            onChange={(event) => replaceBlock(index, updateBlockAttrs(block, { checked: event.target.checked }))}
                            onClick={(event) => event.stopPropagation()}
                          />
                        )}
                        {block.type === 'code_block' && (
                          <div className="block-code-head">
                            <span>语言</span>
                            <input
                              value={String(block.attrs?.language || '')}
                              placeholder="shell"
                              onChange={(event) => replaceBlock(index, updateBlockAttrs(block, { language: event.target.value }))}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </div>
                        )}
                        {block.type === 'image' && (
                          <div
                            className="block-image-card"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectBlock(index);
                            }}
                          >
                            {resolvedImage ? (
                              <div className="block-image-preview">
                                <img
                                  src={resolvedImage.src}
                                  alt={String(block.attrs?.alt || block.content || '图片')}
                                  onLoad={(event) => event.currentTarget.closest('.block-image-preview')?.classList.remove('is-error')}
                                  onError={(event) => event.currentTarget.closest('.block-image-preview')?.classList.add('is-error')}
                                />
                                <div className="block-image-error">
                                  图片加载失败
                                  <span>{resolvedImage.originalSrc}</span>
                                </div>
                              </div>
                            ) : (
                              <div className="block-image-empty">未设置图片路径</div>
                            )}
                            <label className="block-image-field">
                              <span>路径</span>
                              <input
                                value={imagePath}
                                placeholder="images/example.png"
                                onFocus={() => selectBlock(index)}
                                onChange={(event) => replaceBlock(index, updateBlockAttrs(block, { src: event.target.value }))}
                              />
                            </label>
                          </div>
                        )}
                        {block.type === 'table' && tableModel ? (
                          <div
                            className="block-table-card"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectBlock(index);
                            }}
                          >
                            <div className="block-table-scroll">
                              <table className="block-table-grid">
                                <thead>
                                  <tr>
                                    {tableModel.headers.map((cell, columnIndex) => (
                                      <th key={`header-${columnIndex}`}>
                                        <div className="block-table-cell-wrap">
                                          {blockSearchQuery && (
                                            <div className="block-table-input-highlight" aria-hidden="true">
                                              {renderSearchHighlight(cell, blockSearchQuery)}
                                            </div>
                                          )}
                                          <input
                                            value={cell}
                                            aria-label={`表头 ${columnIndex + 1}`}
                                            onFocus={() => {
                                              setSelectedIndex(index);
                                              setSelectedIndices([index]);
                                            }}
                                            onChange={(event) => updateTableCell(index, 'header', 0, columnIndex, event.target.value)}
                                          />
                                          <button
                                            type="button"
                                            className="block-table-cell-action"
                                            aria-label="删除列"
                                            disabled={tableModel.headers.length <= 1}
                                            onClick={() => removeTableColumn(index, columnIndex)}
                                          >
                                            <Trash2 size={12} />
                                          </button>
                                        </div>
                                      </th>
                                    ))}
                                    <th className="block-table-row-tools" aria-hidden="true" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {tableModel.rows.map((row, rowIndex) => (
                                    <tr key={`row-${rowIndex}`}>
                                      {tableModel.headers.map((_, columnIndex) => (
                                        <td key={`cell-${rowIndex}-${columnIndex}`}>
                                          <div className="block-table-cell-wrap">
                                            {blockSearchQuery && (
                                              <div className="block-table-input-highlight" aria-hidden="true">
                                                {renderSearchHighlight(row[columnIndex] ?? '', blockSearchQuery)}
                                              </div>
                                            )}
                                            <input
                                              value={row[columnIndex] ?? ''}
                                              aria-label={`第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`}
                                              onFocus={() => {
                                                setSelectedIndex(index);
                                                setSelectedIndices([index]);
                                              }}
                                              onChange={(event) => updateTableCell(index, 'body', rowIndex, columnIndex, event.target.value)}
                                            />
                                          </div>
                                        </td>
                                      ))}
                                      <td className="block-table-row-tools">
                                        <button
                                          type="button"
                                          aria-label="删除行"
                                          disabled={tableModel.rows.length <= 1}
                                          onClick={() => removeTableRow(index, rowIndex)}
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="block-table-actions">
                              <button type="button" onClick={() => addTableRow(index)}>
                                <Plus size={13} />
                                <span>行</span>
                              </button>
                              <button type="button" onClick={() => addTableColumn(index)}>
                                <Plus size={13} />
                                <span>列</span>
                              </button>
                            </div>
                            <textarea
                              className="block-textarea block-table-source"
                              rows={1}
                              value={textareaValue}
                              tabIndex={-1}
                              aria-hidden="true"
                              onChange={(event) => handleTextChange(index, event.target.value)}
                              onKeyDown={(event) => handleTextareaKeyDown(event, index)}
                            />
                          </div>
                        ) : (
                          <div className="block-textarea-stack">
                            {blockSearchQuery && (
                              <div
                                className={[
                                  'block-textarea-highlight',
                                  `block-textarea-highlight-${block.type}`,
                                  ['code_block', 'frontmatter', 'html_block', 'math_block', 'table'].includes(block.type) ? 'is-mono' : '',
                                ].filter(Boolean).join(' ')}
                                aria-hidden="true"
                              >
                                {renderSearchHighlight(textareaValue, blockSearchQuery)}
                              </div>
                            )}
                            <textarea
                              ref={(node) => {
                                textareasRef.current[index] = node;
                                if (!node || node.dataset.blockResizeKey === textareaResizeKey) return;
                                node.dataset.blockResizeKey = textareaResizeKey;
                                resizeTextarea(node);
                              }}
                              className={textareaClassName(block)}
                              rows={1}
                              value={textareaValue}
                              placeholder={block.type === 'empty' ? '输入 / 添加块，或直接开始写作' : block.type === 'image' ? '图片描述' : '输入内容'}
                              spellCheck
                              onChange={(event) => handleTextChange(index, event.target.value)}
                              onInput={(event) => resizeTextarea(event.currentTarget)}
                              onFocus={() => {
                                setSelectedIndex(index);
                                setSelectedIndices([index]);
                              }}
                              onKeyDown={(event) => handleTextareaKeyDown(event, index)}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </div>
                        )}
                      </>
                    )}

                    {isPrimarySelected && (
                      <div className="block-toolbar" onClick={(event) => event.stopPropagation()}>
                        <button type="button" onClick={(event) => openBlockAIPopover(event, index)} title="AI 处理">
                          <Sparkles size={14} />
                          <span>AI</span>
                        </button>
                        <select
                          value={block.type}
                          onChange={(event) => convertSelectedBlock(index, event.target.value as BlockType)}
                          aria-label="转换块格式"
                        >
                          {CONVERT_OPTIONS.map(option => (
                            <option key={option.type} value={option.type}>{option.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => moveSelectedBlocksBy(-1)}
                          disabled={selectionForThisBlock[0] === 0}
                          title="上移"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSelectedBlocksBy(1)}
                          disabled={selectionForThisBlock[selectionForThisBlock.length - 1] === blocks.length - 1}
                          title="下移"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button type="button" onClick={() => duplicateBlocksAt(selectionForThisBlock)} title="复制块">
                          <Copy size={14} />
                        </button>
                        <button type="button" className="is-danger" onClick={() => deleteBlocksAt(selectionForThisBlock)} title="删除块">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}

                    {isSlashOpen && (
                      <div className="slash-command-menu" onClick={(event) => event.stopPropagation()}>
                        {filteredCommands.map((command, commandIndex) => (
                          <button
                            key={command.id}
                            type="button"
                            className={commandIndex === slash.activeIndex ? 'is-active' : ''}
                            onMouseEnter={() => setSlash(current => current ? { ...current, activeIndex: commandIndex } : current)}
                            onClick={() => applySlashCommand(command)}
                          >
                            <span className="slash-command-icon">{commandIcon(command)}</span>
                            <span className="slash-command-text">
                              <strong>{command.label}</strong>
                              <span>{command.description}</span>
                            </span>
                            <span className="slash-command-shortcut">{command.shortcutLabel}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {blockAI && (
        <div
          ref={blockAIRef}
          className="block-ai-popover"
          style={{ left: blockAI.x, top: blockAI.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="block-ai-head">
            <div className="block-ai-title">
              <Sparkles size={15} />
              <span>AI 处理</span>
            </div>
            <span className="block-ai-scope">{blockAIScopeLabel}</span>
            <button
              type="button"
              className="block-ai-icon-button"
              aria-label="关闭"
              onClick={() => setBlockAI(null)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="block-ai-quick-actions">
            {BLOCK_AI_OPTIONS.map(option => (
              <button
                key={option.action}
                type="button"
                onClick={() => runAIAction(option.action, blockAI.blockIndex)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="block-ai-prompt-wrap">
            <textarea
              ref={blockAIPromptRef}
              className="block-ai-prompt"
              value={blockAIPrompt}
              placeholder="输入自定义要求"
              spellCheck
              onChange={(event) => {
                setBlockAIPrompt(event.target.value);
                resizeAIPromptTextarea(event.currentTarget);
              }}
              onInput={(event) => resizeAIPromptTextarea(event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setBlockAI(null);
                  return;
                }
                if (event.key === 'Enter' && isPrimaryShortcut(event)) {
                  event.preventDefault();
                  runCustomBlockAI(blockAIPrompt, blockAI.blockIndex);
                }
              }}
            />
            <button
              type="button"
              className="block-ai-send"
              aria-label="发送"
              disabled={!blockAIPrompt.trim()}
              onClick={() => runCustomBlockAI(blockAIPrompt, blockAI.blockIndex)}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {blockMenu && (
        <div
          ref={blockMenuRef}
          className="block-context-menu"
          style={{ left: blockMenu.x, top: blockMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => runContextAction(() => duplicateBlocksAt(contextSelection))}>
            复制块
          </button>
          <button type="button" onClick={() => runContextAction(() => copyText(selectedMarkdown(contextSelection), '已复制为 Markdown'))}>
            复制为 Markdown
          </button>
          <button type="button" onClick={() => runContextAction(() => copyText(selectedPlainText(contextSelection), '已复制为纯文本'))}>
            复制为纯文本
          </button>
          <span className="block-context-menu-separator" />
          <button type="button" onClick={() => runContextAction(() => insertBlockBefore(blockMenu.blockIndex))}>
            在上方插入块
          </button>
          <button type="button" onClick={() => runContextAction(() => insertBlockAfter(blockMenu.blockIndex))}>
            在下方插入块
          </button>
          <span className="block-context-menu-separator" />
          <button type="button" onClick={() => runContextAction(() => convertBlocksAt(contextSelection, 'blockquote'))}>
            转换为引用
          </button>
          <button type="button" onClick={() => runContextAction(() => convertBlocksAt(contextSelection, 'callout'))}>
            转换为 Callout
          </button>
          <button type="button" onClick={() => runContextAction(() => convertBlocksAt(contextSelection, 'bulleted_list_item'))}>
            转换为列表
          </button>
          <span className="block-context-menu-separator" />
          <button type="button" className="is-danger" onClick={() => runContextAction(() => deleteBlocksAt(contextSelection))}>
            删除块
          </button>
        </div>
      )}
    </section>
  );
}

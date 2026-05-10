import { createAIId, nowIso } from './id';
import type { AIContextSnapshot, AIContextSource, BuildAIContextOptions, CursorAroundText, EditorRange } from '../types';

const DEFAULT_CURSOR_AROUND_CHARS = 800;
const MAX_DOCUMENT_CONTEXT_CHARS = 60000;

function pushUnique(sources: AIContextSource[], source: AIContextSource): void {
  if (!sources.includes(source)) sources.push(source);
}

function getCursorAroundRange(
  documentContent: string,
  range: EditorRange,
  beforeChars = DEFAULT_CURSOR_AROUND_CHARS,
  afterChars = DEFAULT_CURSOR_AROUND_CHARS,
): CursorAroundText {
  const from = Math.max(0, Math.min(range.from, documentContent.length));
  const to = Math.max(from, Math.min(range.to, documentContent.length));
  return {
    beforeText: documentContent.slice(Math.max(0, from - beforeChars), from),
    afterText: documentContent.slice(to, Math.min(documentContent.length, to + afterChars)),
  };
}

export async function buildAIContext(options: BuildAIContextOptions): Promise<AIContextSnapshot> {
  const { editor, strategy } = options;
  const documentContent = editor.getDocumentContent();
  const selection = options.selection ?? editor.getSelection();
  const selectedText = selection?.text.trim() ? selection.text : '';
  const cursorAround = selection?.range
    ? getCursorAroundRange(documentContent, selection.range)
    : editor.getCursorTextAround({
        beforeChars: DEFAULT_CURSOR_AROUND_CHARS,
        afterChars: DEFAULT_CURSOR_AROUND_CHARS,
      });
  const includedSources: AIContextSource[] = [];

  const snapshot: AIContextSnapshot = {
    id: createAIId('ctx'),
    documentId: options.documentId,
    documentPath: options.documentPath,
    documentTitle: options.documentTitle,
    includedSources,
    createdAt: nowIso(),
  };

  if (options.documentTitle || options.documentPath) {
    pushUnique(includedSources, 'document_meta');
  }

  if (options.manualInput?.trim()) {
    pushUnique(includedSources, 'manual_input');
  }

  if (strategy === 'selection_only' || strategy === 'selection_with_cursor') {
    if (selectedText) {
      snapshot.selectedText = selectedText;
      snapshot.selectedTextLength = Array.from(selectedText).length;
      snapshot.selectionRange = selection?.range;
      pushUnique(includedSources, 'selected_text');
    }
  }

  if (strategy === 'selection_with_cursor') {
    if (cursorAround.beforeText || cursorAround.afterText) {
      snapshot.cursorBeforeText = cursorAround.beforeText;
      snapshot.cursorAfterText = cursorAround.afterText;
      pushUnique(includedSources, 'cursor_around');
    }
  }

  if (strategy === 'current_document' || strategy === 'document_summary') {
    const limitedContent = documentContent.length > MAX_DOCUMENT_CONTEXT_CHARS
      ? documentContent.slice(0, MAX_DOCUMENT_CONTEXT_CHARS)
      : documentContent;
    snapshot.documentContent = limitedContent;
    snapshot.documentContentLength = Array.from(documentContent).length;
    pushUnique(includedSources, 'current_document');
  }

  return snapshot;
}

export function describeContextSource(source: AIContextSource): string {
  const labels: Record<AIContextSource, string> = {
    selected_text: '选中文本',
    cursor_around: '光标附近',
    current_document: '当前文档',
    document_meta: '文件信息',
    manual_input: '手动输入',
  };
  return labels[source];
}

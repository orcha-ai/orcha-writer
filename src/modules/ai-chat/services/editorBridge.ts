import { getActiveEditorView } from '../../../components/Editor';
import type { CursorAroundOptions, EditorBridge, EditorRange, EditorSelection } from '../types';

function clampRange(range: EditorRange, length: number): EditorRange {
  const from = Math.max(0, Math.min(range.from, length));
  const to = Math.max(from, Math.min(range.to, length));
  return { from, to };
}

function flashRangeInView(range: EditorRange, duration = 1200): void {
  const view = getActiveEditorView();
  if (!view) return;
  const target = clampRange(range, view.state.doc.length);
  if (target.from === target.to) return;

  view.dispatch({
    selection: { anchor: target.from, head: target.to },
    scrollIntoView: true,
  });
  view.focus();

  window.setTimeout(() => {
    if (!view.dom.isConnected) return;
    if (view.state.selection.main.from !== target.from || view.state.selection.main.to !== target.to) return;
    view.dispatch({
      selection: { anchor: target.to, head: target.to },
    });
  }, duration);
}

function getSelectionFromActiveView(): EditorSelection | null {
  const view = getActiveEditorView();
  if (!view) return null;
  const selection = view.state.selection.main;
  if (selection.empty) return null;

  const from = Math.min(selection.from, selection.to);
  const to = Math.max(selection.from, selection.to);
  const text = view.state.doc.sliceString(from, to);
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);

  const rect = start && end
    ? {
        left: Math.min(start.left, end.left),
        top: Math.min(start.top, end.top),
        width: Math.max(24, Math.abs(end.left - start.left)),
        height: Math.max(start.bottom, end.bottom) - Math.min(start.top, end.top),
      }
    : undefined;

  return {
    range: { from, to },
    text,
    rect,
  };
}

export function createCodeMirrorEditorBridge(): EditorBridge {
  return {
    getDocumentContent() {
      return getActiveEditorView()?.state.doc.toString() || '';
    },
    getSelection() {
      return getSelectionFromActiveView();
    },
    getSelectedText() {
      return getSelectionFromActiveView()?.text || '';
    },
    getTextInRange(range) {
      const view = getActiveEditorView();
      if (!view) return '';
      const { from, to } = clampRange(range, view.state.doc.length);
      return view.state.doc.sliceString(from, to);
    },
    getCursorTextAround(options?: CursorAroundOptions) {
      const view = getActiveEditorView();
      if (!view) return { beforeText: '', afterText: '' };
      const beforeChars = options?.beforeChars ?? 800;
      const afterChars = options?.afterChars ?? 800;
      const head = view.state.selection.main.head;
      const doc = view.state.doc;
      return {
        beforeText: doc.sliceString(Math.max(0, head - beforeChars), head),
        afterText: doc.sliceString(head, Math.min(doc.length, head + afterChars)),
      };
    },
    restoreSelection(range) {
      const view = getActiveEditorView();
      if (!view) return;
      const { from, to } = clampRange(range, view.state.doc.length);
      view.dispatch({
        selection: { anchor: from, head: to },
        scrollIntoView: true,
      });
      view.focus();
    },
    insertAtCursor(text: string) {
      const view = getActiveEditorView();
      if (!view) return null;
      const selection = view.state.selection.main;
      const insertAt = selection.head;
      view.dispatch({
        changes: { from: insertAt, insert: text },
        selection: { anchor: insertAt + text.length },
        scrollIntoView: true,
      });
      view.focus();
      return { from: insertAt, to: insertAt + text.length };
    },
    replaceRange(range, text: string) {
      const view = getActiveEditorView();
      if (!view) return null;
      const { from, to } = clampRange(range, view.state.doc.length);
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
      });
      view.focus();
      return { from, to: from + text.length };
    },
    replaceSelection(text: string) {
      const view = getActiveEditorView();
      if (!view) return null;
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + text.length },
        scrollIntoView: true,
      });
      view.focus();
      return { from: selection.from, to: selection.from + text.length };
    },
    appendToDocument(text: string) {
      const view = getActiveEditorView();
      if (!view) return null;
      const doc = view.state.doc;
      const insert = `${doc.length > 0 ? '\n\n' : ''}${text}`;
      const from = doc.length;
      view.dispatch({
        changes: { from, insert },
        selection: { anchor: from + insert.length },
        scrollIntoView: true,
      });
      view.focus();
      return { from, to: from + insert.length };
    },
    flashRange(range) {
      flashRangeInView(range);
    },
    focusEditor() {
      getActiveEditorView()?.focus();
    },
  };
}

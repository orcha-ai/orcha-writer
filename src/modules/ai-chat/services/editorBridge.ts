import { getActiveEditorView } from '../../../components/Editor';
import type { CursorAroundOptions, EditorBridge, EditorSelection } from '../types';

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
      const from = Math.max(0, Math.min(range.from, view.state.doc.length));
      const to = Math.max(from, Math.min(range.to, view.state.doc.length));
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
      const from = Math.max(0, Math.min(range.from, view.state.doc.length));
      const to = Math.max(from, Math.min(range.to, view.state.doc.length));
      view.dispatch({
        selection: { anchor: from, head: to },
        scrollIntoView: true,
      });
      view.focus();
    },
    insertAtCursor(text: string) {
      const view = getActiveEditorView();
      if (!view) return;
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.head, insert: text },
        selection: { anchor: selection.head + text.length },
        scrollIntoView: true,
      });
      view.focus();
    },
    replaceRange(range, text: string) {
      const view = getActiveEditorView();
      if (!view) return;
      const from = Math.max(0, Math.min(range.from, view.state.doc.length));
      const to = Math.max(from, Math.min(range.to, view.state.doc.length));
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        scrollIntoView: true,
      });
      view.focus();
    },
    replaceSelection(text: string) {
      const view = getActiveEditorView();
      if (!view) return;
      const selection = view.state.selection.main;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: text },
        selection: { anchor: selection.from + text.length },
        scrollIntoView: true,
      });
      view.focus();
    },
    appendToDocument(text: string) {
      const view = getActiveEditorView();
      if (!view) return;
      const doc = view.state.doc;
      const insert = `${doc.length > 0 ? '\n\n' : ''}${text}`;
      view.dispatch({
        changes: { from: doc.length, insert },
        selection: { anchor: doc.length + insert.length },
        scrollIntoView: true,
      });
      view.focus();
    },
    focusEditor() {
      getActiveEditorView()?.focus();
    },
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorSelection } from '@codemirror/state';
import { getActiveEditorView } from './Editor';
import { useSettingsStore } from '../store';
import { getLocaleText } from '../i18n';

interface ContextMenuState {
  x: number;
  y: number;
  isEditable: boolean;
  inCodeMirror: boolean;
  hasSelection: boolean;
  canSelectAll: boolean;
}

type ContextAction = 'cut' | 'copy' | 'paste' | 'selectAll';

function isTextInput(target: Element | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function getSelectedText(inCodeMirror: boolean): string {
  if (inCodeMirror) {
    const view = getActiveEditorView();
    if (view) {
      return view.state.selection.ranges
        .map(range => view.state.sliceDoc(range.from, range.to))
        .join('\n');
    }
  }
  return window.getSelection()?.toString() || '';
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  document.execCommand('copy');
}

async function readClipboard(): Promise<string> {
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  return '';
}

function replaceCodeMirrorSelection(text: string): boolean {
  const view = getActiveEditorView();
  if (!view) return false;
  view.focus();
  view.dispatch(view.state.replaceSelection(text));
  return true;
}

function deleteCodeMirrorSelection(): boolean {
  const view = getActiveEditorView();
  if (!view || view.state.selection.main.empty) return false;
  view.focus();
  view.dispatch(view.state.changeByRange(range => ({
    changes: { from: range.from, to: range.to, insert: '' },
    range: EditorSelection.cursor(range.from),
  })));
  return true;
}

function selectAllCodeMirror(): boolean {
  const view = getActiveEditorView();
  if (!view) return false;
  view.focus();
  view.dispatch({
    selection: EditorSelection.single(0, view.state.doc.length),
    scrollIntoView: true,
  });
  return true;
}

function shouldUseCustomMenu(target: Element | null): boolean {
  if (!target) return false;
  if (target.closest('.context-menu')) return false;
  if (target.closest('.sidebar')) return false;
  if (target.closest('.tab-bar')) return false;
  return Boolean(
    target.closest('.editor-container')
    || target.closest('.search-panel')
    || target.closest('.ai-chat-panel')
    || target.closest('.settings-shell')
  );
}

export default function GlobalContextMenu() {
  const language = useSettingsStore(s => s.general.language);
  const text = getLocaleText(language);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!shouldUseCustomMenu(target)) return;

      const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
      const input = isTextInput(target) ? target : isTextInput(activeElement) ? activeElement : null;
      const inCodeMirror = Boolean(target?.closest('.cm-editor'));
      const isEditable = Boolean(input || inCodeMirror || target?.closest('[contenteditable="true"]'));
      const hasSelection = Boolean(getSelectedText(inCodeMirror).trim());
      const canSelectAll = Boolean(input || getActiveEditorView());

      event.preventDefault();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        isEditable,
        inCodeMirror,
        hasSelection,
        canSelectAll,
      });
    };

    const handleDismiss = (event: Event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('mousedown', handleDismiss, true);
    document.addEventListener('wheel', handleDismiss, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('mousedown', handleDismiss, true);
      document.removeEventListener('wheel', handleDismiss);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeMenu]);

  const runAction = useCallback(async (action: ContextAction) => {
    const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
    const input = isTextInput(activeElement) ? activeElement : null;
    const inCodeMirror = Boolean(activeElement?.closest('.cm-editor')) || Boolean(menu?.inCodeMirror);

    if (action === 'copy') {
      const selectedText = getSelectedText(inCodeMirror);
      if (selectedText) await writeClipboard(selectedText);
    }

    if (action === 'cut') {
      const selectedText = getSelectedText(inCodeMirror);
      if (!selectedText) return;
      await writeClipboard(selectedText);
      if (inCodeMirror) deleteCodeMirrorSelection();
      else document.execCommand('cut');
    }

    if (action === 'paste') {
      const clipboardText = await readClipboard();
      if (inCodeMirror && clipboardText) replaceCodeMirrorSelection(clipboardText);
      else if (input) document.execCommand('paste');
    }

    if (action === 'selectAll') {
      if (input) input.select();
      else selectAllCodeMirror();
    }

    closeMenu();
  }, [closeMenu, menu?.inCodeMirror]);

  const items = useMemo(() => {
    if (!menu) return [];
    return [
      { key: 'cut' as const, label: text.contextMenu.cut, disabled: !menu.isEditable || !menu.hasSelection },
      { key: 'copy' as const, label: text.contextMenu.copy, disabled: !menu.hasSelection },
      { key: 'paste' as const, label: text.contextMenu.paste, disabled: !menu.isEditable },
      { key: 'selectAll' as const, label: text.contextMenu.selectAll, disabled: !menu.canSelectAll },
    ];
  }, [menu, text]);

  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <div
          key={item.key}
          className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
          onClick={() => { if (!item.disabled) void runAction(item.key); }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}

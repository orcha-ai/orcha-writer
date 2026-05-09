import { useEffect, useRef, useCallback } from 'react';
import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, highlightSpecialChars, rectangularSelection, crosshairCursor, dropCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { search } from '@codemirror/search';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { message } from 'antd';
import type { TabFile } from '../types';
import { ensureDir, writeBinaryFile } from '../utils/fs';

export function ScrollSyncProvider({ children }: { children: React.ReactNode }) {
  return children;
}

export function useScrollSync() {
  return null;
}

let activeView: EditorView | null = null;
export function getActiveEditorView(): EditorView | null { return activeView; }

let pastedImageSerial = 0;

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function imageExtension(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName;
  }
  if (file.type === 'image/jpeg') return 'jpg';
  if (file.type === 'image/gif') return 'gif';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'image/svg+xml') return 'svg';
  if (file.type === 'image/bmp') return 'bmp';
  return 'png';
}

function makePastedImageFileName(file: File): string {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  pastedImageSerial += 1;
  return `pasted-${timestamp}-${pastedImageSerial}.${imageExtension(file)}`;
}

function relativePath(fromDir: string, toPath: string): string {
  const from = fromDir.replace(/\\/g, '/').split('/').filter(Boolean);
  const to = toPath.replace(/\\/g, '/').split('/').filter(Boolean);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1;
  }
  if (common === 0) return toPath.replace(/\\/g, '/');
  return [
    ...Array.from({ length: from.length - common }, () => '..'),
    ...to.slice(common),
  ].join('/') || './';
}

function formatMarkdownUrl(url: string): string {
  const normalized = url.replace(/\\/g, '/');
  return /[\s()<>]/.test(normalized) ? `<${normalized.replace(/>/g, '%3E')}>` : normalized;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function getPastedImageTarget(
  file: File,
  action: 'assets' | 'workspace-assets' | 'original',
  activeTab: TabFile | undefined,
  workspacePath: string | null
): { dir: string; filePath: string; markdownPath: string; fileName: string } | null {
  if (action === 'original') return null;

  const hasSavedDocument = Boolean(activeTab && !activeTab.isDraft && /[/\\]/.test(activeTab.path));
  const documentDir = hasSavedDocument && activeTab ? dirname(activeTab.path) : '';
  const assetRoot = action === 'workspace-assets' && workspacePath
    ? workspacePath
    : documentDir;

  if (!assetRoot) return null;

  const fileName = makePastedImageFileName(file);
  const dir = `${assetRoot}/.assets`;
  const filePath = `${dir}/${fileName}`;
  const markdownPath = documentDir ? relativePath(documentDir, filePath) : filePath;

  return { dir, filePath, markdownPath, fileName };
}

function insertMarkdownImage(view: EditorView, markdownPath: string, alt: string): void {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const needsLeadingBreak = line.text.trim().length > 0 && selection.from > line.from;
  const insert = `${needsLeadingBreak ? '\n' : ''}![${alt}](${formatMarkdownUrl(markdownPath)})\n`;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + insert.length },
    scrollIntoView: true,
  });
  view.focus();
}

const orchaTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--editor-font-size, 14px)',
    fontFamily: 'var(--editor-font-family, var(--font-sans))',
  },
  '.cm-content': {
    padding: '16px',
    caretColor: 'var(--accent)',
  },
  '.cm-line': {
    padding: '0',
    lineHeight: 'var(--editor-line-height, 1.6)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-editor)',
    borderRight: '1px solid var(--border-primary)',
    padding: '16px 0',
  },
  '.cm-gutterElement': {
    padding: '0 8px 0 12px',
    fontSize: '12px',
    color: 'var(--text-tertiary)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
});

// Compartments for reconfigurable extensions
const lineNumbersCompartment = new Compartment();
const highlightActiveLineCompartment = new Compartment();
const lineWrappingCompartment = new Compartment();
const tabSizeCompartment = new Compartment();
const autoCompleteCompartment = new Compartment();

function getBaseExtensions() {
  return [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(defaultHighlightStyle),
    search(),
    drawSelection(),
    highlightSpecialChars(),
    rectangularSelection(),
    crosshairCursor(),
    dropCursor(),
    orchaTheme,
  ];
}

// Get the scroll container of the preview
function getPreviewScrollContainer(): { container: HTMLElement; content: HTMLElement } | null {
  const panel = document.querySelector('.preview-panel') as HTMLElement | null;
  const content = document.querySelector('.md-preview') as HTMLElement | null;
  if (!panel || !content) return null;
  return { container: panel, content };
}

// Sync preview scroll based on editor scroll ratio
function syncPreviewScroll(view: EditorView) {
  const result = getPreviewScrollContainer();
  if (!result) return;
  const { container } = result;

  const scroller = view.dom.querySelector('.cm-scroller') as HTMLElement;
  if (!scroller) return;

  const ratio = scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight || 1);

  const scrollMax = container.scrollHeight - container.clientHeight;
  if (scrollMax > 0) {
    container.scrollTop = ratio * scrollMax;
  }
}

// Click sync: scroll preview to show the heading at cursor position
function scrollPreviewToCursor(view: EditorView) {
  const result = getPreviewScrollContainer();
  if (!result) return;
  const { container, content } = result;

  const doc = view.state.doc;
  const offset = view.state.selection.main.head;

  let currentHeading = '';
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const m = line.text.match(/^(#{1,6})\s+(.*)/);
    if (m && line.from <= offset) {
      currentHeading = m[2].trim();
    }
    if (m && line.from > offset) break;
  }

  if (currentHeading) {
    const id = currentHeading.toLowerCase().replace(/[^\w一-鿿\s-]/g, '').replace(/\s+/g, '-');
    const el = content.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    if (el) {
      container.scrollTop = el.offsetTop;
      return;
    }
  }

  syncPreviewScroll(view);
}

export default function Editor() {
  const { state, dispatch } = useApp();
  const editor = useSettingsStore(s => s.editor);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);

  const syncEnabled = useRef(state.editorSettings.syncScroll);
  const mode = useRef(state.viewMode);
  const tabIdRef = useRef(activeTab?.id ?? '');
  const activeTabRef = useRef(activeTab);
  const workspacePathRef = useRef(state.workspacePath);
  const pasteImageActionRef = useRef(editor.pasteImageAction);
  useEffect(() => { tabIdRef.current = activeTab?.id ?? ''; }, [activeTab?.id]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { workspacePathRef.current = state.workspacePath; }, [state.workspacePath]);
  useEffect(() => { pasteImageActionRef.current = editor.pasteImageAction; }, [editor.pasteImageAction]);
  useEffect(() => { syncEnabled.current = state.editorSettings.syncScroll; }, [state.editorSettings.syncScroll]);
  useEffect(() => { mode.current = state.viewMode; }, [state.viewMode]);

  // rAF-based scroll handler for smooth sync
  let rafId = 0;
  const onEditorScroll = () => {
    if (!syncEnabled.current || mode.current === 'edit') return;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      if (viewRef.current) syncPreviewScroll(viewRef.current);
    });
  };

  // Debounce content updates
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef('');

  const flushContent = useCallback((id: string) => {
    const content = pendingRef.current;
    if (content != null && content !== lastSavedRef.current) {
      lastSavedRef.current = content;
      dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id, content } });
    }
    pendingRef.current = null;
    timerRef.current = null;
  }, [dispatch]);

  const handleUpdate = useCallback((updateView: EditorView) => {
    const docContent = updateView.state.doc.toString();
    const id = tabIdRef.current;
    if (!id) return;
    pendingRef.current = docContent;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushContent(id), 500);
  }, [flushContent]);

  const handlePasteImages = useCallback(async (files: File[], view: EditorView) => {
    let warnedFallback = false;

    for (const file of files) {
      try {
        const action = pasteImageActionRef.current;
        const target = getPastedImageTarget(file, action, activeTabRef.current, workspacePathRef.current);

        if (!target) {
          const dataUrl = await fileToDataUrl(file);
          insertMarkdownImage(view, dataUrl, stripExtension(file.name) || '图片');
          if (action !== 'original' && !warnedFallback) {
            warnedFallback = true;
            message.warning('当前文档还没有可写入的资源目录，已改为插入 Data URL');
          }
          continue;
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        await ensureDir(target.dir);
        await writeBinaryFile(target.filePath, bytes);
        insertMarkdownImage(view, target.markdownPath, stripExtension(file.name) || stripExtension(target.fileName) || '图片');
      } catch (error) {
        console.error('[Editor] Failed to paste image:', error);
        message.warning('粘贴图片失败');
      }
    }
  }, []);

  // Apply settings to an existing view via compartments
  const applySettings = useCallback((view: EditorView, settings: typeof editor) => {
    const effects: any[] = [];

    // Line numbers
    effects.push(
      lineNumbersCompartment.reconfigure(settings.showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : [])
    );

    // Highlight active line
    effects.push(
      highlightActiveLineCompartment.reconfigure(settings.highlightCurrentLine ? [highlightActiveLine()] : [])
    );

    // Line wrapping
    effects.push(
      lineWrappingCompartment.reconfigure(settings.autoWrap ? [EditorView.lineWrapping] : [])
    );

    // Tab size
    effects.push(
      tabSizeCompartment.reconfigure(EditorState.tabSize.of(settings.tabSize))
    );

    // Auto complete
    effects.push(
      autoCompleteCompartment.reconfigure(settings.autoComplete ? [autocompletion(), closeBrackets()] : [])
    );

    view.dispatch({ effects });

    // Spell check — apply via DOM attribute on the content element
    const contentEl = view.dom.querySelector('.cm-content') as HTMLElement | null;
    if (contentEl) {
      contentEl.setAttribute('spellcheck', settings.spellCheck ? 'true' : 'false');
    }
  }, []);

  useEffect(() => {
    if (!editorRef.current || !activeTab) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: activeTab.content,
        extensions: [
          ...getBaseExtensions(),
          lineNumbersCompartment.of(editor.showLineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
          highlightActiveLineCompartment.of(editor.highlightCurrentLine ? [highlightActiveLine()] : []),
          lineWrappingCompartment.of(editor.autoWrap ? [EditorView.lineWrapping] : []),
          tabSizeCompartment.of(EditorState.tabSize.of(editor.tabSize)),
          autoCompleteCompartment.of(editor.autoComplete ? [autocompletion(), closeBrackets()] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handleUpdate(update.view);
          }),
          EditorView.domEventHandlers({
            paste: (event, view) => {
              const clipboard = event.clipboardData;
              if (!clipboard) return false;

              const itemFiles = Array.from(clipboard.items)
                .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
                .map(item => item.getAsFile())
                .filter((file): file is File => Boolean(file));
              const files = itemFiles.length > 0
                ? itemFiles
                : Array.from(clipboard.files).filter(file => file.type.startsWith('image/'));

              if (files.length === 0) return false;
              event.preventDefault();
              void handlePasteImages(files, view);
              return true;
            },
            click: () => {
              if (mode.current !== 'edit' && viewRef.current) {
                scrollPreviewToCursor(viewRef.current);
              }
              return false;
            },
            blur: () => {
              const id = tabIdRef.current;
              if (id && pendingRef.current) flushContent(id);
            },
          }),
        ],
      }),
      parent: editorRef.current,
    });

    // Apply spellcheck attribute after creation
    const contentEl = view.dom.querySelector('.cm-content') as HTMLElement | null;
    if (contentEl) {
      contentEl.setAttribute('spellcheck', editor.spellCheck ? 'true' : 'false');
    }

    viewRef.current = view;
    activeView = view;

    const scroller = view.dom.querySelector('.cm-scroller');
    if (scroller) {
      scroller.addEventListener('scroll', onEditorScroll, { passive: true });
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (scroller) scroller.removeEventListener('scroll', onEditorScroll);
      view.destroy();
      viewRef.current = null;
      if (activeView === view) activeView = null;
    };
  }, [activeTab?.id, handleUpdate]);

  // Reconfigure settings when they change
  useEffect(() => {
    if (viewRef.current) {
      applySettings(viewRef.current, editor);
    }
  }, [editor.showLineNumbers, editor.highlightCurrentLine, editor.autoWrap, editor.tabSize, editor.autoComplete, editor.spellCheck, applySettings]);

  // Sync content changes only when switching tabs
  const lastSyncedContentRef = useRef('');
  useEffect(() => {
    if (!activeTab) return;
    lastSyncedContentRef.current = activeTab.content;
    lastSavedRef.current = activeTab.content;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
  }, [activeTab?.id]);

  // Sync viewMode changes
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.requestMeasure();
    }
  }, [state.viewMode]);

  if (!activeTab) return null;

  return (
    <div className={`editor-panel ${state.viewMode === 'preview' ? 'hidden' : ''}`}>
      <div ref={editorRef} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  );
}

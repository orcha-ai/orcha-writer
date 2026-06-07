/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useCallback } from 'react';
import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { EditorState, Compartment, type StateEffect } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, highlightSpecialChars, rectangularSelection, crosshairCursor, dropCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { search } from '@codemirror/search';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { message } from 'antd';
import { effectiveViewModeForDocument } from '../utils/documentCapabilities';
import { formatMarkdownImageUrl } from '../utils/markdownImages';
import {
  dataImageUrlsFromClipboardData,
  dataUrlToFile,
  extractImagePathsFromText,
  hasClipboardFileUrlHint,
  hasNativeClipboardImageHint,
  imageFilesFromClipboardData,
  imagePathsFromClipboardData,
  readClipboardImageFiles,
  readClipboardImagePaths,
  writePastedMarkdownImageFile,
  writePastedMarkdownImagePath,
} from '../utils/markdownImagePaste';
import type { EditorSelection } from '../modules/ai-chat/types/editor-bridge';
import { translateText } from '../i18n';

export function ScrollSyncProvider({ children }: { children: React.ReactNode }) {
  return children;
}

export function useScrollSync() {
  return null;
}

let activeView: EditorView | null = null;
export function getActiveEditorView(): EditorView | null { return activeView; }

type EditorSelectionListener = (selection: EditorSelection | null) => void;
const editorSelectionListeners = new Set<EditorSelectionListener>();

export function subscribeEditorSelection(listener: EditorSelectionListener): () => void {
  editorSelectionListeners.add(listener);
  listener(activeView ? readEditorSelection(activeView) : null);
  return () => editorSelectionListeners.delete(listener);
}

function readEditorSelection(view: EditorView): EditorSelection | null {
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

function emitEditorSelection(view: EditorView | null): void {
  const selection = view ? readEditorSelection(view) : null;
  editorSelectionListeners.forEach((listener) => listener(selection));
}

let activePasteClipboardImages: (() => Promise<boolean>) | null = null;
export async function pasteClipboardImagesIntoActiveEditor(): Promise<boolean> {
  return activePasteClipboardImages ? activePasteClipboardImages() : false;
}

export function registerActiveClipboardImagePasteHandler(handler: () => Promise<boolean>): () => void {
  activePasteClipboardImages = handler;
  return () => {
    if (activePasteClipboardImages === handler) activePasteClipboardImages = null;
  };
}

function insertMarkdownImage(view: EditorView, markdownPath: string, alt: string): void {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const needsLeadingBreak = line.text.trim().length > 0 && selection.from > line.from;
  const insert = `${needsLeadingBreak ? '\n' : ''}![${alt}](${formatMarkdownImageUrl(markdownPath)})\n`;
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

function countDocumentCharacters(content: string): number {
  return Array.from(content.replace(/\s/g, '')).length;
}

export default function Editor() {
  const { state, dispatch } = useApp();
  const editor = useSettingsStore(s => s.editor);
  const language = useSettingsStore(s => s.general.language);
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);
  const effectiveViewMode = effectiveViewModeForDocument(activeTab, state.viewMode);

  const syncEnabled = useRef(state.editorSettings.syncScroll);
  const mode = useRef(effectiveViewMode);
  const tabIdRef = useRef(activeTab?.id ?? '');
  const activeTabRef = useRef(activeTab);
  const workspacePathRef = useRef(state.workspacePath);
  const pasteImageActionRef = useRef(editor.pasteImageAction);
  const lastCursorRef = useRef({ line: state.cursorPosition.line, ch: state.cursorPosition.ch });
  const lastWordCountRef = useRef(state.wordCount);
  useEffect(() => { tabIdRef.current = activeTab?.id ?? ''; }, [activeTab?.id]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { workspacePathRef.current = state.workspacePath; }, [state.workspacePath]);
  useEffect(() => { pasteImageActionRef.current = editor.pasteImageAction; }, [editor.pasteImageAction]);
  useEffect(() => { syncEnabled.current = state.editorSettings.syncScroll; }, [state.editorSettings.syncScroll]);
  useEffect(() => { mode.current = effectiveViewMode; }, [effectiveViewMode]);

  // rAF-based scroll handler for smooth sync
  let rafId = 0;
  const onEditorScroll = () => {
    if (viewRef.current) emitEditorSelection(viewRef.current);
    if (!syncEnabled.current || mode.current === 'edit' || mode.current === 'block') return;
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

  const updateEditorStatus = useCallback((view: EditorView, includeWordCount: boolean) => {
    const selectionHead = view.state.selection.main.head;
    const line = view.state.doc.lineAt(selectionHead);
    const cursorPosition = {
      line: line.number,
      ch: selectionHead - line.from + 1,
    };

    if (
      cursorPosition.line !== lastCursorRef.current.line ||
      cursorPosition.ch !== lastCursorRef.current.ch
    ) {
      lastCursorRef.current = cursorPosition;
      dispatch({ type: 'SET_CURSOR', payload: cursorPosition });
    }

    if (includeWordCount) {
      const wordCount = countDocumentCharacters(view.state.doc.toString());
      if (wordCount !== lastWordCountRef.current) {
        lastWordCountRef.current = wordCount;
        dispatch({ type: 'SET_WORD_COUNT', payload: wordCount });
      }
    }
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
    const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);

    for (const file of files) {
      try {
        const action = pasteImageActionRef.current;
        const pastedImage = await writePastedMarkdownImageFile(file, {
          action,
          activeTab: activeTabRef.current,
          workspacePath: workspacePathRef.current,
        });

        insertMarkdownImage(view, pastedImage.markdownPath, pastedImage.alt || t('图片'));
        if (pastedImage.fallbackToDataUrl && !warnedFallback) {
          warnedFallback = true;
          message.warning(t('当前文档还没有可写入的资源目录，已改为插入 Data URL'));
        }
      } catch (error) {
        console.error('[Editor] Failed to paste image:', error);
        message.warning(t('粘贴图片失败'));
      }
    }
  }, [language]);

  const handlePasteImagePaths = useCallback(async (paths: string[], view: EditorView) => {
    let inserted = false;
    const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);

    for (const sourcePath of paths) {
      try {
        const action = pasteImageActionRef.current;
        const pastedImage = await writePastedMarkdownImagePath(sourcePath, {
          action,
          activeTab: activeTabRef.current,
          workspacePath: workspacePathRef.current,
        });
        insertMarkdownImage(view, pastedImage.markdownPath, pastedImage.alt || t('图片'));
        inserted = true;
      } catch (error) {
        console.error('[Editor] Failed to paste image file:', error);
        message.warning(t('粘贴图片文件失败'));
      }
    }

    return inserted;
  }, [language]);

  const pasteClipboardImages = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return false;
    try {
      const files = await readClipboardImageFiles();
      if (files.length > 0) {
        await handlePasteImages(files, view);
        return true;
      }

      const text = await navigator.clipboard?.readText?.().catch(() => '') || '';
      const paths = extractImagePathsFromText(text);
      if (paths.length > 0) {
        return handlePasteImagePaths(paths, view);
      }

      const nativePaths = await readClipboardImagePaths();
      if (nativePaths.length > 0) {
        return handlePasteImagePaths(nativePaths, view);
      }

      return false;
    } catch (error) {
      console.warn('[Editor] Failed to read clipboard images:', error);
      return false;
    }
  }, [handlePasteImagePaths, handlePasteImages]);

  // Apply settings to an existing view via compartments
  const applySettings = useCallback((view: EditorView, settings: typeof editor) => {
    const effects: StateEffect<unknown>[] = [];

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
            if (update.docChanged || update.selectionSet) updateEditorStatus(update.view, update.docChanged);
            if (update.docChanged || update.selectionSet || update.focusChanged) emitEditorSelection(update.view);
          }),
          EditorView.domEventHandlers({
            paste: (event, view) => {
              const clipboard = event.clipboardData;
              if (!clipboard) return false;
              const files = imageFilesFromClipboardData(clipboard);

              if (files.length > 0) {
                event.preventDefault();
                void handlePasteImages(files, view);
                return true;
              }

              const paths = imagePathsFromClipboardData(clipboard);
              if (paths.length > 0) {
                event.preventDefault();
                void handlePasteImagePaths(paths, view);
                return true;
              }

              if (hasClipboardFileUrlHint(clipboard)) {
                event.preventDefault();
                void readClipboardImagePaths().then(nativePaths => {
                  if (nativePaths.length > 0) {
                    void handlePasteImagePaths(nativePaths, view);
                  }
                });
                return true;
              }

              const dataImageUrls = dataImageUrlsFromClipboardData(clipboard);
              if (dataImageUrls.length > 0) {
                event.preventDefault();
                void Promise.all(dataImageUrls.map(dataUrlToFile))
                  .then(imageFiles => handlePasteImages(imageFiles.filter((file): file is File => file !== null), view));
                return true;
              }

              if (hasNativeClipboardImageHint(clipboard)) {
                event.preventDefault();
                void readClipboardImageFiles().then(nativeFiles => {
                  if (nativeFiles.length > 0) {
                    void handlePasteImages(nativeFiles, view);
                  }
                });
                return true;
              }

              return false;
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
    updateEditorStatus(view, true);
    emitEditorSelection(view);

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
      emitEditorSelection(null);
    };
  }, [activeTab?.id, handleUpdate, pasteClipboardImages, updateEditorStatus]);

  useEffect(() => {
    if (!viewRef.current || effectiveViewMode === 'block') return undefined;
    return registerActiveClipboardImagePasteHandler(pasteClipboardImages);
  }, [effectiveViewMode, pasteClipboardImages]);

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

  // Keep the hidden CodeMirror source view in sync with block/preview edits.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !activeTab) return;
    if (effectiveViewMode === 'block') return;
    const currentContent = view.state.doc.toString();
    if (currentContent === activeTab.content) return;

    lastSyncedContentRef.current = activeTab.content;
    lastSavedRef.current = activeTab.content;
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: activeTab.content },
    });
    updateEditorStatus(view, true);
  }, [activeTab?.content, activeTab?.id, effectiveViewMode, updateEditorStatus]);

  // Sync viewMode changes
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.requestMeasure();
    }
  }, [effectiveViewMode]);

  if (!activeTab) return null;

  return (
    <div className={`editor-panel ${effectiveViewMode === 'preview' || effectiveViewMode === 'block' ? 'hidden' : ''}`}>
      <div ref={editorRef} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  );
}

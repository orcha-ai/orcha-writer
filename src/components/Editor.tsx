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
import { copyFile, ensureDir, readClipboardFileUrls, readClipboardImage, writeBinaryFile } from '../utils/fs';
import { basename, dirname, formatMarkdownImageUrl, markdownImagePathForDocument, stripExtension } from '../utils/markdownImages';
import type { EditorSelection } from '../modules/ai-chat/types/editor-bridge';

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

let pastedImageSerial = 0;
const ORCHA_RESOURCE_DIR = '.orcha-writer/resources';

function isImageLikeType(type: string): boolean {
  return type.startsWith('image/') || type === 'public.tiff';
}

function imageExtensionFromType(type: string): string {
  if (type === 'public.tiff' || type === 'image/tiff') return 'tiff';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/svg+xml') return 'svg';
  const subtype = type.match(/^image\/([a-z0-9.+-]+)$/i)?.[1]?.toLowerCase();
  return subtype ? subtype.replace(/^x-/, '') : 'png';
}

function isImageFile(file: File): boolean {
  return isImageLikeType(file.type) || /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|avif|heic|heif)$/i.test(file.name);
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|avif|heic|heif)$/i.test(path.split(/[?#]/)[0]);
}

function decodeClipboardPath(value: string): string {
  const trimmed = value.trim();
  if (/^file:\/\//i.test(trimmed)) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return decodeURIComponent(trimmed.replace(/^file:\/\//i, ''));
    }
  }
  return trimmed;
}

function extractImagePathsFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(decodeClipboardPath)
    .filter(path => /^(?:\/|[A-Za-z]:[\\/])/.test(path) && isImagePath(path));
}

async function readClipboardImagePaths(): Promise<string[]> {
  const fileUrls = await readClipboardFileUrls().catch(() => []);
  return extractImagePathsFromText(fileUrls.join('\n'));
}

function extractDataImageUrlsFromHtml(html: string): string[] {
  const urls: string[] = [];
  const pattern = /<img\b[^>]*\bsrc=["'](data:image\/[^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    urls.push(match[1]);
  }
  return urls;
}

async function dataUrlToFile(dataUrl: string, index: number): Promise<File | null> {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  if (!match) return null;
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const extension = imageExtensionFromType(match[1]);
  return new File([blob], `clipboard-image-${index + 1}.${extension}`, { type: match[1] });
}

function imageExtension(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif'].includes(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName;
  }
  if (file.type) return imageExtensionFromType(file.type);
  return 'png';
}

function makePastedImageFileName(file: File): string {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  pastedImageSerial += 1;
  return `pasted-${timestamp}-${pastedImageSerial}.${imageExtension(file)}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function readClipboardImageFiles(): Promise<File[]> {
  const nativeImage = await readClipboardImage().catch(() => null);
  if (nativeImage?.bytes?.length) {
    return [
      new File(
        [new Uint8Array(nativeImage.bytes)],
        nativeImage.fileName || 'clipboard-image.png',
        { type: nativeImage.mimeType || 'image/png' },
      ),
    ];
  }

  if (!navigator.clipboard?.read) return [];

  const items = await navigator.clipboard.read();
  const files: File[] = [];

  for (const item of items) {
    const type = item.types.find(isImageLikeType);
    if (!type) continue;

    const blob = await item.getType(type);
    const mimeType = blob.type && isImageLikeType(blob.type)
      ? blob.type
      : type === 'public.tiff'
        ? 'image/tiff'
        : blob.type;
    const extension = imageExtensionFromType(mimeType || type);
    files.push(new File([blob], `clipboard-image.${extension}`, { type: mimeType }));
  }

  return files;
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
  const dir = `${assetRoot}/${ORCHA_RESOURCE_DIR}`;
  const filePath = `${dir}/${fileName}`;
  const markdownPath = activeTab ? markdownImagePathForDocument(filePath, activeTab.path) : filePath;

  return { dir, filePath, markdownPath, fileName };
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
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);

  const syncEnabled = useRef(state.editorSettings.syncScroll);
  const mode = useRef(state.viewMode);
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
  useEffect(() => { mode.current = state.viewMode; }, [state.viewMode]);

  // rAF-based scroll handler for smooth sync
  let rafId = 0;
  const onEditorScroll = () => {
    if (viewRef.current) emitEditorSelection(viewRef.current);
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

  const handlePasteImagePaths = useCallback(async (paths: string[], view: EditorView) => {
    let inserted = false;

    for (const sourcePath of paths) {
      try {
        const action = pasteImageActionRef.current;
        const sourceName = basename(sourcePath);
        const placeholder = new File([], sourceName || 'clipboard-image.png');
        const target = getPastedImageTarget(placeholder, action, activeTabRef.current, workspacePathRef.current);

        if (!target) {
          const markdownPath = markdownImagePathForDocument(sourcePath, activeTabRef.current?.path);
          insertMarkdownImage(view, markdownPath, stripExtension(sourceName) || '图片');
          inserted = true;
          continue;
        }

        await ensureDir(target.dir);
        await copyFile(sourcePath, target.filePath);
        insertMarkdownImage(view, target.markdownPath, stripExtension(sourceName) || stripExtension(target.fileName) || '图片');
        inserted = true;
      } catch (error) {
        console.error('[Editor] Failed to paste image file:', error);
        message.warning('粘贴图片文件失败');
      }
    }

    return inserted;
  }, []);

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
            if (update.docChanged || update.selectionSet) updateEditorStatus(update.view, update.docChanged);
            if (update.docChanged || update.selectionSet || update.focusChanged) emitEditorSelection(update.view);
          }),
          EditorView.domEventHandlers({
            paste: (event, view) => {
              const clipboard = event.clipboardData;
              if (!clipboard) return false;
              const clipboardTypes = Array.from(clipboard.types);
              const plainText = clipboard.getData('text/plain');
              const uriText = clipboard.getData('text/uri-list');
              const htmlText = clipboard.getData('text/html');

              const itemFiles = Array.from(clipboard.items)
                .filter(item => item.kind === 'file' && isImageLikeType(item.type))
                .map(item => item.getAsFile())
                .filter((file): file is File => file !== null && isImageFile(file));
              const files = itemFiles.length > 0
                ? itemFiles
                : Array.from(clipboard.files).filter(isImageFile);

              if (files.length > 0) {
                event.preventDefault();
                void handlePasteImages(files, view);
                return true;
              }

              const paths = extractImagePathsFromText(uriText || plainText);
              if (paths.length > 0) {
                event.preventDefault();
                void handlePasteImagePaths(paths, view);
                return true;
              }

              const hasFileUrlHint = clipboardTypes.some(type => type === 'Files' || /file-url/i.test(type));
              if (hasFileUrlHint) {
                event.preventDefault();
                void readClipboardImagePaths().then(nativePaths => {
                  if (nativePaths.length > 0) {
                    void handlePasteImagePaths(nativePaths, view);
                  }
                });
                return true;
              }

              const dataImageUrls = extractDataImageUrlsFromHtml(htmlText);
              if (dataImageUrls.length > 0) {
                event.preventDefault();
                void Promise.all(dataImageUrls.map(dataUrlToFile))
                  .then(imageFiles => handlePasteImages(imageFiles.filter((file): file is File => file !== null), view));
                return true;
              }

              const hasNativeImageHint = clipboardTypes.some(type => (
                type === 'Files' ||
                isImageLikeType(type) ||
                /(?:image|file|public\.tiff)/i.test(type)
              ));
              if (hasNativeImageHint || (!plainText && !uriText && !htmlText)) {
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
    activePasteClipboardImages = pasteClipboardImages;
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
      if (activePasteClipboardImages === pasteClipboardImages) activePasteClipboardImages = null;
      emitEditorSelection(null);
    };
  }, [activeTab?.id, handleUpdate, pasteClipboardImages, updateEditorStatus]);

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

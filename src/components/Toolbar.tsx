import { useApp } from '../AppContext';
import { useNavigate } from 'react-router-dom';
import {
  FilePlus,
  FolderOpen,
  FileText,
  Save,
  Search,
  Eye,
  Edit3,
  Columns,
  Sun,
  Moon,
  Monitor,
  Settings,
  ScrollText,
} from 'lucide-react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import { open as openPath } from '@tauri-apps/plugin-shell';
import { message } from 'antd';
import { redo, undo } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { pathExists, readTextFile, writeTextFile } from '../utils/fs';
import { findFirstMdFile, readFirstLevel } from '../utils/workspace';
import { getActiveEditorView, pasteClipboardImagesIntoActiveEditor } from './Editor';
import { effectiveViewModeForDocument, isMarkdownDocument, isMarkdownViewMode } from '../utils/documentCapabilities';
import { basename, formatMarkdownImageUrl, markdownImagePathForDocument, stripExtension } from '../utils/markdownImages';
import { renderMarkdownForExport } from '../utils/exportMarkdown';
import { confirmCloseTabs } from '../utils/unsavedTabs';
import {
  availableTextFilePath,
  decodeDialogPath,
  ensureTextFileExtension,
  fileNameFromPath,
  getPreviewFileKind,
  getTextFileDialogFilters,
  normalizeTextFileName,
} from '../utils/savePaths';
import { useSettingsStore, useShortcutStore } from '../store';
import type { ThemeMode, ViewMode } from '../types';
import { runUpdateCheckFlow } from '../utils/updateUi';
import { isEnglishLanguage, translateText } from '../i18n';

function normalizeThemeColor(color: string | undefined): string {
  const value = color?.trim();
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#0A84FF';
}

const shortcutModifiers = new Set(['Meta', 'Ctrl', 'Alt', 'Shift']);

function normalizeShortcutKey(key: string): string {
  if (key === ' ') return 'Space';
  return key.length === 1 ? key.toUpperCase() : key;
}

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut) return false;
  const parts = shortcut.split('+').map(part => part.trim()).filter(Boolean);
  const key = parts.find(part => !shortcutModifiers.has(part));
  if (!key) return false;

  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const wantsMeta = parts.includes('Meta');
  const wantsCtrl = parts.includes('Ctrl');
  const expectedMeta = isMac && wantsMeta;
  const expectedCtrl = wantsCtrl || (!isMac && wantsMeta);

  return event.metaKey === expectedMeta
    && event.ctrlKey === expectedCtrl
    && event.altKey === parts.includes('Alt')
    && event.shiftKey === parts.includes('Shift')
    && normalizeShortcutKey(event.key) === normalizeShortcutKey(key);
}

function isEditableElement(element: Element | null): boolean {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || Boolean(element?.closest('[contenteditable="true"]'));
}

function isPrimarySelectAllShortcut(event: KeyboardEvent): boolean {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const primaryPressed = isMac ? event.metaKey : event.ctrlKey;
  const secondaryPressed = isMac ? event.ctrlKey : event.metaKey;

  return primaryPressed
    && !secondaryPressed
    && !event.altKey
    && !event.shiftKey
    && normalizeShortcutKey(event.key) === 'A';
}

function hasFileDragData(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types ?? []).includes('Files');
}

function dataTransferFilePaths(dataTransfer: DataTransfer | null): string[] {
  return Array.from(dataTransfer?.files ?? [])
    .map(file => (file as File & { path?: string }).path || file.webkitRelativePath)
    .filter((path): path is string => Boolean(path && /^(?:file:\/\/|\/|[A-Za-z]:[\\/])/.test(path)));
}

function selectedEditorText(): string {
  const view = getActiveEditorView();
  if (!view) return window.getSelection()?.toString() || '';
  return view.state.selection.ranges
    .map(range => view.state.sliceDoc(range.from, range.to))
    .join('\n');
}

function insertTextInEditor(text: string): boolean {
  const view = getActiveEditorView();
  if (!view) return false;
  view.focus();
  view.dispatch(view.state.replaceSelection(text));
  return true;
}

function deleteEditorSelection(): boolean {
  const view = getActiveEditorView();
  if (!view || view.state.selection.main.empty) return false;
  view.focus();
  view.dispatch(view.state.changeByRange(range => ({
    changes: { from: range.from, to: range.to, insert: '' },
    range: EditorSelection.cursor(range.from),
  })));
  return true;
}

function selectAllEditorContent(): boolean {
  const view = getActiveEditorView();
  if (!view) return false;
  view.focus();
  view.dispatch({
    selection: EditorSelection.single(0, view.state.doc.length),
    scrollIntoView: true,
  });
  return true;
}

async function canWriteExportPath(path: string, overwriteExisting: boolean, existingMessage: string): Promise<boolean> {
  if (overwriteExisting) return true;
  if (!(await pathExists(path))) return true;
  message.warning(existingMessage);
  return false;
}

function printHtmlDocument(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';

    const cleanup = () => {
      setTimeout(() => frame.remove(), 1000);
    };

    frame.onload = () => {
      setTimeout(() => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        cleanup();
        resolve();
      }, 80);
    };

    document.body.appendChild(frame);
    frame.srcdoc = html;
  });
}

export default function Toolbar() {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const updateAppearance = useSettingsStore(s => s.updateAppearance);
  const updatePreview = useSettingsStore(s => s.updatePreview);
  const saveSettings = useSettingsStore(s => s.saveAll);
  const exportSettings = useSettingsStore(s => s.export);
  const fileSettings = useSettingsStore(s => s.files);
  const language = useSettingsStore(s => s.general.language);
  const themeColor = useSettingsStore(s => s.appearance.themeColor);
  const shortcuts = useShortcutStore(s => s.shortcuts);
  const [isDragging, setIsDragging] = useState(false);
  const recentOpenedPathRef = useRef<Map<string, number>>(new Map());
  const t = useCallback((value: string, params?: Record<string, string | number>) => (
    translateText(language, value, params)
  ), [language]);
  const isEnglish = isEnglishLanguage(language);
  const textFileDialogFilters = useMemo(() => getTextFileDialogFilters(language), [language]);
  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
  const markdownViewModesAvailable = !activeTab || isMarkdownDocument(activeTab);
  const effectiveViewMode = effectiveViewModeForDocument(activeTab, state.viewMode);
  const markdownOnlyViewTooltip = t('仅 Markdown 文档支持块编辑、预览和双栏');
  const sourceModeTooltip = activeTab && !markdownViewModesAvailable ? t('源码模式') : t('MD 源码模式');
  const sourceModeLabel = activeTab && !markdownViewModesAvailable ? t('源码') : t('MD 源码');

  const setDocumentViewMode = useCallback((mode: ViewMode) => {
    if (activeTab && isMarkdownViewMode(mode) && !isMarkdownDocument(activeTab)) {
      dispatch({ type: 'SET_VIEW_MODE', payload: 'edit' });
      message.info(markdownOnlyViewTooltip);
      return;
    }
    dispatch({ type: 'SET_VIEW_MODE', payload: mode });
  }, [activeTab, dispatch, markdownOnlyViewTooltip]);

  const setThemeMode = useCallback((themeMode: ThemeMode) => {
    dispatch({ type: 'SET_THEME', payload: themeMode });
    updateAppearance({ themeMode });
    void saveSettings();
  }, [dispatch, updateAppearance, saveSettings]);

  const toggleSyncScroll = useCallback(() => {
    const syncScroll = !state.editorSettings.syncScroll;
    dispatch({ type: 'UPDATE_SETTINGS', payload: { syncScroll } });
    updatePreview({ syncScroll });
    void saveSettings();
  }, [dispatch, saveSettings, state.editorSettings.syncScroll, updatePreview]);

  const setSidebarVisible = useCallback((visible: boolean) => {
    dispatch({ type: 'SET_SIDEBAR_VISIBLE', payload: visible });
    updateAppearance({ showSidebar: visible });
    void saveSettings();
  }, [dispatch, saveSettings, updateAppearance]);

  const toggleSidebar = useCallback(() => {
    setSidebarVisible(!state.sidebarVisible);
  }, [setSidebarVisible, state.sidebarVisible]);

  const setOutlineVisible = useCallback((visible: boolean) => {
    dispatch({ type: 'SET_OUTLINE_VISIBLE', payload: visible });
    updateAppearance({ showOutline: visible });
    void saveSettings();
  }, [dispatch, saveSettings, updateAppearance]);

  const toggleOutline = useCallback(() => {
    setOutlineVisible(!state.outlineVisible);
  }, [setOutlineVisible, state.outlineVisible]);

  const handleNewFile = useCallback(() => {
    const id = `draft-${Date.now()}`;
    dispatch({
      type: 'OPEN_TAB',
      payload: { id, name: t('未命名.md'), path: id, content: `# ${t('未命名')}\n\n`, isDraft: true },
    });
  }, [dispatch, t]);

  const handleNewTextFile = useCallback(() => {
    const id = `draft-text-${Date.now()}`;
    dispatch({
      type: 'OPEN_TAB',
      payload: { id, name: t('未命名.txt'), path: id, content: '', isDraft: true },
    });
  }, [dispatch, t]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        title: t('打开文本或代码文件'),
        filters: textFileDialogFilters,
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        const content = await readTextFile(path);
        const name = path.split('/').pop() || 'untitled.md';
        dispatch({
          type: 'OPEN_TAB',
          payload: { id: path, name, path, content },
        });
        dispatch({
          type: 'ADD_RECENT_FILE',
          payload: { path, name, lastOpened: Date.now() },
        });
      }
    } catch (e) {
      console.error('Failed to open file:', e);
    }
  }, [dispatch, t, textFileDialogFilters]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('选择工作区文件夹'),
      });
      if (!selected) return;

      const path = Array.isArray(selected) ? selected[0] : selected;

      // Read first level only, children loaded lazily on expand
      const tree = await readFirstLevel(path, fileSettings.hidePatterns);

      dispatch({ type: 'SET_WORKSPACE', payload: { path, tree } });

      // Auto-open first .md file
      const firstMd = findFirstMdFile(tree);
      if (firstMd) {
        try {
          const content = await readTextFile(firstMd.path);
          dispatch({
            type: 'OPEN_TAB',
            payload: {
              id: firstMd.path,
              name: firstMd.name,
              path: firstMd.path,
              content,
            },
          });
          dispatch({
            type: 'ADD_RECENT_FILE',
            payload: { path: firstMd.path, name: firstMd.name, lastOpened: Date.now() },
          });
        } catch {
          // File might not exist or not readable
          dispatch({
            type: 'OPEN_TAB',
            payload: {
              id: firstMd.path,
              name: firstMd.name,
              path: firstMd.path,
              content: `# ${firstMd.name.replace('.md', '') || t('未命名')}\n\n`,
            },
          });
        }
      }
    } catch (e) {
      console.error('Failed to open folder:', e);
    }
  }, [dispatch, fileSettings.hidePatterns, t]);

  const openNativeFilePaths = useCallback(async (paths: string[], source: string) => {
    const uniquePaths = [...new Set(paths.map(path => decodeDialogPath(path)).filter(Boolean))];
    const now = Date.now();

    for (const [path, openedAt] of recentOpenedPathRef.current) {
      if (now - openedAt > 1500) recentOpenedPathRef.current.delete(path);
    }

    for (const path of uniquePaths) {
      const openedAt = recentOpenedPathRef.current.get(path);
      if (openedAt && now - openedAt < 800) continue;
      recentOpenedPathRef.current.set(path, now);

      const name = fileNameFromPath(path);
      const previewKind = getPreviewFileKind(name);
      if (previewKind) {
        dispatch({
          type: 'OPEN_TAB',
          payload: { id: path, name, path, content: '', preview: { kind: previewKind } },
        });
        dispatch({ type: 'ADD_RECENT_FILE', payload: { path, name, lastOpened: Date.now() } });
        continue;
      }

      try {
        const doc = await invoke<{ path: string; file_name: string; content: string }>('open_markdown_file', { path });
        dispatch({
          type: 'OPEN_TAB',
          payload: { id: doc.path, name: doc.file_name, path: doc.path, content: doc.content },
        });
        dispatch({
          type: 'ADD_RECENT_FILE',
          payload: { path: doc.path, name: doc.file_name, lastOpened: Date.now() },
        });
      } catch (error) {
        console.error(`Failed to open ${source}:`, path, error);
      }
    }
  }, [dispatch]);

  const handleSave = useCallback(async () => {
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;

    try {
      if (activeTab.isDraft) {
        const path = state.workspacePath
          ? await availableTextFilePath(state.workspacePath, activeTab.name)
          : await (async () => {
              const selected = await save({
                title: t('保存文件'),
                defaultPath: normalizeTextFileName(activeTab.name),
                filters: textFileDialogFilters,
              });
              if (!selected) return '';
              const decoded = decodeDialogPath(selected);
              return ensureTextFileExtension(decoded, activeTab.name);
            })();

        if (!path) return;
        await writeTextFile(path, activeTab.content);

        const name = fileNameFromPath(path);
        dispatch({
          type: 'SAVE_TAB_AS',
          payload: { oldId: activeTab.id, id: path, name, path, content: activeTab.content },
        });
        dispatch({ type: 'ADD_RECENT_FILE', payload: { path, name, lastOpened: Date.now() } });

        if (state.workspacePath) {
          const tree = await readFirstLevel(state.workspacePath, fileSettings.hidePatterns);
          dispatch({ type: 'SET_WORKSPACE', payload: { path: state.workspacePath, tree } });
        }

        message.success(t('已保存到 {name}', { name }));
      } else {
        // Save existing file
        await writeTextFile(activeTab.path, activeTab.content);
        dispatch({ type: 'MARK_TAB_SAVED', payload: activeTab.id });
        message.success(t('已保存'));
      }
    } catch (e) {
      console.error('Failed to save file:', e);
      message.error(t('保存失败'));
    }
  }, [dispatch, fileSettings.hidePatterns, state.activeTabId, state.tabs, state.workspacePath, t, textFileDialogFilters]);

  const handleExportHTML = useCallback(async () => {
    console.log('handleExportHTML called');
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;
    try {
      const htmlBody = await renderMarkdownForExport(activeTab.content, activeTab.path);
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const bgColor = isDark ? '#1a1a2e' : '#ffffff';
      const textColor = isDark ? '#cdd6f4' : '#1a1a1a';
      const borderColor = isDark ? '#313244' : '#e0e0e0';
      const codeBg = isDark ? '#181825' : '#f5f5f5';
      const preBg = isDark ? '#181825' : '#f8f8f8';
      const quoteBorder = normalizeThemeColor(themeColor);
      const linkColor = normalizeThemeColor(themeColor);
      const thBg = isDark ? '#181825' : '#f5f5f5';
      const defaultFileName = activeTab.name.replace(/\.md$/, '') + '.html';
      const defaultPath = exportSettings.defaultExportDir
        ? `${exportSettings.defaultExportDir}/${defaultFileName}`
        : defaultFileName;
      const fullHTML = `<!DOCTYPE html>
<html lang="${isEnglish ? 'en-US' : 'zh-CN'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${activeTab.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { max-width: 800px; margin: 40px auto; padding: 0 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.7; color: ${textColor}; background: ${bgColor}; }
    h1, h2 { border-bottom: 1px solid ${borderColor}; padding-bottom: 0.3em; margin: 1.5em 0 0.8em; }
    h1 { font-size: 1.8em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; } h4 { font-size: 1.1em; }
    code { background: ${codeBg}; padding: 2px 6px; border-radius: 3px; font-size: 0.88em; font-family: SFMono-Regular, Consolas, monospace; }
    pre { background: ${preBg}; border: 1px solid ${borderColor}; border-radius: 6px; padding: 14px 16px; overflow-x: auto; margin: 1em 0; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 3px solid ${quoteBorder}; padding-left: 16px; color: #666; margin: 1em 0; }
    img { max-width: 100%; border-radius: 6px; margin: 1em 0; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid ${borderColor}; padding: 8px 12px; }
    th { background: ${thBg}; }
    tr:nth-child(even) { background: ${isDark ? '#222235' : '#fafafa'}; }
    a { color: ${linkColor}; text-decoration: none; }
    hr { border: none; border-top: 1px solid ${borderColor}; margin: 1.5em 0; }
    ul, ol { padding-left: 24px; margin: 0.5em 0; }
    li { margin: 0.3em 0; }
    @media print { body { max-width: none; margin: 20px; } }
  </style>
</head>
<body>
${htmlBody}
</body>
</html>`;
      const selected = await save({ title: t('导出为 HTML'), defaultPath, filters: [{ name: 'HTML', extensions: ['html'] }] });
      console.log('export_html save returned:', selected, 'type:', typeof selected);
      if (!selected) return;
      const path = decodeDialogPath(selected);
      if (!(await canWriteExportPath(path, exportSettings.overwriteExisting, t('目标文件已存在，已按设置取消导出')))) return;
      await writeTextFile(path, fullHTML);
      if (exportSettings.openAfterExport) {
        await openPath(path);
      }
      console.log('export_html written to:', path);
    } catch (e) { console.error('Failed to export HTML:', e); }
  }, [state.tabs, state.activeTabId, exportSettings.defaultExportDir, exportSettings.openAfterExport, exportSettings.overwriteExisting, isEnglish, t, themeColor]);

  const handleExportPDF = useCallback(async () => {
    console.log('handleExportPDF called');
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;
    try {
      const htmlBody = await renderMarkdownForExport(activeTab.content, activeTab.path);
      const defaultFileName = activeTab.name.replace(/\.md$/, '') + (isEnglish ? '_print.html' : '_打印版.html');
      const defaultPath = exportSettings.defaultExportDir
        ? `${exportSettings.defaultExportDir}/${defaultFileName.replace(/\.html$/, '.pdf')}`
        : defaultFileName.replace(/\.html$/, '.pdf');
      const page = exportSettings.page;
      const pageSize = page.format === 'custom' ? '' : `${page.format} ${page.orientation}`;
      const pageMargin = `${page.margin.top} ${page.margin.right} ${page.margin.bottom} ${page.margin.left}`;
      const headerFooter = exportSettings.headerFooter.enabled
        ? `<div class="print-footer"><span>${exportSettings.headerFooter.showDocumentTitle ? activeTab.name : ''}</span>${exportSettings.headerFooter.showPageNumber ? (isEnglish ? '<span>Page <span class="page-number"></span></span>' : '<span>第 <span class="page-number"></span> 页</span>') : '<span></span>'}</div>`
        : '';
      const fullHTML = `<!DOCTYPE html><html><head><title>${activeTab.name}</title><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { max-width: 700px; margin: 40px auto; padding: 0 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.7; color: #1a1a1a; }
        h1, h2 { border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3em; margin: 1.5em 0 0.8em; page-break-after: avoid; }
        h1 { font-size: 1.8em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; } h4 { font-size: 1.1em; }
        code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 0.88em; font-family: SFMono-Regular, Consolas, monospace; }
        pre { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px 16px; overflow-x: auto; margin: 1em 0; page-break-inside: avoid; }
        pre code { background: none; padding: 0; }
        blockquote { border-left: 3px solid ${normalizeThemeColor(themeColor)}; padding-left: 16px; color: #666; margin: 1em 0; }
        img { max-width: 100%; border-radius: 6px; margin: 1em 0; }
        table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        th, td { border: 1px solid #e0e0e0; padding: 8px 12px; }
        th { background: #f5f5f5; }
        a { color: ${normalizeThemeColor(themeColor)}; }
        hr { border: none; border-top: 1px solid #e0e0e0; margin: 1.5em 0; }
        ul, ol { padding-left: 24px; }
        .print-footer { display: none; }
        .page-number::after { content: counter(page); }
        @page { ${pageSize ? `size: ${pageSize};` : ''} margin: ${pageMargin}; }
        @media print {
          body { max-width: none; margin: 0; }
          .print-footer { display: flex; justify-content: space-between; position: fixed; bottom: 0; left: 0; right: 0; font-size: 10px; color: #666; }
          ${page.printBackground ? '' : '* { background: transparent !important; }'}
        }
      </style></head><body>${htmlBody}${headerFooter}</body></html>`;
      // Detect available engines
      const engines: Array<{ engine: string; available: boolean; path?: string }> = await invoke('detect_pdf_engines');
      const chromeEngine = engines.find(e => e.engine === 'system_chrome');
      const requestedEngine = exportSettings.defaultPdfEngine;
      const useChrome = requestedEngine === 'auto'
        ? chromeEngine?.available
        : requestedEngine === 'system_chrome' && chromeEngine?.available;

      if (useChrome) {
        const selected = await save({ title: t('导出为 PDF'), defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (!selected) return;
        const path = decodeDialogPath(selected);
        if (!(await canWriteExportPath(path, exportSettings.overwriteExisting, t('目标文件已存在，已按设置取消导出')))) return;

        // Use Chrome headless export
        const result: { success: boolean; output_path?: string; error?: string } = await invoke('export_pdf_chrome', {
          htmlContent: fullHTML,
          outputPath: path,
          chromePath: exportSettings.systemChrome.detectMode === 'custom'
            ? exportSettings.systemChrome.customPath || null
            : chromeEngine?.path || null,
        });
        if (!result.success) {
          console.error('Chrome PDF export failed:', result.error);
          message.warning(t('Chrome 导出失败，已打开系统打印'));
          await printHtmlDocument(fullHTML);
          return;
        }
        if (exportSettings.openAfterExport) {
          await openPath(path);
        }
      } else {
        if (requestedEngine === 'system_chrome') {
          message.warning(t('系统 Chrome 不可用，已打开系统打印'));
        }
        await printHtmlDocument(fullHTML);
      }
    } catch (e) { console.error('Failed to export PDF:', e); }
  }, [state.tabs, state.activeTabId, exportSettings, isEnglish, t, themeColor]);

  const handleSaveAs = useCallback(async () => {
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;
    try {
      const defaultPath = activeTab.isDraft && state.workspacePath
        ? `${state.workspacePath}/${normalizeTextFileName(activeTab.name)}`
        : activeTab.isDraft
          ? normalizeTextFileName(activeTab.name)
          : activeTab.path;
      const selected = await save({
        title: t('另存为'),
        defaultPath,
        filters: textFileDialogFilters,
      });
      if (!selected) return;
      const decoded = decodeDialogPath(selected);
      const decodedPath = ensureTextFileExtension(decoded, activeTab.name);
      await writeTextFile(decodedPath, activeTab.content);
      const id = decodedPath;
      const name = fileNameFromPath(decodedPath);
      dispatch({
        type: 'SAVE_TAB_AS',
        payload: { oldId: activeTab.id, id, name, path: decodedPath, content: activeTab.content },
      });
      dispatch({ type: 'ADD_RECENT_FILE', payload: { path: decodedPath, name, lastOpened: Date.now() } });
      if (state.workspacePath && decodedPath.startsWith(`${state.workspacePath}/`)) {
        const tree = await readFirstLevel(state.workspacePath, fileSettings.hidePatterns);
        dispatch({ type: 'SET_WORKSPACE', payload: { path: state.workspacePath, tree } });
      }
      message.success(t('已保存到 {name}', { name }));
    } catch (e) {
      console.error('Failed to save as:', e);
      message.error(t('另存为失败'));
    }
  }, [dispatch, fileSettings.hidePatterns, state.activeTabId, state.tabs, state.workspacePath, t, textFileDialogFilters]);

  const handleCheckUpdate = useCallback(async () => {
    await runUpdateCheckFlow();
  }, []);

  const handleRecentFilesMenu = useCallback(() => {
    if (!state.sidebarVisible) {
      setSidebarVisible(true);
    }
    dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'recent' });
  }, [dispatch, setSidebarVisible, state.sidebarVisible]);

  const handleCloseActiveTab = useCallback(async () => {
    const tab = state.tabs.find(item => item.id === state.activeTabId);
    if (!tab) return;
    if (!(await confirmCloseTabs([tab], language))) return;
    dispatch({ type: 'CLOSE_TAB', payload: tab.id });
  }, [dispatch, language, state.activeTabId, state.tabs]);

  const handleCopy = useCallback(async () => {
    const text = selectedEditorText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      document.execCommand('copy');
    }
  }, []);

  const handleCut = useCallback(async () => {
    const text = selectedEditorText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (!deleteEditorSelection()) {
        document.execCommand('cut');
      }
    } catch {
      document.execCommand('cut');
    }
  }, []);

  const handlePaste = useCallback(async () => {
    if (await pasteClipboardImagesIntoActiveEditor()) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text && insertTextInEditor(text)) return;
    } catch {
      // Continue to browser paste fallback below.
    }
    document.execCommand('paste');
  }, []);

  const appendMarkdownToActiveTab = useCallback((markdown: string) => {
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;
    if (!insertTextInEditor(markdown)) {
      dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: activeTab.content + markdown } });
    }
  }, [dispatch, state.activeTabId, state.tabs]);

  const handleInsertDate = useCallback(() => {
    appendMarkdownToActiveTab(new Date().toISOString().split('T')[0]);
  }, [appendMarkdownToActiveTab]);

  const handleInsertImage = useCallback(async () => {
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;
    const selected = await open({
      multiple: false,
      filters: [{
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'],
      }],
    });
    const selectedPath = Array.isArray(selected) ? selected[0] : selected;
    if (typeof selectedPath !== 'string' || !selectedPath) return;
    const imagePath = decodeDialogPath(selectedPath);
    const markdownPath = markdownImagePathForDocument(imagePath, activeTab.path);
    const alt = stripExtension(basename(imagePath)) || t('图片');
    appendMarkdownToActiveTab(`\n![${alt}](${formatMarkdownImageUrl(markdownPath)})\n`);
  }, [appendMarkdownToActiveTab, state.activeTabId, state.tabs, t]);

  const handleInsertLink = useCallback(() => {
    appendMarkdownToActiveTab(isEnglish ? '\n[Link](url)\n' : '\n[链接](url)\n');
  }, [appendMarkdownToActiveTab, isEnglish]);

  const handleInsertTable = useCallback(() => {
    appendMarkdownToActiveTab(isEnglish ? '\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n' : '\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n');
  }, [appendMarkdownToActiveTab, isEnglish]);

  const handleInsertCode = useCallback(() => {
    appendMarkdownToActiveTab(isEnglish ? '\n```\ncode\n```\n' : '\n```\n代码\n```\n');
  }, [appendMarkdownToActiveTab, isEnglish]);

  const handleInsertHr = useCallback(() => {
    appendMarkdownToActiveTab('\n---\n');
  }, [appendMarkdownToActiveTab]);

  const handleInsertTask = useCallback(() => {
    appendMarkdownToActiveTab(isEnglish ? '\n- [ ] Task\n- [ ] Task\n' : '\n- [ ] 任务\n- [ ] 任务\n');
  }, [appendMarkdownToActiveTab, isEnglish]);

  const runShortcutAction = useCallback((id: string) => {
    switch (id) {
      case 'app.openSettings':
      case 'settings.general':
        navigate('/settings/general');
        break;
      case 'app.commandPalette':
        dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: true });
        break;
      case 'file.new':
        handleNewFile();
        break;
      case 'file.newText':
        handleNewTextFile();
        break;
      case 'file.open':
        void handleOpenFile();
        break;
      case 'file.openFolder':
        void handleOpenFolder();
        break;
      case 'file.save':
        void handleSave();
        break;
      case 'edit.find':
        dispatch({ type: 'OPEN_SEARCH' });
        break;
      case 'edit.replace':
        dispatch({ type: 'OPEN_SEARCH', payload: { replace: true } });
        break;
      case 'view.block':
        setDocumentViewMode('block');
        break;
      case 'view.edit':
        setDocumentViewMode('edit');
        break;
      case 'view.preview':
        setDocumentViewMode('preview');
        break;
      case 'view.split':
        setDocumentViewMode('split');
        break;
      case 'view.toggleSidebar':
        toggleSidebar();
        break;
      case 'view.toggleOutline':
        toggleOutline();
        break;
      case 'view.togglePreview':
        setDocumentViewMode(effectiveViewMode === 'preview' ? 'edit' : 'preview');
        break;
      case 'insert.image':
        void handleInsertImage();
        break;
      case 'insert.link':
        handleInsertLink();
        break;
      case 'insert.table':
        handleInsertTable();
        break;
      case 'insert.code':
        handleInsertCode();
        break;
      case 'insert.hr':
        handleInsertHr();
        break;
      case 'insert.task':
        handleInsertTask();
        break;
      case 'insert.date':
        handleInsertDate();
        break;
      case 'export.pdf':
        void handleExportPDF();
        break;
      case 'export.html':
        void handleExportHTML();
        break;
      case 'settings.preview':
        navigate('/settings/preview');
        break;
      case 'settings.shortcuts':
        navigate('/settings/shortcuts');
        break;
      case 'settings.export':
        navigate('/settings/export');
        break;
      case 'app.checkUpdate':
        void handleCheckUpdate();
        break;
      case 'app.about':
        navigate('/settings/about');
        break;
      default:
        break;
    }
  }, [
    dispatch,
    handleCheckUpdate,
    handleExportHTML,
    handleExportPDF,
    handleInsertCode,
    handleInsertDate,
    handleInsertHr,
    handleInsertImage,
    handleInsertLink,
    handleInsertTable,
    handleInsertTask,
    handleNewFile,
    handleNewTextFile,
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    navigate,
    effectiveViewMode,
    setDocumentViewMode,
    toggleOutline,
    toggleSidebar,
  ]);

  // Listen for Tauri menu events
  useEffect(() => {
    const unlisten = listen('menu-action', async (event) => {
      const action = event.payload as string;
      console.log('menu-action received:', action);
      switch (action) {
        case 'new_file':
          handleNewFile();
          break;
        case 'new_text_file':
          handleNewTextFile();
          break;
        case 'open_file':
          handleOpenFile();
          break;
        case 'open_folder':
          handleOpenFolder();
          break;
        case 'save':
          handleSave();
          break;
        case 'save_as':
          handleSaveAs();
          break;
        case 'close_file':
          await handleCloseActiveTab();
          break;
        case 'recent_files':
          handleRecentFilesMenu();
          break;
        case 'find':
          dispatch({ type: 'OPEN_SEARCH' });
          break;
        case 'replace':
          dispatch({ type: 'OPEN_SEARCH', payload: { replace: true } });
          break;
        case 'command_palette':
          dispatch({ type: 'SET_COMMAND_PALETTE_OPEN', payload: true });
          break;
        case 'undo': {
          const view = getActiveEditorView();
          if (view) undo(view);
          break;
        }
        case 'redo': {
          const view = getActiveEditorView();
          if (view) redo(view);
          break;
        }
        case 'cut':
          void handleCut();
          break;
        case 'copy':
          void handleCopy();
          break;
        case 'paste':
          void handlePaste();
          break;
        case 'select_all':
          selectAllEditorContent();
          break;
        case 'view_block':
          setDocumentViewMode('block');
          break;
        case 'view_edit':
          setDocumentViewMode('edit');
          break;
        case 'view_preview':
          setDocumentViewMode('preview');
          break;
        case 'view_split':
          setDocumentViewMode('split');
          break;
        case 'toggle_sidebar':
          toggleSidebar();
          break;
        case 'toggle_outline':
          toggleOutline();
          break;
        case 'theme_light':
          setThemeMode('light');
          break;
        case 'theme_dark':
          setThemeMode('dark');
          break;
        case 'theme_system':
          setThemeMode('system');
          break;
        case 'toggle_sync_scroll':
          toggleSyncScroll();
          break;
        case 'export_pdf':
          handleExportPDF();
          break;
        case 'export_html':
          handleExportHTML();
          break;
        case 'export_settings':
          navigate('/settings/export');
          break;
        case 'prev_tab': {
          const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
          if (idx > 0) dispatch({ type: 'SET_ACTIVE_TAB', payload: state.tabs[idx - 1].id });
          break;
        }
        case 'next_tab': {
          const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
          if (idx >= 0 && idx < state.tabs.length - 1) dispatch({ type: 'SET_ACTIVE_TAB', payload: state.tabs[idx + 1].id });
          break;
        }
        case 'zoom_in': {
          const el = document.getElementById('root');
          if (el) {
            const current = parseFloat(getComputedStyle(el).transform.split(',')[3]) || 1;
            el.style.transform = `scale(${Math.min(current + 0.1, 2)})`;
          }
          break;
        }
        case 'zoom_out': {
          const el = document.getElementById('root');
          if (el) {
            const current = parseFloat(getComputedStyle(el).transform.split(',')[3]) || 1;
            el.style.transform = `scale(${Math.max(current - 0.1, 0.5)})`;
          }
          break;
        }
        case 'reset_zoom': {
          const el = document.getElementById('root');
          if (el) el.style.transform = '';
          break;
        }
        case 'insert_date': {
          handleInsertDate();
          break;
        }
        case 'insert_image': {
          await handleInsertImage();
          break;
        }
        case 'insert_link': {
          handleInsertLink();
          break;
        }
        case 'insert_table': {
          handleInsertTable();
          break;
        }
        case 'insert_code': {
          handleInsertCode();
          break;
        }
        case 'insert_hr': {
          handleInsertHr();
          break;
        }
        case 'insert_task': {
          handleInsertTask();
          break;
        }
        case 'markdown_help':
          void openPath('https://www.markdownguide.org/basic-syntax/');
          break;
        case 'shortcut_help':
          navigate('/settings/shortcuts');
          break;
        case 'check_update':
          void handleCheckUpdate();
          break;
        case 'about':
          navigate('/settings/about');
          break;
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [
    handleNewFile,
    handleNewTextFile,
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    handleExportPDF,
    handleExportHTML,
    handleSaveAs,
    handleRecentFilesMenu,
    handleCloseActiveTab,
    handleCopy,
    handleCut,
    handlePaste,
    handleInsertCode,
    handleInsertDate,
    handleInsertHr,
    handleInsertImage,
    handleInsertLink,
    handleInsertTable,
    handleInsertTask,
    handleCheckUpdate,
    setDocumentViewMode,
    setThemeMode,
    toggleOutline,
    toggleSidebar,
    toggleSyncScroll,
    dispatch,
    navigate,
    state.activeTabId,
    state.tabs,
  ]);

  // Listen for file drops over the webview content.
  useEffect(() => {
    if (!isTauri()) return undefined;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === 'enter' || payload.type === 'over') {
        setIsDragging(true);
        return;
      }

      if (payload.type === 'leave') {
        setIsDragging(false);
        return;
      }

      if (payload.type === 'drop') {
        setIsDragging(false);
        void openNativeFilePaths(payload.paths, 'dropped file');
      }
    }).then(fn => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    }).catch(error => {
      console.error('Failed to bind file drop listener:', error);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [openNativeFilePaths]);

  // Prevent the webview from navigating away when files are dropped over editable surfaces.
  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!hasFileDragData(event.dataTransfer)) return;
      event.preventDefault();
      setIsDragging(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFileDragData(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFileDragData(event.dataTransfer)) return;
      if (!event.relatedTarget) setIsDragging(false);
    };

    const onDrop = (event: DragEvent) => {
      if (!hasFileDragData(event.dataTransfer)) return;
      event.preventDefault();
      setIsDragging(false);

      const paths = dataTransferFilePaths(event.dataTransfer);
      if (paths.length > 0) {
        void openNativeFilePaths(paths, 'dropped file');
      }
    };

    window.addEventListener('dragenter', onDragEnter, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('dragleave', onDragLeave, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragenter', onDragEnter, true);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('dragleave', onDragLeave, true);
      window.removeEventListener('drop', onDrop, true);
    };
  }, [openNativeFilePaths]);

  // Keep compatibility with the Rust-side file-drop bridge.
  useEffect(() => {
    const unlisten = listen<string[]>('files-dropped', async (event) => {
      await openNativeFilePaths(event.payload, 'dropped file');
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [openNativeFilePaths]);

  // Listen for opened-files event (from macOS Opened or single-instance forwarding)
  useEffect(() => {
    const unlisten = listen<string[]>('opened-files', async (event) => {
      await openNativeFilePaths(event.payload, 'file');
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [openNativeFilePaths]);

  // Fetch files that were opened at launch (cold start via right-click > Open With)
  useEffect(() => {
    invoke<string[]>('take_pending_open_files').then(async (paths) => {
      await openNativeFilePaths(paths, 'file on launch');
    }).catch(e => console.error('take_pending_open_files failed:', e));
  }, [openNativeFilePaths]);

  // Commands dispatched by the command palette.
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === 'string') {
        runShortcutAction(id);
      }
    };
    window.addEventListener('orcha-command', handler);
    return () => window.removeEventListener('orcha-command', handler);
  }, [runShortcutAction]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
      const editableFocused = isEditableElement(activeElement);

      if (isPrimarySelectAllShortcut(e)) {
        if (editableFocused) return;
        e.preventDefault();
        selectAllEditorContent();
        return;
      }

      const matchedShortcut = shortcuts.find(shortcut =>
        shortcut.enabled && matchesShortcut(e, shortcut.keys)
      );
      if (matchedShortcut) {
        if (matchedShortcut.id === 'select_all' && editableFocused) return;
        e.preventDefault();
        runShortcutAction(matchedShortcut.id);
        return;
      }

      if (e.key === 'Escape') {
        if (editableFocused) return;
        navigate('/workspace');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, runShortcutAction, shortcuts]);

  return (
    <>
      <div className="toolbar">
        {/* Left section */}
        <div className="toolbar-section left">
          <button className="toolbar-btn" onClick={handleNewFile} data-tooltip={t('新建文件')} aria-label={t('新建文件')}>
            <FilePlus size={16} />
          </button>
          <button className="toolbar-btn" onClick={handleOpenFile} data-tooltip={t('打开文件')} aria-label={t('打开文件')}>
            <FileText size={16} />
          </button>
          <button className="toolbar-btn" onClick={handleOpenFolder} data-tooltip={t('打开文件夹')} aria-label={t('打开文件夹')}>
            <FolderOpen size={16} />
          </button>
          <button className="toolbar-btn" onClick={handleSave} data-tooltip={t('保存')} aria-label={t('保存')}>
            <Save size={16} />
          </button>
          <button
            className={`toolbar-btn ${state.searchOpen ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'OPEN_SEARCH' })}
            data-tooltip={t('搜索')}
            aria-label={t('搜索')}
          >
            <Search size={16} />
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Center section - View mode */}
        <div className="toolbar-section center">
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${effectiveViewMode === 'block' ? 'active' : ''}`}
              onClick={() => setDocumentViewMode('block')}
              disabled={!markdownViewModesAvailable}
              data-tooltip={markdownViewModesAvailable ? t('块编辑模式') : markdownOnlyViewTooltip}
              aria-label={t('块编辑模式')}
            >
              <ScrollText size={14} />
              <span>{t('块编辑')}</span>
            </button>
            <button
              className={`view-toggle-btn ${effectiveViewMode === 'edit' ? 'active' : ''}`}
              onClick={() => setDocumentViewMode('edit')}
              data-tooltip={sourceModeTooltip}
              aria-label={sourceModeTooltip}
            >
              <Edit3 size={14} />
              <span>{sourceModeLabel}</span>
            </button>
            <button
              className={`view-toggle-btn ${effectiveViewMode === 'preview' ? 'active' : ''}`}
              onClick={() => setDocumentViewMode('preview')}
              disabled={!markdownViewModesAvailable}
              data-tooltip={markdownViewModesAvailable ? t('预览模式') : markdownOnlyViewTooltip}
              aria-label={t('预览模式')}
            >
              <Eye size={14} />
              <span>{t('预览')}</span>
            </button>
            <button
              className={`view-toggle-btn ${effectiveViewMode === 'split' ? 'active' : ''}`}
              onClick={() => setDocumentViewMode('split')}
              disabled={!markdownViewModesAvailable}
              data-tooltip={markdownViewModesAvailable ? t('双栏模式') : markdownOnlyViewTooltip}
              aria-label={t('双栏模式')}
            >
              <Columns size={14} />
              <span>{t('双栏')}</span>
            </button>
          </div>
        </div>

        <div className="toolbar-divider" />

        {/* Right section */}
        <div className="toolbar-section right">
          <div className="theme-toggle">
            <button
              className={`theme-toggle-btn ${state.theme === 'light' ? 'active' : ''}`}
              onClick={() => setThemeMode('light')}
              data-tooltip={t('浅色主题')}
              aria-label={t('浅色主题')}
            >
              <Sun size={13} />
            </button>
            <button
              className={`theme-toggle-btn ${state.theme === 'dark' ? 'active' : ''}`}
              onClick={() => setThemeMode('dark')}
              data-tooltip={t('深色主题')}
              aria-label={t('深色主题')}
            >
              <Moon size={13} />
            </button>
            <button
              className={`theme-toggle-btn ${state.theme === 'system' ? 'active' : ''}`}
              onClick={() => setThemeMode('system')}
              data-tooltip={t('跟随系统')}
              aria-label={t('跟随系统')}
            >
              <Monitor size={13} />
            </button>
          </div>

          <div style={{ width: 4 }} />

          <button
            className={`toolbar-btn ${state.editorSettings.syncScroll ? 'active' : ''}`}
            onClick={toggleSyncScroll}
            data-tooltip={t('同屏滚动')}
            aria-label={t('同屏滚动')}
          >
            <ScrollText size={16} />
          </button>

          <button
            className="toolbar-btn"
            onClick={() => navigate('/settings/general')}
            data-tooltip={t('设置')}
            aria-label={t('设置')}
          >
            <Settings size={16} />
          </button>

        </div>
      </div>

      {/* Drag overlay */}
      <div className={`drag-overlay ${isDragging ? '' : 'hidden'}`}>
        <p>{t('释放以打开文件')}</p>
      </div>
    </>
  );
}

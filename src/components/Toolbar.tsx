import { useApp } from '../AppContext';
import { useNavigate } from 'react-router-dom';
import { FilePlus, FolderOpen, FileText, Save, Search, Eye, Edit3, Columns, Sun, Moon, Monitor, Settings, X, ScrollText } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { open as openPath } from '@tauri-apps/plugin-shell';
import { message, Modal } from 'antd';
import { redo, undo } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { pathExists, readTextFile, writeTextFile } from '../utils/fs';
import { findFirstMdFile, readFirstLevel } from '../utils/workspace';
import { getActiveEditorView, pasteClipboardImagesIntoActiveEditor } from './Editor';
import { basename, formatMarkdownImageUrl, markdownImagePathForDocument, stripExtension } from '../utils/markdownImages';
import { renderMarkdownForExport } from '../utils/exportMarkdown';
import { useSettingsStore, useShortcutStore } from '../store';
import type { ThemeMode } from '../types';
import { checkForUpdates } from '../utils/update';

// Tauri save dialog on macOS returns file:// URLs, convert to plain path
function decodePath(path: string): string {
  if (path.startsWith('file://')) {
    return decodeURIComponent(path.slice(7));
  }
  return path;
}

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

async function canWriteExportPath(path: string, overwriteExisting: boolean): Promise<boolean> {
  if (overwriteExisting) return true;
  if (!(await pathExists(path))) return true;
  message.warning('目标文件已存在，已按设置取消导出');
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

interface OpenedDocument {
  path: string;
  file_name: string;
  content: string;
  external: boolean;
  readonly: boolean;
}

export default function Toolbar() {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const updateAppearance = useSettingsStore(s => s.updateAppearance);
  const updatePreview = useSettingsStore(s => s.updatePreview);
  const saveSettings = useSettingsStore(s => s.saveAll);
  const exportSettings = useSettingsStore(s => s.export);
  const fileSettings = useSettingsStore(s => s.files);
  const themeColor = useSettingsStore(s => s.appearance.themeColor);
  const shortcuts = useShortcutStore(s => s.shortcuts);
  const [isDragging, setIsDragging] = useState(false);

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

  const handleNewFile = useCallback(() => {
    const id = `draft-${Date.now()}`;
    dispatch({
      type: 'OPEN_TAB',
      payload: { id, name: '未命名.md', path: id, content: '# 未命名\n\n', isDraft: true },
    });
  }, [dispatch]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        title: '打开 Markdown 文件',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
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
  }, [dispatch]);

  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择工作区文件夹',
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
              content: `# ${firstMd.name.replace('.md', '')}\n\n`,
            },
          });
        }
      }
    } catch (e) {
      console.error('Failed to open folder:', e);
    }
  }, [dispatch, fileSettings.hidePatterns]);

  const handleSave = useCallback(async () => {
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;

    try {
      if (activeTab.isDraft) {
        // Save as new file
        const selected = await open({
          multiple: false,
          title: '保存文件',
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (!selected) return;
        const path = Array.isArray(selected) ? selected[0] : selected;
        await writeTextFile(path, activeTab.content);

        // Replace draft tab with saved file
        const id = path;
        const name = path.split('/').pop() || 'untitled.md';
        dispatch({
          type: 'OPEN_TAB',
          payload: { id, name, path, content: activeTab.content },
        });
        dispatch({ type: 'MARK_TAB_SAVED', payload: id });
      } else {
        // Save existing file
        await writeTextFile(activeTab.path, activeTab.content);
        dispatch({ type: 'MARK_TAB_SAVED', payload: activeTab.id });
      }
    } catch (e) {
      console.error('Failed to save file:', e);
    }
  }, [state.tabs, state.activeTabId, dispatch]);

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
<html lang="zh-CN">
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
      const selected = await save({ title: '导出为 HTML', defaultPath, filters: [{ name: 'HTML', extensions: ['html'] }] });
      console.log('export_html save returned:', selected, 'type:', typeof selected);
      if (!selected) return;
      const path = decodePath(selected);
      if (!(await canWriteExportPath(path, exportSettings.overwriteExisting))) return;
      await writeTextFile(path, fullHTML);
      if (exportSettings.openAfterExport) {
        await openPath(path);
      }
      console.log('export_html written to:', path);
    } catch (e) { console.error('Failed to export HTML:', e); }
  }, [state.tabs, state.activeTabId, exportSettings.defaultExportDir, exportSettings.openAfterExport, exportSettings.overwriteExisting, themeColor]);

  const handleExportPDF = useCallback(async () => {
    console.log('handleExportPDF called');
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;
    try {
      const htmlBody = await renderMarkdownForExport(activeTab.content, activeTab.path);
      const defaultFileName = activeTab.name.replace(/\.md$/, '') + '_打印版.html';
      const defaultPath = exportSettings.defaultExportDir
        ? `${exportSettings.defaultExportDir}/${defaultFileName.replace(/\.html$/, '.pdf')}`
        : defaultFileName.replace(/\.html$/, '.pdf');
      const page = exportSettings.page;
      const pageSize = page.format === 'custom' ? '' : `${page.format} ${page.orientation}`;
      const pageMargin = `${page.margin.top} ${page.margin.right} ${page.margin.bottom} ${page.margin.left}`;
      const headerFooter = exportSettings.headerFooter.enabled
        ? `<div class="print-footer"><span>${exportSettings.headerFooter.showDocumentTitle ? activeTab.name : ''}</span>${exportSettings.headerFooter.showPageNumber ? '<span>第 <span class="page-number"></span> 页</span>' : '<span></span>'}</div>`
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
        const selected = await save({ title: '导出为 PDF', defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (!selected) return;
        const path = decodePath(selected);
        if (!(await canWriteExportPath(path, exportSettings.overwriteExisting))) return;

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
          message.warning('Chrome 导出失败，已打开系统打印');
          await printHtmlDocument(fullHTML);
          return;
        }
        if (exportSettings.openAfterExport) {
          await openPath(path);
        }
      } else {
        if (requestedEngine === 'system_chrome') {
          message.warning('系统 Chrome 不可用，已打开系统打印');
        }
        await printHtmlDocument(fullHTML);
      }
    } catch (e) { console.error('Failed to export PDF:', e); }
  }, [state.tabs, state.activeTabId, exportSettings, themeColor]);

  const handleSaveAs = useCallback(async () => {
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;
    try {
      const selected = await save({
        title: '另存为',
        defaultPath: activeTab.name,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!selected) return;
      const decodedPath = decodePath(selected);
      await writeTextFile(decodedPath, activeTab.content);
      const id = decodedPath;
      const name = decodedPath.split('/').pop() || 'untitled.md';
      dispatch({ type: 'OPEN_TAB', payload: { id, name, path: decodedPath, content: activeTab.content } });
      dispatch({ type: 'MARK_TAB_SAVED', payload: id });
    } catch (e) { console.error('Failed to save as:', e); }
  }, [state.tabs, state.activeTabId, dispatch]);

  const handleCheckUpdate = useCallback(async () => {
    try {
      const result = await checkForUpdates();
      if (!result.available) {
        message.success(`当前已是最新版本（${result.currentVersion}）`);
        return;
      }

      Modal.confirm({
        title: `发现新版本 ${result.latestVersion}`,
        content: `当前版本：${result.currentVersion}`,
        okText: '打开发布页',
        cancelText: '稍后',
        onOk: () => openPath(result.releaseUrl),
      });
    } catch (error) {
      message.warning(error instanceof Error ? error.message : '检查更新失败');
    }
  }, []);

  const handleRecentFilesMenu = useCallback(() => {
    if (!state.sidebarVisible) {
      dispatch({ type: 'TOGGLE_SIDEBAR' });
    }
    dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'recent' });
  }, [dispatch, state.sidebarVisible]);

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

  const runShortcutAction = useCallback((id: string) => {
    switch (id) {
      case 'app.openSettings':
        navigate('/settings/general');
        break;
      case 'file.new':
        handleNewFile();
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
        dispatch({ type: 'TOGGLE_SEARCH' });
        break;
      case 'view.togglePreview':
        dispatch({ type: 'SET_VIEW_MODE', payload: state.viewMode === 'preview' ? 'edit' : 'preview' });
        break;
      case 'export.pdf':
        void handleExportPDF();
        break;
      default:
        break;
    }
  }, [dispatch, handleExportPDF, handleNewFile, handleOpenFile, handleOpenFolder, handleSave, navigate, state.viewMode]);

  // Listen for Tauri menu events
  useEffect(() => {
    const unlisten = listen('menu-action', async (event) => {
      const action = event.payload as string;
      console.log('menu-action received:', action);
      switch (action) {
        case 'new_file':
          handleNewFile();
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
          if (state.activeTabId) dispatch({ type: 'CLOSE_TAB', payload: state.activeTabId });
          break;
        case 'recent_files':
          handleRecentFilesMenu();
          break;
        case 'find':
          dispatch({ type: 'TOGGLE_SEARCH' });
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
          if (!selectAllEditorContent()) document.execCommand('selectAll');
          break;
        case 'view_edit':
          dispatch({ type: 'SET_VIEW_MODE', payload: 'edit' });
          break;
        case 'view_preview':
          dispatch({ type: 'SET_VIEW_MODE', payload: 'preview' });
          break;
        case 'view_split':
          dispatch({ type: 'SET_VIEW_MODE', payload: 'split' });
          break;
        case 'toggle_sidebar':
          dispatch({ type: 'TOGGLE_SIDEBAR' });
          break;
        case 'toggle_outline':
          dispatch({ type: 'TOGGLE_OUTLINE' });
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
          const activeTab = state.tabs.find(t => t.id === state.activeTabId);
          if (activeTab) {
            const date = new Date().toISOString().split('T')[0];
            dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: activeTab.content + date } });
          }
          break;
        }
        case 'insert_image': {
          const activeTab = state.tabs.find(t => t.id === state.activeTabId);
          if (activeTab) {
            const selected = await open({
              multiple: false,
              filters: [{
                name: 'Images',
                extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'],
              }],
            });
            const selectedPath = Array.isArray(selected) ? selected[0] : selected;
            if (typeof selectedPath === 'string' && selectedPath) {
              const imagePath = decodePath(selectedPath);
              const markdownPath = markdownImagePathForDocument(imagePath, activeTab.path);
              const alt = stripExtension(basename(imagePath)) || '图片';
              const markdown = `\n![${alt}](${formatMarkdownImageUrl(markdownPath)})\n`;
              if (!insertTextInEditor(markdown)) {
                dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: activeTab.content + markdown } });
              }
            }
          }
          break;
        }
        case 'insert_link': {
          const activeTab = state.tabs.find(t => t.id === state.activeTabId);
          if (activeTab) {
            dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: activeTab.content + '\n[链接](url)\n' } });
          }
          break;
        }
        case 'insert_table': {
          const activeTab = state.tabs.find(t => t.id === state.activeTabId);
          if (activeTab) {
            const table = '\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n';
            dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: activeTab.content + table } });
          }
          break;
        }
        case 'insert_code': {
          const activeTab = state.tabs.find(t => t.id === state.activeTabId);
          if (activeTab) {
            dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: activeTab.content + '\n```\n代码\n```\n' } });
          }
          break;
        }
        case 'insert_hr': {
          const activeTab = state.tabs.find(t => t.id === state.activeTabId);
          if (activeTab) {
            dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: activeTab.content + '\n---\n' } });
          }
          break;
        }
        case 'insert_task': {
          const activeTab = state.tabs.find(t => t.id === state.activeTabId);
          if (activeTab) {
            dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: activeTab.content + '\n- [ ] 任务\n- [ ] 任务\n' } });
          }
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
    handleOpenFile,
    handleOpenFolder,
    handleSave,
    handleExportPDF,
    handleExportHTML,
    handleSaveAs,
    handleRecentFilesMenu,
    handleCopy,
    handleCut,
    handlePaste,
    handleCheckUpdate,
    setThemeMode,
    toggleSyncScroll,
    dispatch,
    navigate,
    state.activeTabId,
    state.tabs,
  ]);

  // Listen for file drops (from dock icon or window drag-and-drop)
  useEffect(() => {
    const unlisten = listen<string[]>('files-dropped', async (event) => {
      const paths = event.payload;
      for (const path of paths) {
        try {
          const doc = await invoke<OpenedDocument>('open_markdown_file', { path });
          dispatch({
            type: 'OPEN_TAB',
            payload: { id: doc.path, name: doc.file_name, path: doc.path, content: doc.content },
          });
          dispatch({
            type: 'ADD_RECENT_FILE',
            payload: { path: doc.path, name: doc.file_name, lastOpened: Date.now() },
          });
        } catch (e) {
          console.error('Failed to open dropped file:', path, e);
        }
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [dispatch]);

  // Listen for opened-files event (from macOS Opened or single-instance forwarding)
  useEffect(() => {
    const unlisten = listen<string[]>('opened-files', async (event) => {
      const paths = event.payload;
      for (const path of paths) {
        try {
          const doc = await invoke<OpenedDocument>('open_markdown_file', { path });
          dispatch({
            type: 'OPEN_TAB',
            payload: { id: doc.path, name: doc.file_name, path: doc.path, content: doc.content },
          });
          dispatch({
            type: 'ADD_RECENT_FILE',
            payload: { path: doc.path, name: doc.file_name, lastOpened: Date.now() },
          });
        } catch (e) {
          console.error('Failed to open file:', path, e);
        }
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [dispatch]);

  // Fetch files that were opened at launch (cold start via right-click > Open With)
  useEffect(() => {
    invoke<string[]>('take_pending_open_files').then(async (paths) => {
      for (const path of paths) {
        try {
          const doc = await invoke<OpenedDocument>('open_markdown_file', { path });
          dispatch({
            type: 'OPEN_TAB',
            payload: { id: doc.path, name: doc.file_name, path: doc.path, content: doc.content },
          });
          dispatch({
            type: 'ADD_RECENT_FILE',
            payload: { path: doc.path, name: doc.file_name, lastOpened: Date.now() },
          });
        } catch (e) {
          console.error('Failed to open file on launch:', path, e);
        }
      }
    }).catch(e => console.error('take_pending_open_files failed:', e));
  }, [dispatch]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const matchedShortcut = shortcuts.find(shortcut =>
        shortcut.enabled && matchesShortcut(e, shortcut.keys)
      );
      if (matchedShortcut) {
        e.preventDefault();
        runShortcutAction(matchedShortcut.id);
        return;
      }

      if (e.key === 'Escape') {
        const active = document.activeElement;
        if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
        navigate('/workspace');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, runShortcutAction, shortcuts]);

  // Window drag events for overlay
  useEffect(() => {
    const onDragEnter = () => setIsDragging(true);
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setIsDragging(false);
    };
    const onDrop = () => setIsDragging(false);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <>
      <div className="toolbar">
        {/* Left section */}
        <div className="toolbar-section left">
          <button className="toolbar-btn" onClick={handleNewFile} title="新建文件">
            <FilePlus size={16} />
          </button>
          <button className="toolbar-btn" onClick={handleOpenFile} title="打开文件">
            <FileText size={16} />
          </button>
          <button className="toolbar-btn" onClick={handleOpenFolder} title="打开文件夹">
            <FolderOpen size={16} />
          </button>
          <button className="toolbar-btn" onClick={handleSave} title="保存">
            <Save size={16} />
          </button>
          <button
            className={`toolbar-btn ${state.searchOpen ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'TOGGLE_SEARCH' })}
            title="搜索"
          >
            <Search size={16} />
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Center section - View mode */}
        <div className="toolbar-section center">
          <div className="view-toggle">
            <button
              className={`view-toggle-btn ${state.viewMode === 'edit' ? 'active' : ''}`}
              onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'edit' })}
              title="编辑模式"
            >
              <Edit3 size={14} />
              <span>编辑</span>
            </button>
            <button
              className={`view-toggle-btn ${state.viewMode === 'preview' ? 'active' : ''}`}
              onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'preview' })}
              title="预览模式"
            >
              <Eye size={14} />
              <span>预览</span>
            </button>
            <button
              className={`view-toggle-btn ${state.viewMode === 'split' ? 'active' : ''}`}
              onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'split' })}
              title="双栏模式"
            >
              <Columns size={14} />
              <span>双栏</span>
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
              title="浅色主题"
            >
              <Sun size={13} />
            </button>
            <button
              className={`theme-toggle-btn ${state.theme === 'dark' ? 'active' : ''}`}
              onClick={() => setThemeMode('dark')}
              title="深色主题"
            >
              <Moon size={13} />
            </button>
            <button
              className={`theme-toggle-btn ${state.theme === 'system' ? 'active' : ''}`}
              onClick={() => setThemeMode('system')}
              title="跟随系统"
            >
              <Monitor size={13} />
            </button>
          </div>

          <div style={{ width: 4 }} />

          <button
            className={`toolbar-btn ${state.editorSettings.syncScroll ? 'active' : ''}`}
            onClick={toggleSyncScroll}
            title="同屏滚动"
          >
            <ScrollText size={16} />
          </button>

          <button
            className="toolbar-btn"
            onClick={() => navigate('/settings/general')}
            title="设置"
          >
            <Settings size={16} />
          </button>

          <button
            className="toolbar-btn"
            onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
            title="侧边栏"
          >
            {state.sidebarVisible ? <Eye size={16} /> : <X size={16} />}
          </button>
        </div>
      </div>

      {/* Drag overlay */}
      <div className={`drag-overlay ${isDragging ? '' : 'hidden'}`}>
        <p>释放以打开文件</p>
      </div>
    </>
  );
}

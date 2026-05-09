import { useApp } from '../AppContext';
import { useState, useRef, useEffect, useCallback } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '../utils/fs';
import { invoke } from '@tauri-apps/api/core';
import MarkdownIt from 'markdown-it';

interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  divider?: boolean;
  disabled?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

export default function MenuBar() {
  const { state, dispatch } = useApp();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleNewFile = useCallback(() => {
    const id = `draft-${Date.now()}`;
    dispatch({ type: 'OPEN_TAB', payload: { id, name: '未命名.md', path: id, content: '# 未命名\n\n', isDraft: true } });
  }, [dispatch]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({ multiple: true, title: '打开 Markdown 文件', filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        const content = await readTextFile(path);
        const name = path.split('/').pop() || 'untitled.md';
        dispatch({ type: 'OPEN_TAB', payload: { id: path, name, path, content } });
        dispatch({ type: 'ADD_RECENT_FILE', payload: { path, name, lastOpened: Date.now() } });
      }
    } catch (e) { console.error('Failed to open file:', e); }
  }, [dispatch]);

  const handleSave = useCallback(async () => {
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;
    try {
      if (activeTab.isDraft) {
        const selected = await open({ multiple: false, title: '保存文件', filters: [{ name: 'Markdown', extensions: ['md'] }] });
        if (!selected) return;
        const path = Array.isArray(selected) ? selected[0] : selected;
        await writeTextFile(path, activeTab.content);
        const id = path;
        const name = path.split('/').pop() || 'untitled.md';
        dispatch({ type: 'OPEN_TAB', payload: { id, name, path, content: activeTab.content } });
        dispatch({ type: 'MARK_TAB_SAVED', payload: id });
      } else {
        await writeTextFile(activeTab.path, activeTab.content);
        dispatch({ type: 'MARK_TAB_SAVED', payload: activeTab.id });
      }
    } catch (e) { console.error('Failed to save file:', e); }
  }, [state.tabs, state.activeTabId, dispatch]);

  const handleExportHTML = useCallback(async () => {
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;
    try {
      const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true });
      const htmlBody = md.render(activeTab.content);
      const defaultFileName = activeTab.name.replace(/\.md$/, '') + '.html';
      const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${activeTab.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { max-width: 800px; margin: 40px auto; padding: 0 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.7; color: #1a1a1a; }
    h1, h2 { border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3em; margin: 1.5em 0 0.8em; }
    h1 { font-size: 1.8em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; } h4 { font-size: 1.1em; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 0.88em; font-family: SFMono-Regular, Consolas, monospace; }
    pre { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px 16px; overflow-x: auto; margin: 1em 0; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 3px solid #0A84FF; padding-left: 16px; color: #666; margin: 1em 0; }
    img { max-width: 100%; border-radius: 6px; margin: 1em 0; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #e0e0e0; padding: 8px 12px; }
    th { background: #f5f5f5; }
    tr:nth-child(even) { background: #fafafa; }
    a { color: #0A84FF; text-decoration: none; }
    hr { border: none; border-top: 1px solid #e0e0e0; margin: 1.5em 0; }
    ul, ol { padding-left: 24px; margin: 0.5em 0; }
    li { margin: 0.3em 0; }
    @media print { body { max-width: none; margin: 20px; } }
  </style>
</head>
<body>
${htmlBody}
</body>
</html>`;
      const path = await save({ title: '导出为 HTML', defaultPath: defaultFileName, filters: [{ name: 'HTML', extensions: ['html'] }] });
      if (!path) return;
      await writeTextFile(path, fullHTML);
    } catch (e) { console.error('Failed to export HTML:', e); }
  }, [state.tabs, state.activeTabId]);

  const handleExportPDF = useCallback(async () => {
    const activeTab = state.tabs.find(t => t.id === state.activeTabId);
    if (!activeTab) return;
    try {
      const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true });
      const htmlBody = md.render(activeTab.content);
      const defaultFileName = activeTab.name.replace(/\.md$/, '') + '.pdf';
      const fullHTML = `<!DOCTYPE html><html><head><title>${activeTab.name}</title><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { max-width: 700px; margin: 40px auto; padding: 0 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.7; color: #1a1a1a; }
        h1, h2 { border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3em; margin: 1.5em 0 0.8em; page-break-after: avoid; }
        h1 { font-size: 1.8em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; } h4 { font-size: 1.1em; }
        code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 0.88em; font-family: SFMono-Regular, Consolas, monospace; }
        pre { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px 16px; overflow-x: auto; margin: 1em 0; page-break-inside: avoid; }
        pre code { background: none; padding: 0; }
        blockquote { border-left: 3px solid #0A84FF; padding-left: 16px; color: #666; margin: 1em 0; }
        img { max-width: 100%; border-radius: 6px; margin: 1em 0; }
        table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        th, td { border: 1px solid #e0e0e0; padding: 8px 12px; }
        th { background: #f5f5f5; }
        a { color: #0A84FF; }
        hr { border: none; border-top: 1px solid #e0e0e0; margin: 1.5em 0; }
        ul, ol { padding-left: 24px; }
        @page { margin: 20mm; }
      </style></head><body>${htmlBody}</body></html>`;
      const path = await save({ title: '导出为 PDF', defaultPath: defaultFileName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (!path) return;

      // Detect available engines
      const engines: Array<{ engine: string; available: boolean; path?: string }> = await invoke('detect_pdf_engines');
      const chromeEngine = engines.find(e => e.engine === 'system_chrome');

      if (chromeEngine?.available) {
        // Use Chrome headless export
        const result: { success: boolean; output_path?: string; error?: string } = await invoke('export_pdf_chrome', {
          htmlContent: fullHTML,
          outputPath: path,
          chromePath: chromeEngine.path || null,
        });
        if (!result.success) {
          console.error('Chrome PDF export failed:', result.error);
          // Fall back to system print
          await invoke('export_pdf_system_print');
        }
      } else {
        // Fall back to system print (opens print dialog)
        await invoke('export_pdf_system_print');
      }
    } catch (e) { console.error('Failed to export PDF:', e); }
  }, [state.tabs, state.activeTabId]);

  const buildMenus = useCallback((): Menu[] => [
    {
      label: '文件',
      items: [
        { label: '新建文件', shortcut: '⌘N', action: handleNewFile },
        { label: '新建窗口', shortcut: '⌘⇧N' },
        { divider: true },
        { label: '打开文件', shortcut: '⌘O', action: handleOpenFile },
        { label: '打开文件夹' },
        { divider: true },
        { label: '保存', shortcut: '⌘S', action: handleSave },
        { label: '另存为', shortcut: '⌘⇧S' },
        { divider: true },
        { label: '关闭文件', shortcut: '⌘W', action: () => state.activeTabId && dispatch({ type: 'CLOSE_TAB', payload: state.activeTabId }) },
        { label: '最近打开' },
        { divider: true },
        { label: '退出', shortcut: '⌘Q' },
      ],
    },
    {
      label: '编辑',
      items: [
        { label: '撤销', shortcut: '⌘Z' },
        { label: '重做', shortcut: '⌘⇧Z' },
        { divider: true },
        { label: '剪切', shortcut: '⌘X' },
        { label: '复制', shortcut: '⌘C' },
        { label: '粘贴', shortcut: '⌘V' },
        { label: '全选', shortcut: '⌘A' },
        { divider: true },
        { label: '查找', shortcut: '⌘F', action: () => dispatch({ type: 'TOGGLE_SEARCH' }) },
        { label: '替换', shortcut: '⌘H' },
      ],
    },
    {
      label: '视图',
      items: [
        { label: '编辑模式', action: () => dispatch({ type: 'SET_VIEW_MODE', payload: 'edit' }) },
        { label: '预览模式', action: () => dispatch({ type: 'SET_VIEW_MODE', payload: 'preview' }) },
        { label: '双栏模式', shortcut: '⌘⌥2', action: () => dispatch({ type: 'SET_VIEW_MODE', payload: 'split' }) },
        { divider: true },
        { label: '显示 / 隐藏侧边栏', action: () => dispatch({ type: 'TOGGLE_SIDEBAR' }) },
        { label: '显示 / 隐藏大纲', action: () => dispatch({ type: 'TOGGLE_OUTLINE' }) },
        { divider: true },
        { label: '放大' },
        { label: '缩小' },
        { label: '重置缩放' },
        { divider: true },
        { label: '浅色主题', action: () => dispatch({ type: 'SET_THEME', payload: 'light' }) },
        { label: '深色主题', action: () => dispatch({ type: 'SET_THEME', payload: 'dark' }) },
        { label: '跟随系统', action: () => dispatch({ type: 'SET_THEME', payload: 'system' }) },
      ],
    },
    {
      label: '插入',
      items: [
        { label: '插入图片' },
        { label: '插入链接' },
        { label: '插入表格' },
        { label: '插入代码块' },
        { label: '插入分割线' },
        { label: '插入任务列表' },
        { divider: true },
        { label: '插入当前日期', action: () => {
          const activeTab = state.tabs.find(t => t.id === state.activeTabId);
          if (activeTab) {
            const date = new Date().toISOString().split('T')[0];
            dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: activeTab.content + date } });
          }
        }},
      ],
    },
    {
      label: '导出',
      items: [
        { label: '导出为 PDF', action: handleExportPDF },
        { label: '导出为 HTML', action: handleExportHTML },
        { divider: true },
      ],
    },
    {
      label: '窗口',
      items: [
        { label: '最小化' },
        { label: '最大化' },
        { label: '关闭窗口' },
        { divider: true },
        { label: '切换上一个标签', action: () => {
          const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
          if (idx > 0) dispatch({ type: 'SET_ACTIVE_TAB', payload: state.tabs[idx - 1].id });
        }},
        { label: '切换下一个标签', action: () => {
          const idx = state.tabs.findIndex(t => t.id === state.activeTabId);
          if (idx >= 0 && idx < state.tabs.length - 1) dispatch({ type: 'SET_ACTIVE_TAB', payload: state.tabs[idx + 1].id });
        }},
      ],
    },
    {
      label: '帮助',
      items: [
        { label: 'Markdown 语法帮助' },
        { label: '快捷键说明' },
        { divider: true },
        { label: '检查更新' },
        { divider: true },
        { label: '关于 Orcha Writer' },
      ],
    },
  ], [dispatch, state.tabs, state.activeTabId, handleNewFile, handleOpenFile, handleSave]);

  const menus = buildMenus();

  const handleClick = useCallback((label: string) => {
    setActiveMenu(prev => prev === label ? null : label);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="menubar" ref={menuRef}>
      {menus.map(menu => (
        <div key={menu.label}>
          <button
            className={`menu-item ${activeMenu === menu.label ? 'active' : ''}`}
            onClick={() => handleClick(menu.label)}
          >
            {menu.label}
          </button>
          {activeMenu === menu.label && (
            <div className="menu-dropdown">
              {menu.items.map((item, i) =>
                item.divider ? (
                  <div key={i} className="menu-dropdown-divider" />
                ) : (
                  <div
                    key={i}
                    className={`menu-dropdown-item ${item.disabled ? 'disabled' : ''}`}
                    onClick={() => {
                      if (item.action) item.action();
                      setActiveMenu(null);
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

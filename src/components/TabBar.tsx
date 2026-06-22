import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { Menu, type MenuOptions } from '@tauri-apps/api/menu';
import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { X } from 'lucide-react';
import { message } from 'antd';
import { rename, revealInFileManager } from '../utils/fs';
import { getLocaleText, normalizeAppLanguage, translateText } from '../i18n';
import { confirmCloseTabs } from '../utils/unsavedTabs';
import type { TabFile } from '../types';

function renamedPath(path: string, nextName: string): string {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex >= 0 ? `${path.slice(0, separatorIndex + 1)}${nextName}` : nextName;
}

function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function relativeWorkspacePath(path: string, workspacePath: string): string {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedWorkspace = normalizePathForCompare(workspacePath);
  if (normalizedPath === normalizedWorkspace) return '';
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return normalizedPath;
}

function isPathWithinWorkspace(path: string, workspacePath: string): boolean {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedWorkspace = normalizePathForCompare(workspacePath);
  return normalizedPath === normalizedWorkspace || normalizedPath.startsWith(`${normalizedWorkspace}/`);
}

function systemFileManagerName(language: string): string {
  const platform = `${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
  const isChinese = language.toLowerCase().startsWith('zh');
  if (platform.includes('mac')) return isChinese ? '访达' : 'Finder';
  if (platform.includes('win')) return isChinese ? '文件资源管理器' : 'File Explorer';
  return isChinese ? '文件管理器' : 'File Manager';
}

async function writeClipboardText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('copy failed');
}

function hasUsableFilePath(tab: TabFile): boolean {
  return !tab.isDraft && /[/\\]/.test(tab.path);
}

export default function TabBar() {
  const { state, dispatch } = useApp();
  const appearance = useSettingsStore(s => s.appearance);
  const language = useSettingsStore(s => s.general.language);
  const text = getLocaleText(language);
  const appLanguage = normalizeAppLanguage(language);
  const t = useCallback((value: string) => translateText(language, value), [language]);
  const fileManagerName = useMemo(() => systemFileManagerName(appLanguage), [appLanguage]);
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const renameInFlightRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    const container = tabBarRef.current;
    const activeTab = activeTabRef.current;
    if (!container || !activeTab) return;

    const padding = 12;
    const containerLeft = container.scrollLeft;
    const containerRight = containerLeft + container.clientWidth;
    const tabLeft = activeTab.offsetLeft;
    const tabRight = tabLeft + activeTab.offsetWidth;

    if (tabLeft < containerLeft + padding) {
      container.scrollTo({ left: Math.max(tabLeft - padding, 0), behavior: 'smooth' });
    } else if (tabRight > containerRight - padding) {
      container.scrollTo({ left: tabRight - container.clientWidth + padding, behavior: 'smooth' });
    }
  }, [state.activeTabId, state.tabs.length]);

  const beginRename = useCallback((tabId: string, currentName: string) => {
    renameInFlightRef.current = false;
    renameCancelledRef.current = false;
    setRenamingTabId(tabId);
    setRenameValue(currentName);
  }, []);

  const cancelRename = useCallback(() => {
    renameInFlightRef.current = false;
    renameCancelledRef.current = true;
    setRenamingTabId(null);
    setRenameValue('');
  }, []);

  const submitRename = useCallback(async () => {
    if (!renamingTabId || renameInFlightRef.current) return;
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      return;
    }

    const tab = state.tabs.find(item => item.id === renamingTabId);
    if (!tab) {
      cancelRename();
      return;
    }

    const nextName = renameValue.trim();
    if (!nextName || nextName === tab.name) {
      cancelRename();
      return;
    }

    if (tab.isDraft || !/[/\\]/.test(tab.path)) {
      dispatch({ type: 'RENAME_TAB_TITLE', payload: { id: tab.id, name: nextName } });
      cancelRename();
      return;
    }

    const newPath = renamedPath(tab.path, nextName);
    renameInFlightRef.current = true;
    try {
      await rename(tab.path, newPath);
      dispatch({ type: 'RENAME_PATH', payload: { oldPath: tab.path, newPath, name: nextName } });
    } catch (error) {
      console.error('Failed to rename tab file:', error);
    } finally {
      renameInFlightRef.current = false;
      setRenamingTabId(null);
      setRenameValue('');
    }
  }, [cancelRename, dispatch, renameValue, renamingTabId, state.tabs]);

  const closeTab = useCallback(async (tabId: string) => {
    const tab = state.tabs.find(item => item.id === tabId);
    if (!tab) return;
    if (!(await confirmCloseTabs([tab], language))) return;
    dispatch({ type: 'CLOSE_TAB', payload: tabId });
  }, [dispatch, language, state.tabs]);

  const closeOtherTabs = useCallback(async (tabId: string) => {
    const tabsToClose = state.tabs.filter(item => item.id !== tabId);
    if (!(await confirmCloseTabs(tabsToClose, language))) return;
    dispatch({ type: 'CLOSE_OTHER_TABS', payload: tabId });
  }, [dispatch, language, state.tabs]);

  const closeAllTabs = useCallback(async () => {
    if (!(await confirmCloseTabs(state.tabs, language))) return;
    dispatch({ type: 'CLOSE_ALL_TABS' });
  }, [dispatch, language, state.tabs]);

  const copyTabPath = useCallback(async (path: string, relative: boolean) => {
    const value = relative && state.workspacePath ? relativeWorkspacePath(path, state.workspacePath) : path;
    try {
      await writeClipboardText(value);
      message.success(relative ? text.sidebar.relativePathCopied : text.sidebar.pathCopied);
    } catch (error) {
      console.error('Failed to copy tab path:', error);
      message.error(text.sidebar.copyPathFailed);
    }
  }, [state.workspacePath, text.sidebar]);

  const revealTabInFileManager = useCallback(async (path: string) => {
    try {
      await revealInFileManager(path);
    } catch (error) {
      console.error('Failed to reveal tab path in file manager:', error);
      message.error(text.sidebar.revealInFileManagerFailed(fileManagerName));
    }
  }, [fileManagerName, text.sidebar]);

  const handleTabContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>, tabId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setRenamingTabId(null);
    setRenameValue('');

    const tab = state.tabs.find(item => item.id === tabId);
    if (!tab) return;

    const canUsePath = hasUsableFilePath(tab);
    const canCopyRelativePath = canUsePath
      && Boolean(state.workspacePath && isPathWithinWorkspace(tab.path, state.workspacePath));

    const items: NonNullable<MenuOptions['items']> = [
      { text: text.contextMenu.rename, action: () => beginRename(tab.id, tab.name) },
      { item: 'Separator' },
      {
        text: text.contextMenu.copyPath,
        enabled: canUsePath,
        action: () => { void copyTabPath(tab.path, false); },
      },
      {
        text: text.contextMenu.copyRelativePath,
        enabled: canCopyRelativePath,
        action: () => { void copyTabPath(tab.path, true); },
      },
      {
        text: text.contextMenu.showInFileManager(fileManagerName),
        enabled: canUsePath,
        action: () => { void revealTabInFileManager(tab.path); },
      },
      { item: 'Separator' },
      { text: t('关闭'), action: () => { void closeTab(tabId); } },
      {
        text: t('关闭其他标签'),
        enabled: state.tabs.length > 1,
        action: () => { void closeOtherTabs(tabId); },
      },
      { text: t('关闭所有标签'), action: () => { void closeAllTabs(); } },
    ];

    void Menu
      .new({ items })
      .then(menu => menu.popup(new LogicalPosition(event.clientX, event.clientY)))
      .catch(error => {
        console.error('Failed to open tab context menu:', error);
      });
  }, [
    beginRename,
    closeAllTabs,
    closeOtherTabs,
    closeTab,
    copyTabPath,
    fileManagerName,
    revealTabInFileManager,
    state.tabs,
    state.workspacePath,
    t,
    text.contextMenu,
  ]);

  const handleCloseTab = useCallback((tabId: string) => {
    void closeTab(tabId);
  }, [closeTab]);

  if (state.tabs.length === 0) return null;
  if (!appearance.showTabs) return null;

  return (
    <div className="tab-bar" ref={tabBarRef}>
      {state.tabs.map(tab => (
        <div
          key={tab.id}
          ref={(element) => {
            if (state.activeTabId === tab.id) activeTabRef.current = element;
          }}
          className={`tab ${state.activeTabId === tab.id ? 'active' : ''}`}
          onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', payload: tab.id })}
          onAuxClick={(e) => { if (e.button === 1) handleCloseTab(tab.id); }}
          onContextMenu={(event) => handleTabContextMenu(event, tab.id)}
        >
          {!tab.saved && <span className="unsaved-dot" />}
          {renamingTabId === tab.id ? (
            <input
              className="tab-rename-input"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={() => { void submitRename(); }}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  void submitRename();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelRename();
                }
              }}
              autoFocus
            />
          ) : (
            <span
              className="tab-name"
              onDoubleClick={(event) => {
                event.stopPropagation();
                beginRename(tab.id, tab.name);
              }}
            >
              {tab.name}
            </span>
          )}
          <button
            className="tab-close"
            onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
            title={t('关闭标签')}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

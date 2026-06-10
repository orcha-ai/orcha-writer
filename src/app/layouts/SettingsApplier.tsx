import { useEffect, useRef, useState } from 'react';
import { Modal } from 'antd';
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useAiStore, usePluginStore, useSettingsStore, useShortcutStore, useUpdateStore } from '../../store';
import { useApp } from '../../AppContext';
import { getActiveEditorView } from '../../components/Editor';
import { readConfig, writeConfig } from '../../config';
import { readTextFile } from '../../utils/fs';
import { findFirstMdFile, readFirstLevel } from '../../utils/workspace';
import type { FileSettings, GeneralSettings, TabFile } from '../../types';
import { normalizeAppLanguage, translateText } from '../../i18n';

function normalizeThemeColor(color: string | undefined): string {
  const value = color?.trim();
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#0A84FF';
}

function applyThemeColorVariables(root: HTMLElement, color: string): void {
  root.style.setProperty('--theme-color', color);
  root.style.setProperty('--brand', color);
  root.style.setProperty('--accent', color);
  root.style.setProperty('--border-accent', color);
  root.style.setProperty('--text-link', color);
  root.style.setProperty('--md-link', color);
  root.style.setProperty('--md-quote-border', color);

  root.style.setProperty('--accent-hover', `color-mix(in srgb, ${color} 84%, var(--text-primary))`);
  root.style.setProperty('--accent-active', `color-mix(in srgb, ${color} 72%, var(--text-primary))`);
  root.style.setProperty('--text-link-hover', `color-mix(in srgb, ${color} 84%, var(--text-primary))`);
  root.style.setProperty('--md-link-hover', `color-mix(in srgb, ${color} 84%, var(--text-primary))`);

  root.style.setProperty('--accent-bg', `color-mix(in srgb, ${color} 14%, var(--bg-primary))`);
  root.style.setProperty('--accent-bg-soft', `color-mix(in srgb, ${color} 8%, var(--bg-primary))`);
  root.style.setProperty('--accent-border', `color-mix(in srgb, ${color} 42%, var(--border-primary))`);
  root.style.setProperty('--bg-active', `color-mix(in srgb, ${color} 14%, var(--bg-primary))`);
  root.style.setProperty('--bg-tree-active', `color-mix(in srgb, ${color} 16%, var(--bg-primary))`);
}

function getUnsavedTabs(tabs: TabFile[]): TabFile[] {
  return tabs.filter(tab => tab.isDraft || !tab.saved);
}

function formatUnsavedTabsMessage(tabs: TabFile[], language: unknown): string {
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  if (tabs.length === 1) {
    return t('「{name}」尚未保存。退出后未保存的修改会丢失。', { name: tabs[0].name });
  }

  const visibleNames = tabs.slice(0, 3).map(tab => `「${tab.name}」`).join('、');
  const moreText = tabs.length > 3 ? t(' 等') : '';
  return t('有 {count} 个文档尚未保存：{names}{moreText}。退出后未保存的修改会丢失。', {
    count: tabs.length,
    names: visibleNames,
    moreText,
  });
}

function confirmUnsavedExit(tabs: TabFile[], language: unknown): Promise<boolean> {
  const content = formatUnsavedTabsMessage(tabs, language);
  const t = (value: string) => translateText(language, value);
  return confirmDialog(content, {
    title: t('有未保存的文档'),
    kind: 'warning',
    okLabel: t('仍然退出'),
    cancelLabel: t('取消'),
  }).catch(() => new Promise((resolve) => {
    Modal.confirm({
      title: t('有未保存的文档'),
      content,
      okText: t('仍然退出'),
      okButtonProps: { danger: true },
      cancelText: t('取消'),
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  }));
}

export function SettingsApplier() {
  const { appearance, editor, general, preview, loadAll, updateGeneral } = useSettingsStore();
  const loadShortcuts = useShortcutStore(s => s.load);
  const loadPlugins = usePluginStore(s => s.load);
  const loadAi = useAiStore(s => s.load);
  const { state, dispatch } = useApp();
  const [settingsReady, setSettingsReady] = useState(false);
  const tabsRef = useRef(state.tabs);
  const activeTabIdRef = useRef(state.activeTabId);
  const viewModeRef = useRef(state.viewMode);
  const exitPromptOpenRef = useRef(false);

  useEffect(() => {
    tabsRef.current = state.tabs;
  }, [state.tabs]);

  useEffect(() => {
    activeTabIdRef.current = state.activeTabId;
  }, [state.activeTabId]);

  useEffect(() => {
    viewModeRef.current = state.viewMode;
  }, [state.viewMode]);

  useEffect(() => {
    let cancelled = false;
    let syncInFlight = false;

    const syncSavedTabsFromDisk = async () => {
      if (syncInFlight) return;
      const tabs = tabsRef.current.filter(tab => !tab.isDraft && !tab.preview && tab.saved);
      if (tabs.length === 0) return;

      syncInFlight = true;
      try {
        await Promise.all(tabs.map(async (tab) => {
          const previousContent = tab.content;
          try {
            const content = await readTextFile(tab.path);
            if (cancelled || content === previousContent) return;

            const latestTab = tabsRef.current.find(current => current.id === tab.id);
            if (
              !latestTab ||
              latestTab.isDraft ||
              latestTab.preview ||
              !latestTab.saved ||
              latestTab.content !== previousContent
            ) {
              return;
            }
            if (latestTab.id === activeTabIdRef.current) {
              if (viewModeRef.current === 'block') return;
              const editorView = getActiveEditorView();
              if (editorView && editorView.state.doc.toString() !== previousContent) return;
            }

            dispatch({ type: 'REFRESH_TAB_CONTENT', payload: { id: tab.id, content } });
          } catch {
            // The file may have been deleted, moved, or be temporarily unreadable.
          }
        }));
      } finally {
        syncInFlight = false;
      }
    };

    void syncSavedTabsFromDisk();
    const intervalId = window.setInterval(syncSavedTabsFromDisk, 1800);
    window.addEventListener('focus', syncSavedTabsFromDisk);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncSavedTabsFromDisk);
    };
  }, [dispatch]);

  // Load settings on mount
  useEffect(() => {
    let cancelled = false;

    const restoreStartupWorkspace = async (generalSettings: GeneralSettings, fileSettings: FileSettings) => {
      const lastWorkspace = await readConfig<string>('workspace-path', '');
      let startupOpen = generalSettings.startupOpen;
      const migrationMarked = await readConfig<boolean>('startup-open-migrated', false);

      if (startupOpen === 'blank' && lastWorkspace) {
        if (!migrationMarked) {
          startupOpen = 'last-workspace';
          const nextGeneral = { ...generalSettings, startupOpen };
          updateGeneral({ startupOpen });
          await writeConfig('app', nextGeneral);
          await writeConfig('startup-open-migrated', true);
        }
      } else if (startupOpen !== 'blank' && !migrationMarked) {
        await writeConfig('startup-open-migrated', true);
      }

      if (startupOpen === 'blank') return;

      const configuredWorkspace = fileSettings.defaultWorkspace.trim();
      const workspacePath = startupOpen === 'specific-workspace'
        ? configuredWorkspace || lastWorkspace
        : lastWorkspace;

      if (!workspacePath) return;

      try {
        const tree = await readFirstLevel(workspacePath, fileSettings.hidePatterns);
        if (cancelled) return;
        dispatch({ type: 'SET_WORKSPACE', payload: { path: workspacePath, tree } });

        const firstMd = findFirstMdFile(tree);
        if (!firstMd) return;
        try {
          const content = await readTextFile(firstMd.path);
          if (cancelled) return;
          dispatch({ type: 'OPEN_TAB', payload: { id: firstMd.path, name: firstMd.name, path: firstMd.path, content } });
          dispatch({ type: 'ADD_RECENT_FILE', payload: { path: firstMd.path, name: firstMd.name, lastOpened: Date.now() } });
        } catch {
          if (!cancelled) {
            dispatch({ type: 'OPEN_TAB', payload: { id: firstMd.path, name: firstMd.name, path: firstMd.path, content: `# ${firstMd.name.replace(/\.\w+$/, '')}\n\n` } });
          }
        }
      } catch (error) {
        console.warn('[SettingsApplier] Failed to restore workspace:', error);
      }
    };

    void (async () => {
      await loadAll();
      if (!cancelled) setSettingsReady(true);
      void loadShortcuts();
      void loadPlugins();
      void loadAi();
      const settings = useSettingsStore.getState();
      if (settings.general.autoUpdate) {
        void useUpdateStore.getState().checkLatest();
      }
      await restoreStartupWorkspace(settings.general, settings.files);
    })();

    return () => { cancelled = true; };
  }, [dispatch, loadAll, loadShortcuts, loadPlugins, loadAi, updateGeneral]);

  // Apply loaded settings to AppContext
  useEffect(() => {
    if (!settingsReady) return;

    // Sync theme
    const theme = appearance.themeMode === 'light' ? 'light' : appearance.themeMode === 'dark' ? 'dark' : 'system' as const;
    dispatch({ type: 'SET_THEME', payload: theme });
    dispatch({ type: 'SET_SIDEBAR_VISIBLE', payload: appearance.showSidebar });
    dispatch({ type: 'SET_OUTLINE_VISIBLE', payload: appearance.showOutline });
    dispatch({ type: 'SET_AI_CHAT_COLLAPSED', payload: appearance.aiChatCollapsed });
  }, [
    appearance.aiChatCollapsed,
    appearance.showOutline,
    appearance.showSidebar,
    appearance.themeMode,
    dispatch,
    settingsReady,
  ]);

  // Sync general settings to AppContext
  useEffect(() => {
    const language = normalizeAppLanguage(general.language);
    document.documentElement.lang = language;
    document.documentElement.setAttribute('data-locale', language);
    void invoke('set_app_menu_language', { language }).catch(() => {
      // Browser/dev mode has no native menu.
    });

    dispatch({
      type: 'UPDATE_SETTINGS',
      payload: {
        syncScroll: preview.syncScroll,
      },
    });
  }, [dispatch, general.language, preview.syncScroll]);

  // Keep recent files capped by the user-configured count.
  useEffect(() => {
    const maxRecent = Math.min(Math.max(general.recentFileCount || 10, 1), 50);
    if (!settingsReady) return;
    if (state.recentFiles.length > maxRecent) {
      dispatch({ type: 'SET_RECENT_FILES', payload: state.recentFiles.slice(0, maxRecent) });
    }
  }, [dispatch, general.recentFileCount, settingsReady, state.recentFiles]);

  // Always quit the app when the main window is closed, after warning about unsaved documents.
  useEffect(() => {
    if (!isTauri()) return undefined;

    let unlisten: (() => void) | undefined;

    void getCurrentWindow().onCloseRequested(event => {
      event.preventDefault();
      const unsavedTabs = getUnsavedTabs(tabsRef.current);
      if (unsavedTabs.length === 0) {
        void invoke('exit_app');
        return;
      }

      if (exitPromptOpenRef.current) return;
      exitPromptOpenRef.current = true;

      void confirmUnsavedExit(unsavedTabs, useSettingsStore.getState().general.language).then(shouldExit => {
        exitPromptOpenRef.current = false;
        if (shouldExit) void invoke('exit_app');
      });
    }).then(fn => {
      unlisten = fn;
    }).catch(error => {
      console.warn('[SettingsApplier] Failed to bind close behavior:', error);
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // Sync toolbar view mode changes back to settings store
  useEffect(() => {
    if (state.viewMode !== general.lastViewMode) {
      updateGeneral({ lastViewMode: state.viewMode });
    }
  }, [general.lastViewMode, state.viewMode, updateGeneral]);

  // Apply appearance CSS variables
  useEffect(() => {
    const root = document.documentElement;
    if (appearance.themeMode !== 'system') {
      root.setAttribute('data-theme', appearance.themeMode);
    } else {
      root.removeAttribute('data-theme');
    }
    root.style.setProperty('--editor-font-size', `${editor.fontSize || 14}px`);
    root.style.setProperty('--preview-font-size', `${preview.fontSize || 16}px`);
    root.style.setProperty('--font-sans', appearance.font || 'system-ui, -apple-system, sans-serif');
    root.style.setProperty('--editor-font-family', editor.fontFamily || 'system-ui, -apple-system, sans-serif');
    root.style.setProperty('--editor-line-height', String(editor.lineHeight || 1.6));

    // Theme color
    applyThemeColorVariables(root, normalizeThemeColor(appearance.themeColor));

    // Density
    const density = appearance.density || 'standard';
    const densityMap = { compact: '0.8', standard: '1', comfortable: '1.2' };
    root.style.setProperty('--density-scale', densityMap[density] || '1');

    // Transparency (frosted glass)
    if (appearance.transparency) {
      root.setAttribute('data-transparency', 'true');
    } else {
      root.removeAttribute('data-transparency');
    }
  }, [appearance.themeMode, appearance.themeColor, appearance.density, appearance.font, appearance.transparency, editor.fontSize, editor.fontFamily, editor.lineHeight, preview.fontSize]);

  return null;
}

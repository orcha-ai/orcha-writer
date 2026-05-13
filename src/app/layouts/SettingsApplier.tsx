import { useEffect, useRef, useState } from 'react';
import { message, Modal } from 'antd';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { useAiStore, usePluginStore, useSettingsStore, useShortcutStore } from '../../store';
import { useApp } from '../../AppContext';
import { readConfig, writeConfig } from '../../config';
import { readTextFile } from '../../utils/fs';
import { installAvailableUpdate, relaunchApplication } from '../../utils/update';
import { findFirstMdFile, readFirstLevel } from '../../utils/workspace';
import type { FileSettings, GeneralSettings, TabFile } from '../../types';
import { normalizeAppLanguage } from '../../i18n';

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

function formatUnsavedTabsMessage(tabs: TabFile[]): string {
  if (tabs.length === 1) {
    return `「${tabs[0].name}」尚未保存。退出后未保存的修改会丢失。`;
  }

  const visibleNames = tabs.slice(0, 3).map(tab => `「${tab.name}」`).join('、');
  const moreText = tabs.length > 3 ? ' 等' : '';
  return `有 ${tabs.length} 个文档尚未保存：${visibleNames}${moreText}。退出后未保存的修改会丢失。`;
}

export function SettingsApplier() {
  const { appearance, editor, general, preview, loadAll, updateGeneral } = useSettingsStore();
  const loadShortcuts = useShortcutStore(s => s.load);
  const loadPlugins = usePluginStore(s => s.load);
  const loadAi = useAiStore(s => s.load);
  const { state, dispatch } = useApp();
  const [settingsReady, setSettingsReady] = useState(false);
  const tabsRef = useRef(state.tabs);
  const exitPromptOpenRef = useRef(false);

  useEffect(() => {
    tabsRef.current = state.tabs;
  }, [state.tabs]);

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
        void installAvailableUpdate()
          .then(result => {
            if (cancelled) return;
            if (result.status === 'installed') {
              Modal.confirm({
                title: `新版本 ${result.latestVersion} 已安装`,
                content: '重启应用后即可使用新版本。',
                okText: '立即重启',
                cancelText: '稍后',
                onOk: () => relaunchApplication(),
              });
            } else if (result.status === 'manual') {
              message.info(`发现新版本 ${result.latestVersion}，自动安装暂不可用，可在关于页面手动下载`);
            }
          })
          .catch(error => console.warn('[SettingsApplier] Auto update failed:', error));
      }
      await restoreStartupWorkspace(settings.general, settings.files);
    })();

    return () => { cancelled = true; };
  }, [dispatch, loadAll, loadShortcuts, loadPlugins, loadAi, updateGeneral]);

  // Apply loaded settings to AppContext
  useEffect(() => {
    // Sync theme
    const theme = appearance.themeMode === 'light' ? 'light' : appearance.themeMode === 'dark' ? 'dark' : 'system' as const;
    dispatch({ type: 'SET_THEME', payload: theme });
    dispatch({ type: 'SET_SIDEBAR_VISIBLE', payload: appearance.showSidebar });
    dispatch({ type: 'SET_OUTLINE_VISIBLE', payload: appearance.showOutline });
  }, [appearance.showOutline, appearance.showSidebar, appearance.themeMode, dispatch]);

  // Sync general settings to AppContext
  useEffect(() => {
    const language = normalizeAppLanguage(general.language);
    document.documentElement.lang = language;
    document.documentElement.setAttribute('data-locale', language);

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

      Modal.confirm({
        title: '有未保存的文档',
        content: formatUnsavedTabsMessage(unsavedTabs),
        okText: '仍然退出',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => {
          exitPromptOpenRef.current = false;
          void invoke('exit_app');
        },
        onCancel: () => {
          exitPromptOpenRef.current = false;
        },
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
  }, [appearance.themeMode, appearance.themeColor, appearance.density, appearance.font, appearance.transparency, editor.fontSize, editor.fontFamily, editor.lineHeight]);

  return null;
}

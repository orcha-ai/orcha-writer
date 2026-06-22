import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { Dispatch } from 'react';
import type { AppAction } from '../AppContext';
import type { RecentWorkspace } from '../types';
import { readTextFile } from './fs';
import { findFirstMdFile, readFirstLevel } from './workspace';

const RECENT_WORKSPACE_LIMIT = 20;

type AppDispatch = Dispatch<AppAction>;
interface OpenWorkspaceWindowResult {
  path: string;
}

export function workspaceNameFromPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) || normalized : normalized;
}

export function normalizeWorkspacePathForCompare(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function sameWorkspacePath(left: string, right: string): boolean {
  return normalizeWorkspacePathForCompare(left) === normalizeWorkspacePathForCompare(right);
}

export function recentWorkspaceForPath(path: string, lastOpened = Date.now()): RecentWorkspace {
  return {
    path,
    name: workspaceNameFromPath(path),
    lastOpened,
  };
}

async function setWorkspaceWindowTitle(workspacePath: string): Promise<void> {
  const workspaceName = workspaceNameFromPath(workspacePath);
  const title = workspaceName;
  document.title = title;
  if (!isTauri()) return;
  await invoke('set_app_menu_workspace_title', { title: workspaceName }).catch(() => undefined);
  await getCurrentWebviewWindow().setTitle(title).catch(() => undefined);
}

async function registerWorkspaceWindow(path: string): Promise<string> {
  if (!isTauri()) return path;
  return invoke<string>('register_workspace_window', { path });
}

export async function getInitialWorkspacePathForWindow(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>('initial_workspace_path_for_window');
}

export async function loadWorkspaceInCurrentWindow(
  dispatch: AppDispatch,
  path: string,
  options: {
    hidePatterns?: string[];
    untitledLabel?: string;
    autoOpenFirstMarkdown?: boolean;
  } = {},
): Promise<string> {
  const tree = await readFirstLevel(path, options.hidePatterns || []);
  dispatch({ type: 'SET_WORKSPACE', payload: { path, tree } });
  dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'workspace' });

  const registeredPath = await registerWorkspaceWindow(path).catch(() => path);
  dispatch({ type: 'ADD_RECENT_WORKSPACE', payload: recentWorkspaceForPath(registeredPath) });
  await setWorkspaceWindowTitle(registeredPath).catch(() => undefined);

  if (options.autoOpenFirstMarkdown !== false) {
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
        dispatch({
          type: 'OPEN_TAB',
          payload: {
            id: firstMd.path,
            name: firstMd.name,
            path: firstMd.path,
            content: `# ${firstMd.name.replace(/\.\w+$/, '') || options.untitledLabel || 'Untitled'}\n\n`,
          },
        });
      }
    }
  }

  return registeredPath;
}

export async function openWorkspace(
  dispatch: AppDispatch,
  path: string,
  options: {
    currentWorkspacePath: string | null;
    hidePatterns?: string[];
    untitledLabel?: string;
    forceCurrentWindow?: boolean;
  },
): Promise<'current' | 'window'> {
  const cleanPath = path.trim();
  if (!cleanPath) return 'current';

  if (
    !options.forceCurrentWindow
    && options.currentWorkspacePath
    && !sameWorkspacePath(options.currentWorkspacePath, cleanPath)
    && isTauri()
  ) {
    const result = await invoke<OpenWorkspaceWindowResult>('open_workspace_window', { path: cleanPath });
    dispatch({ type: 'ADD_RECENT_WORKSPACE', payload: recentWorkspaceForPath(result.path || cleanPath) });
    return 'window';
  }

  await loadWorkspaceInCurrentWindow(dispatch, cleanPath, {
    hidePatterns: options.hidePatterns,
    untitledLabel: options.untitledLabel,
  });
  return 'current';
}

export function trimRecentWorkspaces(items: RecentWorkspace[]): RecentWorkspace[] {
  return items.slice(0, RECENT_WORKSPACE_LIMIT);
}

export function mergeRecentWorkspaces(items: RecentWorkspace[]): RecentWorkspace[] {
  const seen = new Set<string>();
  return items
    .filter(item => item.path)
    .sort((left, right) => right.lastOpened - left.lastOpened)
    .filter(item => {
      if (seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    })
    .slice(0, RECENT_WORKSPACE_LIMIT);
}

export async function syncRecentWorkspaceMenu(workspaces: RecentWorkspace[]): Promise<void> {
  if (!isTauri()) return;
  await invoke('set_recent_workspace_menu', {
    workspaces: trimRecentWorkspaces(workspaces).map(workspace => ({
      name: workspace.name,
      path: workspace.path,
    })),
  });
}

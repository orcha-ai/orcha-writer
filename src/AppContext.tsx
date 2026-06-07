/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useState, useCallback } from 'react';
import type {
  AppState, TabFile, FileNode, ViewMode, ThemeMode,
  RecentFile, EditorSettings, AppearanceSettings, BlockSelectionStatus, FilePreview
} from './types';
import { defaultAppearanceSettings, defaultEditorSettings } from './types';
import { readConfig, writeConfig } from './config';
import { effectiveViewModeForDocument } from './utils/documentCapabilities';

export type AppAction =
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'SET_THEME'; payload: ThemeMode }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_VISIBLE'; payload: boolean }
  | { type: 'TOGGLE_OUTLINE' }
  | { type: 'SET_OUTLINE_VISIBLE'; payload: boolean }
  | { type: 'SET_SIDEBAR_TAB'; payload: 'workspace' | 'outline' | 'recent' }
  | { type: 'OPEN_TAB'; payload: { id: string; name: string; path: string; content: string; isDraft?: boolean; preview?: FilePreview } }
  | { type: 'SAVE_TAB_AS'; payload: { oldId: string; id: string; name: string; path: string; content: string } }
  | { type: 'CLOSE_TAB'; payload: string }
  | { type: 'CLOSE_OTHER_TABS'; payload: string }
  | { type: 'CLOSE_ALL_TABS' }
  | { type: 'SET_ACTIVE_TAB'; payload: string | null }
  | { type: 'UPDATE_TAB_CONTENT'; payload: { id: string; content: string } }
  | { type: 'REFRESH_TAB_CONTENT'; payload: { id: string; content: string } }
  | { type: 'MARK_TAB_SAVED'; payload: string }
  | { type: 'MARK_TAB_UNSAVED'; payload: string }
  | { type: 'RENAME_TAB_TITLE'; payload: { id: string; name: string } }
  | { type: 'RENAME_PATH'; payload: { oldPath: string; newPath: string; name: string } }
  | { type: 'SET_WORKSPACE'; payload: { path: string; tree: FileNode[] } }
  | { type: 'SET_RECENT_FILES'; payload: RecentFile[] }
  | { type: 'ADD_RECENT_FILE'; payload: RecentFile }
  | { type: 'SET_CURSOR'; payload: { line: number; ch: number } }
  | { type: 'SET_WORD_COUNT'; payload: number }
  | { type: 'TOGGLE_SEARCH' }
  | { type: 'OPEN_SEARCH'; payload?: { replace?: boolean } }
  | { type: 'CLOSE_SEARCH' }
  | { type: 'TOGGLE_REPLACE' }
  | { type: 'SET_REPLACE_OPEN'; payload: boolean }
  | { type: 'SET_SEARCH_QUERY'; payload: string }
  | { type: 'SET_SEARCH_MATCH_INDEX'; payload: number }
  | { type: 'TOGGLE_COMMAND_PALETTE' }
  | { type: 'SET_COMMAND_PALETTE_OPEN'; payload: boolean }
  | { type: 'TOGGLE_GLOBAL_SEARCH' }
  | { type: 'SET_GLOBAL_SEARCH_OPEN'; payload: boolean }
  | { type: 'TOGGLE_TERMINAL' }
  | { type: 'SET_TERMINAL_OPEN'; payload: boolean }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<EditorSettings> }
  | { type: 'SET_BLOCK_SELECTION_STATUS'; payload: BlockSelectionStatus | null };

const initialState: AppState = {
  tabs: [],
  activeTabId: null,
  viewMode: 'split',
  theme: 'system',
  sidebarVisible: true,
  outlineVisible: true,
  sidebarActiveTab: 'workspace',
  workspacePath: null,
  workspaceTree: [],
  recentFiles: [],
  cursorPosition: { line: 1, ch: 1 },
  wordCount: 0,
  searchOpen: false,
  searchQuery: '',
  searchMatchIndex: 0,
  replaceOpen: false,
  commandPaletteOpen: false,
  globalSearchOpen: false,
  terminalOpen: false,
  settingsOpen: false,
  editorSettings: defaultEditorSettings,
  blockSelectionStatus: null,
};

function rebasePath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`) || path.startsWith(`${oldPath}\\`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }
  return path;
}

function rebaseFileTree(nodes: FileNode[], oldPath: string, newPath: string, name: string): FileNode[] {
  return nodes.map(node => {
    const nextNode: FileNode = {
      ...node,
      name: node.path === oldPath ? name : node.name,
      path: rebasePath(node.path, oldPath, newPath),
    };
    if (node.children) {
      nextNode.children = rebaseFileTree(node.children, oldPath, newPath, name);
    }
    return nextNode;
  });
}

function activeTabForState(state: AppState, activeTabId = state.activeTabId): TabFile | null {
  return activeTabId ? state.tabs.find(tab => tab.id === activeTabId) ?? null : null;
}

function viewModeForActiveTab(state: AppState, requestedMode = state.viewMode, activeTabId = state.activeTabId): ViewMode {
  return effectiveViewModeForDocument(activeTabForState(state, activeTabId), requestedMode);
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: viewModeForActiveTab(state, action.payload) };
    case 'SET_THEME':
      return { ...state, theme: action.payload };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarVisible: !state.sidebarVisible };
    case 'SET_SIDEBAR_VISIBLE':
      return { ...state, sidebarVisible: action.payload };
    case 'TOGGLE_OUTLINE':
      return { ...state, outlineVisible: !state.outlineVisible };
    case 'SET_OUTLINE_VISIBLE':
      return { ...state, outlineVisible: action.payload };
    case 'SET_SIDEBAR_TAB':
      return { ...state, sidebarActiveTab: action.payload };
    case 'OPEN_TAB': {
      const existing = state.tabs.find(t => t.path === action.payload.path);
      if (existing) {
        return {
          ...state,
          activeTabId: existing.id,
          viewMode: effectiveViewModeForDocument(existing, state.viewMode),
        };
      }
      const newTab: TabFile = {
        ...action.payload,
        saved: true,
        isDraft: action.payload.isDraft || false,
      };
      return {
        ...state,
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
        viewMode: effectiveViewModeForDocument(newTab, state.viewMode),
      };
    }
    case 'SAVE_TAB_AS': {
      const existing = state.tabs.find(t => t.id === action.payload.id && t.id !== action.payload.oldId);
      if (existing) {
        const nextState = {
          ...state,
          tabs: state.tabs
            .filter(t => t.id !== action.payload.oldId)
            .map(t => (
              t.id === existing.id
                ? {
                    ...t,
                    name: action.payload.name,
                    path: action.payload.path,
                    content: action.payload.content,
                    saved: true,
                    isDraft: false,
                  }
                : t
            )),
          activeTabId: existing.id,
        };
        return {
          ...nextState,
          viewMode: viewModeForActiveTab(nextState),
        };
      }

      const nextState = {
        ...state,
        tabs: state.tabs.map(t => (
          t.id === action.payload.oldId
            ? {
                ...t,
                id: action.payload.id,
                name: action.payload.name,
                path: action.payload.path,
                content: action.payload.content,
                saved: true,
                isDraft: false,
              }
            : t
        )),
        activeTabId: action.payload.id,
      };
      return {
        ...nextState,
        viewMode: viewModeForActiveTab(nextState),
      };
    }
    case 'CLOSE_TAB': {
      const idx = state.tabs.findIndex(t => t.id === action.payload);
      if (idx === -1) return state;
      const newTabs = state.tabs.filter(t => t.id !== action.payload);
      let newActive = state.activeTabId;
      if (state.activeTabId === action.payload) {
        newActive = newTabs.length > 0 ? newTabs[Math.min(idx, newTabs.length - 1)].id : null;
      }
      const nextState = { ...state, tabs: newTabs, activeTabId: newActive };
      return {
        ...nextState,
        viewMode: viewModeForActiveTab(nextState),
      };
    }
    case 'CLOSE_OTHER_TABS': {
      const nextTabs = state.tabs.filter(t => t.id === action.payload);
      const nextState = {
        ...state,
        tabs: nextTabs,
        activeTabId: action.payload,
      };
      return {
        ...nextState,
        viewMode: viewModeForActiveTab(nextState),
      };
    }
    case 'CLOSE_ALL_TABS':
      return { ...state, tabs: [], activeTabId: null };
    case 'SET_ACTIVE_TAB':
      return {
        ...state,
        activeTabId: action.payload,
        viewMode: viewModeForActiveTab(state, state.viewMode, action.payload),
      };
    case 'UPDATE_TAB_CONTENT':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.payload.id ? { ...t, content: action.payload.content, saved: false } : t
        ),
      };
    case 'REFRESH_TAB_CONTENT':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.payload.id ? { ...t, content: action.payload.content, saved: true } : t
        ),
      };
    case 'MARK_TAB_SAVED':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.payload ? { ...t, saved: true } : t
        ),
      };
    case 'MARK_TAB_UNSAVED':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.payload ? { ...t, saved: false } : t
        ),
      };
    case 'RENAME_TAB_TITLE': {
      const nextState = {
        ...state,
        tabs: state.tabs.map(tab =>
          tab.id === action.payload.id ? { ...tab, name: action.payload.name } : tab
        ),
      };
      return {
        ...nextState,
        viewMode: viewModeForActiveTab(nextState),
      };
    }
    case 'RENAME_PATH': {
      const { oldPath, newPath, name } = action.payload;
      const nextState = {
        ...state,
        tabs: state.tabs.map(tab => {
          const nextPath = rebasePath(tab.path, oldPath, newPath);
          if (nextPath === tab.path) return tab;
          return {
            ...tab,
            id: rebasePath(tab.id, oldPath, newPath),
            name: tab.path === oldPath ? name : tab.name,
            path: nextPath,
          };
        }),
        activeTabId: state.activeTabId ? rebasePath(state.activeTabId, oldPath, newPath) : null,
        recentFiles: state.recentFiles.map(file => {
          const nextPath = rebasePath(file.path, oldPath, newPath);
          return nextPath === file.path
            ? file
            : { ...file, path: nextPath, name: file.path === oldPath ? name : file.name };
        }),
        workspaceTree: rebaseFileTree(state.workspaceTree, oldPath, newPath, name),
      };
      return {
        ...nextState,
        viewMode: viewModeForActiveTab(nextState),
      };
    }
    case 'SET_WORKSPACE':
      return { ...state, workspacePath: action.payload.path, workspaceTree: action.payload.tree };
    case 'SET_RECENT_FILES':
      return { ...state, recentFiles: action.payload };
    case 'ADD_RECENT_FILE':
      return {
        ...state,
        recentFiles: [
          action.payload,
          ...state.recentFiles.filter(f => f.path !== action.payload.path),
        ].slice(0, 50),
      };
    case 'SET_CURSOR':
      return { ...state, cursorPosition: action.payload };
    case 'SET_WORD_COUNT':
      return { ...state, wordCount: action.payload };
    case 'TOGGLE_SEARCH':
      return {
        ...state,
        searchOpen: !state.searchOpen,
        replaceOpen: state.searchOpen ? false : state.replaceOpen,
      };
    case 'OPEN_SEARCH':
      return { ...state, searchOpen: true, replaceOpen: Boolean(action.payload?.replace) };
    case 'CLOSE_SEARCH':
      return { ...state, searchOpen: false, replaceOpen: false, searchQuery: '', searchMatchIndex: 0 };
    case 'TOGGLE_REPLACE':
      return { ...state, searchOpen: true, replaceOpen: !state.replaceOpen };
    case 'SET_REPLACE_OPEN':
      return { ...state, searchOpen: action.payload ? true : state.searchOpen, replaceOpen: action.payload };
    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.payload };
    case 'SET_SEARCH_MATCH_INDEX':
      return { ...state, searchMatchIndex: action.payload };
    case 'TOGGLE_COMMAND_PALETTE':
      return { ...state, commandPaletteOpen: !state.commandPaletteOpen, globalSearchOpen: false };
    case 'SET_COMMAND_PALETTE_OPEN':
      return { ...state, commandPaletteOpen: action.payload, globalSearchOpen: action.payload ? false : state.globalSearchOpen };
    case 'TOGGLE_GLOBAL_SEARCH':
      return { ...state, globalSearchOpen: !state.globalSearchOpen, commandPaletteOpen: false };
    case 'SET_GLOBAL_SEARCH_OPEN':
      return { ...state, globalSearchOpen: action.payload, commandPaletteOpen: action.payload ? false : state.commandPaletteOpen };
    case 'TOGGLE_TERMINAL':
      return { ...state, terminalOpen: !state.terminalOpen };
    case 'SET_TERMINAL_OPEN':
      return { ...state, terminalOpen: action.payload };
    case 'TOGGLE_SETTINGS':
      return { ...state, settingsOpen: !state.settingsOpen };
    case 'UPDATE_SETTINGS':
      return { ...state, editorSettings: { ...state.editorSettings, ...action.payload } };
    case 'SET_BLOCK_SELECTION_STATUS':
      return { ...state, blockSelectionStatus: action.payload };
    default:
      return state;
  }
}

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [initialized, setInitialized] = useState(false);

  // Load persisted config on startup
  useEffect(() => {
    let mounted = true;
    Promise.all([
      readConfig<RecentFile[]>('recent-files', []),
      readConfig<ViewMode>('view-mode', 'split' as ViewMode),
      readConfig<ThemeMode>('theme', 'system' as ThemeMode),
      readConfig<AppearanceSettings>('appearance', defaultAppearanceSettings),
    ]).then(([recentFiles, viewMode, theme, appearance]) => {
      if (!mounted) return;
      dispatch({ type: 'SET_RECENT_FILES', payload: recentFiles });
      dispatch({ type: 'SET_VIEW_MODE', payload: viewMode });
      dispatch({ type: 'SET_THEME', payload: theme });
      dispatch({
        type: 'SET_SIDEBAR_VISIBLE',
        payload: appearance.showSidebar ?? defaultAppearanceSettings.showSidebar,
      });
      dispatch({
        type: 'SET_OUTLINE_VISIBLE',
        payload: appearance.showOutline ?? defaultAppearanceSettings.showOutline,
      });
    })
      .catch((error) => {
        console.warn('[AppContext] Failed to load persisted config:', error);
      })
      .finally(() => {
        if (mounted) setInitialized(true);
      });
    return () => { mounted = false; };
  }, []);

  // Apply theme from AppContext state
  const applyTheme = useCallback((theme: ThemeMode) => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, []);

  useEffect(() => {
    applyTheme(state.theme);
  }, [state.theme, applyTheme]);

  // Persist view mode
  useEffect(() => {
    if (!initialized) return;
    writeConfig('view-mode', state.viewMode);
  }, [state.viewMode, initialized]);

  // Persist theme
  useEffect(() => {
    if (!initialized) return;
    writeConfig('theme', state.theme);
  }, [state.theme, initialized]);

  // Persist panel visibility so workspace/outline collapse survives restart.
  useEffect(() => {
    if (!initialized) return;
    void (async () => {
      const appearance = await readConfig<AppearanceSettings>('appearance', defaultAppearanceSettings);
      await writeConfig('appearance', {
        ...defaultAppearanceSettings,
        ...appearance,
        showSidebar: state.sidebarVisible,
        showOutline: state.outlineVisible,
      });
    })().catch((error) => {
      console.warn('[AppContext] Failed to persist panel visibility:', error);
    });
  }, [initialized, state.outlineVisible, state.sidebarVisible]);

  // Persist recent files whenever they change
  useEffect(() => {
    if (!initialized) return;
    writeConfig('recent-files', state.recentFiles);
  }, [state.recentFiles, initialized]);

  // Persist last opened workspace path.
  useEffect(() => {
    if (!initialized || !state.workspacePath) return;
    writeConfig('workspace-path', state.workspacePath);
  }, [state.workspacePath, initialized]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

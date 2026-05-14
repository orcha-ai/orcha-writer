import { create } from 'zustand';
import type { TabFile, ViewMode, ThemeMode, FileNode, RecentFile } from '../types';

interface AppState {
  // Tabs
  tabs: TabFile[];
  activeTabId: string | null;

  // View
  viewMode: ViewMode;
  theme: ThemeMode;

  // Sidebar
  sidebarVisible: boolean;
  outlineVisible: boolean;
  sidebarActiveTab: 'workspace' | 'outline' | 'recent';

  // Workspace
  workspacePath: string | null;
  workspaceTree: FileNode[];
  recentFiles: RecentFile[];

  // Editor
  cursorPosition: { line: number; ch: number };
  wordCount: number;

  // Search
  searchOpen: boolean;
  searchQuery: string;
  searchMatchIndex: number;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleSidebar: () => void;
  toggleOutline: () => void;
  setSidebarTab: (tab: 'workspace' | 'outline' | 'recent') => void;

  openTab: (tab: { id: string; name: string; path: string; content: string; isDraft?: boolean }) => void;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  setActiveTab: (id: string | null) => void;
  updateTabContent: (id: string, content: string) => void;
  markTabSaved: (id: string) => void;
  markTabUnsaved: (id: string) => void;

  setWorkspace: (path: string, tree: FileNode[]) => void;
  addRecentFile: (file: RecentFile) => void;
  setCursor: (pos: { line: number; ch: number }) => void;
  setWordCount: (count: number) => void;

  toggleSearch: () => void;
  setSearchQuery: (query: string) => void;
  setSearchMatchIndex: (index: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
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

  setViewMode: (mode) => set({ viewMode: mode }),
  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleOutline: () => set((s) => ({ outlineVisible: !s.outlineVisible })),
  setSidebarTab: (tab) => set({ sidebarActiveTab: tab }),

  openTab: (tab) => set((s) => {
    const existing = s.tabs.find((t) => t.path === tab.path);
    if (existing) return { activeTabId: existing.id };
    const newTab = { ...tab, saved: true, isDraft: tab.isDraft || false };
    return { tabs: [...s.tabs, newTab], activeTabId: newTab.id };
  }),
  closeTab: (id) => set((s) => {
    const idx = s.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return s;
    const newTabs = s.tabs.filter((t) => t.id !== id);
    let newActive = s.activeTabId;
    if (s.activeTabId === id) {
      newActive = newTabs.length > 0 ? newTabs[Math.min(idx, newTabs.length - 1)].id : null;
    }
    return { tabs: newTabs, activeTabId: newActive };
  }),
  closeOtherTabs: (id) => set((s) => ({
    tabs: s.tabs.filter((t) => t.id === id),
    activeTabId: id,
  })),
  closeAllTabs: () => set({ tabs: [], activeTabId: null }),
  setActiveTab: (id) => set({ activeTabId: id }),
  updateTabContent: (id, content) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id ? { ...t, content, saved: false } : t),
  })),
  markTabSaved: (id) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id ? { ...t, saved: true } : t),
  })),
  markTabUnsaved: (id) => set((s) => ({
    tabs: s.tabs.map((t) => t.id === id ? { ...t, saved: false } : t),
  })),

  setWorkspace: (path, tree) => set({ workspacePath: path, workspaceTree: tree }),
  addRecentFile: (file) => set((s) => ({
    recentFiles: [file, ...s.recentFiles.filter((f) => f.path !== file.path)].slice(0, 20),
  })),
  setCursor: (pos) => set({ cursorPosition: pos }),
  setWordCount: (count) => set({ wordCount: count }),

  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchMatchIndex: (index) => set({ searchMatchIndex: index }),
}));

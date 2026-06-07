import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, File, Folder, Search } from 'lucide-react';
import { useApp } from '../AppContext';
import { useSettingsStore, useShortcutStore } from '../store';
import { getLocaleText, translateText } from '../i18n';
import type { FileNode, RecentFile } from '../types';
import { buildHidePatterns } from '../utils/workspace';
import {
  matchesFileSearchText,
  relativeWorkspacePath,
  searchWorkspaceFiles,
  type FileSearchResult,
} from '../utils/fileSearch';
import { openFileInEditor, openRecentFileInEditor } from '../utils/openFileInEditor';
import {
  isDoubleKeyShortcut,
  matchesDoubleShortcutKey,
  matchesShortcut,
  normalizeShortcutKey,
} from '../utils/keyboardShortcuts';

const DOUBLE_KEY_INTERVAL_MS = 520;
const SEARCH_DEBOUNCE_MS = 180;
const WORKSPACE_RESULT_LIMIT = 120;
const RECENT_RESULT_LIMIT = 20;

type GlobalSearchItem =
  | {
      kind: 'recent';
      key: string;
      name: string;
      path: string;
      displayPath: string;
      file: RecentFile;
    }
  | {
      kind: 'workspace';
      key: string;
      name: string;
      path: string;
      displayPath: string;
      file: FileNode;
    };

export default function GlobalFileSearch() {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const files = useSettingsStore(s => s.files);
  const language = useSettingsStore(s => s.general.language);
  const globalSearchShortcut = useShortcutStore(s => s.shortcuts.find(shortcut => shortcut.id === 'app.globalFileSearch'));
  const text = getLocaleText(language);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [workspaceResults, setWorkspaceResults] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastDoubleKeyRef = useRef<{ key: string; at: number } | null>(null);
  const globalSearchOpenRef = useRef(false);
  const hidePatterns = useMemo(() => buildHidePatterns(files.hidePatterns || []), [files.hidePatterns]);
  const t = useCallback((value: string) => translateText(language, value), [language]);

  useEffect(() => {
    globalSearchOpenRef.current = state.globalSearchOpen;
  }, [state.globalSearchOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
      if (activeElement?.closest('.shortcut-key.recording') || document.querySelector('.shortcut-key.recording')) return;

      const shortcutKeys = globalSearchShortcut?.keys || 'Double Shift';
      if (globalSearchShortcut?.enabled === false || !shortcutKeys) return;
      if (globalSearchOpenRef.current) return;

      if (!isDoubleKeyShortcut(shortcutKeys)) {
        if (!matchesShortcut(event, shortcutKeys)) return;
        event.preventDefault();
        event.stopPropagation();
        dispatch({ type: 'SET_GLOBAL_SEARCH_OPEN', payload: true });
        return;
      }

      if (!matchesDoubleShortcutKey(event, shortcutKeys)) return;
      const key = normalizeShortcutKey(event.key);
      const now = Date.now();
      const lastPress = lastDoubleKeyRef.current;
      if (lastPress?.key === key && now - lastPress.at <= DOUBLE_KEY_INTERVAL_MS) {
        event.preventDefault();
        event.stopPropagation();
        dispatch({ type: 'SET_GLOBAL_SEARCH_OPEN', payload: true });
        lastDoubleKeyRef.current = null;
        return;
      }
      lastDoubleKeyRef.current = { key, at: now };
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [dispatch, globalSearchShortcut?.enabled, globalSearchShortcut?.keys]);

  useEffect(() => {
    if (!state.globalSearchOpen) return;
    setQuery('');
    setActiveIndex(0);
    setWorkspaceResults([]);
    setIsSearching(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [state.globalSearchOpen]);

  useEffect(() => {
    const keyword = query.trim();
    if (!state.globalSearchOpen || !state.workspacePath || !keyword) {
      setWorkspaceResults([]);
      setIsSearching(false);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsSearching(true);
      void searchWorkspaceFiles(state.workspacePath!, keyword, hidePatterns, WORKSPACE_RESULT_LIMIT, () => cancelled)
        .then(results => {
          if (!cancelled) setWorkspaceResults(results);
        })
        .catch(error => {
          if (!cancelled) {
            console.warn('[GlobalFileSearch] Failed to search workspace:', error);
            setWorkspaceResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hidePatterns, query, state.globalSearchOpen, state.workspacePath]);

  const recentItems = useMemo<GlobalSearchItem[]>(() => {
    const keyword = query.trim();
    const recentFiles = keyword
      ? state.recentFiles.filter(file => matchesFileSearchText(file.name, file.path, keyword))
      : state.recentFiles;

    return recentFiles.slice(0, RECENT_RESULT_LIMIT).map(file => ({
      kind: 'recent',
      key: `recent:${file.path}`,
      name: file.name,
      path: file.path,
      displayPath: state.workspacePath ? relativeWorkspacePath(file.path, state.workspacePath) : file.path,
      file,
    }));
  }, [query, state.recentFiles, state.workspacePath]);

  const recentPaths = useMemo(() => new Set(recentItems.map(item => item.path)), [recentItems]);

  const workspaceItems = useMemo<GlobalSearchItem[]>(() => (
    workspaceResults
      .filter(result => !recentPaths.has(result.node.path))
      .map(result => ({
        kind: 'workspace',
        key: `workspace:${result.node.path}`,
        name: result.node.name,
        path: result.node.path,
        displayPath: result.relativePath,
        file: result.node,
      }))
  ), [recentPaths, workspaceResults]);

  const items = useMemo(() => [...recentItems, ...workspaceItems], [recentItems, workspaceItems]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    setActiveIndex(index => Math.min(index, Math.max(items.length - 1, 0)));
  }, [items.length]);

  useEffect(() => {
    const activeItem = panelRef.current?.querySelector<HTMLElement>('.global-search-result.active');
    activeItem?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!state.globalSearchOpen) return null;

  const close = () => dispatch({ type: 'SET_GLOBAL_SEARCH_OPEN', payload: false });

  const openItem = (item: GlobalSearchItem) => {
    close();
    navigate('/workspace');
    const options = {
      unsupportedFileContent: (extension: string) => `# ${item.name}\n\n${text.sidebar.unsupportedFile(extension)}\n`,
    };
    const promise = item.kind === 'recent'
      ? openRecentFileInEditor(dispatch, item.file, options)
      : openFileInEditor(dispatch, item.file, options);
    void promise.catch(error => console.error('[GlobalFileSearch] Failed to open file:', error));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(index + 1, Math.max(items.length - 1, 0)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(index - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[activeIndex];
      if (item) openItem(item);
    }
  };

  const renderItem = (item: GlobalSearchItem, index: number) => (
    <button
      key={item.key}
      type="button"
      className={`global-search-result ${index === activeIndex ? 'active' : ''}`}
      title={item.path}
      onMouseEnter={() => setActiveIndex(index)}
      onClick={() => openItem(item)}
    >
      {item.kind === 'recent' ? <Clock size={15} className="icon" /> : <File size={15} className="icon" />}
      <span className="global-search-result-info">
        <span className="global-search-result-name">{item.name}</span>
        <span className="global-search-result-path">{item.displayPath}</span>
      </span>
    </button>
  );

  const hasQuery = Boolean(query.trim());
  const hasResults = items.length > 0;

  return (
    <div className="global-search-backdrop" onMouseDown={close}>
      <div ref={panelRef} className="global-search-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="global-search-input-row">
          <Search size={18} className="global-search-input-icon" />
          <input
            ref={inputRef}
            className="global-search-input"
            placeholder={t('搜索文件名...')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="global-search-list">
          {recentItems.length > 0 && (
            <div className="global-search-section">
              <div className="global-search-section-title">{text.sidebar.recentFiles}</div>
              {recentItems.map((item, index) => renderItem(item, index))}
            </div>
          )}

          {(workspaceItems.length > 0 || (hasQuery && (state.workspacePath || isSearching))) && (
            <div className="global-search-section">
              <div className="global-search-section-title">
                <Folder size={12} />
                <span>{t('工作区文件')}</span>
                {isSearching && <span className="global-search-section-spinner" />}
              </div>
              {workspaceItems.map((item, index) => renderItem(item, recentItems.length + index))}
              {workspaceItems.length === 0 && isSearching && (
                <div className="global-search-state">{text.sidebar.searchingFiles}</div>
              )}
            </div>
          )}

          {!hasResults && !isSearching && (
            <div className="global-search-empty">
              {hasQuery
                ? text.sidebar.noFileSearchResults(query.trim())
                : text.sidebar.noRecentFiles}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

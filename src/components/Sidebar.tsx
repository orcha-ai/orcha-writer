import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { FolderOpen, Folder, File, ChevronRight, ChevronDown, FilePlus, Trash2, Pencil, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, rename, remove } from '../utils/fs';
import { buildHidePatterns, findFirstMdFile, readFirstLevel } from '../utils/workspace';
import type { FileNode, RecentFile } from '../types';
import { getLocaleText, normalizeAppLanguage } from '../i18n';

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 240;
type DepthStyle = CSSProperties & { '--depth': number };

interface TreeHandlers {
  expandedFolders: Set<string>;
  loadingFolders: Set<string>;
  toggleFolder: (path: string) => void | Promise<void>;
  openFile: (node: FileNode) => void | Promise<void>;
  activeTabId: string | null;
  onContextMenu: (event: MouseEvent, item: FileNode | null) => void;
  renaming: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void | Promise<void>;
  onRenameCancel: () => void;
  onRename: (item: FileNode) => void | Promise<void>;
  onDelete: (item: FileNode) => void | Promise<void>;
}

interface WorkspaceTreeProps extends TreeHandlers {
  tree: FileNode[];
  openFolder: () => void | Promise<void>;
  text: ReturnType<typeof getLocaleText>;
}

interface TreeNodeProps extends TreeHandlers {
  node: FileNode;
  depth: number;
}

function clampSidebarWidth(width: unknown): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

function renamedPath(path: string, nextName: string): string {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex >= 0 ? `${path.slice(0, separatorIndex + 1)}${nextName}` : nextName;
}

function rebasePath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`) || path.startsWith(`${oldPath}\\`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }
  return path;
}

export default function Sidebar() {
  const { state, dispatch } = useApp();
  const { files, appearance, general, updateAppearance, saveAll } = useSettingsStore();
  const text = getLocaleText(general.language);
  const appLanguage = normalizeAppLanguage(general.language);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: FileNode | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebarWidth(appearance.sidebarWidth));
  const [isResizing, setIsResizing] = useState(false);

  // Combine default + user-configured hidden patterns
  const hidePatterns = useMemo(() => buildHidePatterns(files.hidePatterns || []), [files.hidePatterns]);

  // Keep refs in sync for async callbacks
  const expandedRef = useRef(expandedFolders);
  const treeRef = useRef(state.workspaceTree);
  const workspacePathRef = useRef(state.workspacePath);
  const hidePatternsRef = useRef(hidePatterns);
  const widthRef = useRef(sidebarWidth);
  const resizeStartRef = useRef({ x: 0, width: sidebarWidth });
  const renameInFlightRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { expandedRef.current = expandedFolders; }, [expandedFolders]);
  useEffect(() => { treeRef.current = state.workspaceTree; }, [state.workspaceTree]);
  useEffect(() => { workspacePathRef.current = state.workspacePath; }, [state.workspacePath]);
  useEffect(() => { hidePatternsRef.current = hidePatterns; }, [hidePatterns]);
  useEffect(() => { widthRef.current = sidebarWidth; }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) {
      setSidebarWidth(clampSidebarWidth(appearance.sidebarWidth));
    }
  }, [appearance.sidebarWidth, isResizing]);

  const saveSidebarWidth = useCallback(async (width: number) => {
    const nextWidth = clampSidebarWidth(width);
    updateAppearance({ sidebarWidth: nextWidth });
    await saveAll();
  }, [saveAll, updateAppearance]);

  const setSidebarVisible = useCallback((visible: boolean) => {
    dispatch({ type: 'SET_SIDEBAR_VISIBLE', payload: visible });
    updateAppearance({ showSidebar: visible });
    void saveAll();
  }, [dispatch, saveAll, updateAppearance]);

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!state.sidebarVisible) return;
    event.preventDefault();
    resizeStartRef.current = { x: event.clientX, width: widthRef.current };
    setIsResizing(true);
  }, [state.sidebarVisible]);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const delta = event.clientX - resizeStartRef.current.x;
      const nextWidth = clampSidebarWidth(resizeStartRef.current.width + delta);
      widthRef.current = nextWidth;
      setSidebarWidth(nextWidth);
    };

    const handlePointerUp = () => {
      setIsResizing(false);
      void saveSidebarWidth(widthRef.current);
    };

    document.body.classList.add('sidebar-resizing');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
      document.body.classList.remove('sidebar-resizing');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isResizing, saveSidebarWidth]);

  const loadFolderChildren = useCallback(async (folderPath: string) => {
    try {
      const children = await readFirstLevel(folderPath, hidePatternsRef.current);
      const currentTree = treeRef.current;

      function updateTree(nodes: FileNode[]): FileNode[] {
        return nodes.map(node => {
          if (node.path === folderPath) return { ...node, children };
          if (node.children) return { ...node, children: updateTree(node.children) };
          return node;
        });
      }

      dispatch({
        type: 'SET_WORKSPACE',
        payload: { path: workspacePathRef.current!, tree: updateTree(currentTree) },
      });
    } catch (err) {
      console.error('[Sidebar] Failed to load folder children:', err);
    }
  }, [dispatch]);

  const toggleFolder = useCallback(async (path: string) => {
    const currentTree = treeRef.current;
    const currentExpanded = expandedRef.current;
    const wasExpanded = currentExpanded.has(path);
    const node = findNode(currentTree, path);

    // Toggle expanded state
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (wasExpanded) next.delete(path);
      else next.add(path);
      return next;
    });

    // If expanding and no children loaded yet, load them
    if (!wasExpanded && node?.type === 'folder' && (!node.children || node.children.length === 0)) {
      setLoadingFolders(prev => new Set(prev).add(path));
      await loadFolderChildren(path);
      setLoadingFolders(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [loadFolderChildren]);

  const openFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: text.sidebar.chooseWorkspaceFolder,
      });
      if (!selected) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      const tree = await readFirstLevel(path, hidePatterns);
      dispatch({ type: 'SET_WORKSPACE', payload: { path, tree } });

      const firstMd = findFirstMdFile(tree);
      if (firstMd) {
        try {
          const content = await readTextFile(firstMd.path);
          dispatch({ type: 'OPEN_TAB', payload: { id: firstMd.path, name: firstMd.name, path: firstMd.path, content } });
          dispatch({ type: 'ADD_RECENT_FILE', payload: { path: firstMd.path, name: firstMd.name, lastOpened: Date.now() } });
        } catch {
          dispatch({ type: 'OPEN_TAB', payload: { id: firstMd.path, name: firstMd.name, path: firstMd.path, content: `# ${firstMd.name.replace('.md', '')}\n\n` } });
        }
      }
    } catch (e) {
      console.error('Failed to open folder:', e);
    }
  }, [dispatch, hidePatterns, text.sidebar.chooseWorkspaceFolder]);

  const openFile = useCallback(async (node: FileNode) => {
    if (node.type !== 'file') return;
    const id = node.path;
    const ext = node.name.split('.').pop()?.toLowerCase() || '';
    const supportedExts = ['md', 'markdown', 'mdown', 'mkd', 'txt', 'text'];

    if (!supportedExts.includes(ext)) {
      dispatch({ type: 'OPEN_TAB', payload: { id, name: node.name, path: node.path, content: `# ${node.name}\n\n${text.sidebar.unsupportedFile(ext)}\n` } });
      return;
    }

    try {
      const content = await readTextFile(node.path);
      dispatch({ type: 'OPEN_TAB', payload: { id, name: node.name, path: node.path, content } });
      dispatch({ type: 'ADD_RECENT_FILE', payload: { path: node.path, name: node.name, lastOpened: Date.now() } });
    } catch {
      dispatch({ type: 'OPEN_TAB', payload: { id, name: node.name, path: node.path, content: `# ${node.name.replace(/\.\w+$/, '')}\n\n` } });
    }
  }, [dispatch, text.sidebar]);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: FileNode | null) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return undefined;

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && contextMenuRef.current?.contains(target)) return;
      closeContextMenu();
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('scroll', closeContextMenu, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('scroll', closeContextMenu, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeContextMenu, contextMenu]);

  const handleRename = useCallback(async (item: FileNode) => {
    renameInFlightRef.current = false;
    renameCancelledRef.current = false;
    setRenaming(item.path);
    setRenameValue(item.name);
    setContextMenu(null);
  }, []);

  const handleRenameCancel = useCallback(() => {
    renameInFlightRef.current = false;
    renameCancelledRef.current = true;
    setRenaming(null);
    setRenameValue('');
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renaming || renameInFlightRef.current) return;
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      return;
    }
    const oldPath = renaming;
    const nextName = renameValue.trim();
    if (!nextName) {
      handleRenameCancel();
      return;
    }

    const newPath = renamedPath(oldPath, nextName);
    if (newPath === oldPath) {
      handleRenameCancel();
      return;
    }

    renameInFlightRef.current = true;
    try {
      await rename(oldPath, newPath);
      function updateTree(nodes: FileNode[]): FileNode[] {
        return nodes.map(node => {
          const rebasedPath = rebasePath(node.path, oldPath, newPath);
          const renamedNode = {
            ...node,
            name: node.path === oldPath ? nextName : node.name,
            path: rebasedPath,
          };
          if (node.children) return { ...renamedNode, children: updateTree(node.children) };
          if (rebasedPath !== node.path) return renamedNode;
          return node;
        });
      }
      dispatch({ type: 'SET_WORKSPACE', payload: { path: state.workspacePath!, tree: updateTree(state.workspaceTree) } });
      dispatch({ type: 'RENAME_PATH', payload: { oldPath, newPath, name: nextName } });
    } catch (e) {
      console.error('Failed to rename:', e);
    } finally {
      renameInFlightRef.current = false;
      setRenaming(null);
      setRenameValue('');
    }
  }, [dispatch, handleRenameCancel, renameValue, renaming, state.workspacePath, state.workspaceTree]);

  const handleDelete = useCallback(async (item: FileNode) => {
    setContextMenu(null);
    try {
      await remove(item.path, { recursive: item.type === 'folder' });
      function removeFromTree(nodes: FileNode[]): FileNode[] {
        return nodes
          .filter(node => node.path !== item.path)
          .map(node => node.children ? { ...node, children: removeFromTree(node.children) } : node);
      }
      dispatch({ type: 'SET_WORKSPACE', payload: { path: state.workspacePath!, tree: removeFromTree(state.workspaceTree) } });
      if (state.tabs.find(t => t.path === item.path)) {
        dispatch({ type: 'CLOSE_TAB', payload: item.path });
      }
    } catch (e) {
      console.error('Failed to delete:', e);
    }
  }, [dispatch, state.workspacePath, state.workspaceTree, state.tabs]);

  if (!state.sidebarVisible) {
    return (
      <button
        className="side-panel-toggle workspace-panel-toggle"
        onClick={() => setSidebarVisible(true)}
        title={text.sidebar.showWorkspace}
        aria-label={text.sidebar.showWorkspace}
      >
        <PanelLeftOpen size={14} />
      </button>
    );
  }

  return (
    <>
      <div
        className={`sidebar ${!state.sidebarVisible ? 'collapsed' : ''} ${isResizing ? 'resizing' : ''}`}
        style={state.sidebarVisible ? { width: sidebarWidth } : undefined}
      >
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${state.sidebarActiveTab === 'workspace' ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'workspace' })}
          >
            {text.sidebar.workspace}
          </button>
          <button
            className={`sidebar-tab ${state.sidebarActiveTab === 'recent' ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'recent' })}
          >
            {text.sidebar.recentFiles}
          </button>
          <div className="sidebar-tab-spacer" />
          <button
            className="panel-collapse-btn"
            onClick={() => setSidebarVisible(false)}
            title={text.sidebar.hideWorkspace}
            aria-label={text.sidebar.hideWorkspace}
          >
            <PanelLeftClose size={14} />
          </button>
        </div>

        <div className="sidebar-content" onClick={closeContextMenu}>
          {state.sidebarActiveTab === 'workspace' && (
            <WorkspaceTree
              tree={state.workspaceTree}
              expandedFolders={expandedFolders}
              loadingFolders={loadingFolders}
              toggleFolder={toggleFolder}
              openFile={openFile}
              openFolder={openFolder}
              activeTabId={state.activeTabId}
              onContextMenu={handleContextMenu}
              renaming={renaming}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={handleRenameCancel}
              onRename={handleRename}
              onDelete={handleDelete}
              text={text}
            />
          )}

          {state.sidebarActiveTab === 'recent' && (
            <RecentFiles recentFiles={state.recentFiles} language={appLanguage} text={text} openFile={async (rf) => {
              let content: string;
              try {
                content = await readTextFile(rf.path);
              } catch {
                content = `# ${rf.name.replace('.md', '')}\n\n`;
              }
              dispatch({
                type: 'OPEN_TAB',
                payload: { id: rf.path, name: rf.name, path: rf.path, content },
              });
            }} />
          )}
        </div>

        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={text.sidebar.resizeWorkspace}
          onPointerDown={handleResizeStart}
        />
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.item && (
            <>
              <div className="context-menu-item" onClick={() => handleRename(contextMenu.item!)}>
                <Pencil size={14} /> {text.contextMenu.rename}
              </div>
              {contextMenu.item.type === 'folder' && (
                <div className="context-menu-item">
                  <FilePlus size={14} /> {text.contextMenu.newFile}
                </div>
              )}
              <div className="context-menu-divider" />
              <div className="context-menu-item danger" onClick={() => handleDelete(contextMenu.item!)}>
                <Trash2 size={14} /> {text.contextMenu.delete}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function WorkspaceTree({
  tree, expandedFolders, loadingFolders, toggleFolder, openFile, openFolder, activeTabId,
  onContextMenu, renaming, renameValue, onRenameChange, onRenameSubmit, onRenameCancel, onRename, onDelete, text
}: WorkspaceTreeProps) {
  if (tree.length === 0) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center' }}>
        <FolderOpen size={32} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
        <p style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginBottom: '12px' }}>
          {text.sidebar.openFolderHint}
        </p>
        <button
          className="welcome-btn secondary"
          style={{ fontSize: '12px', padding: '6px 16px' }}
          onClick={openFolder}
        >
          {text.sidebar.openFolder}
        </button>
      </div>
    );
  }

  return (
    <div>
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          expandedFolders={expandedFolders}
          loadingFolders={loadingFolders}
          toggleFolder={toggleFolder}
          openFile={openFile}
          activeTabId={activeTabId}
          onContextMenu={onContextMenu}
          renaming={renaming}
          renameValue={renameValue}
          onRenameChange={onRenameChange}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function TreeNode({ node, depth, expandedFolders, loadingFolders, toggleFolder, openFile, activeTabId, onContextMenu, renaming, renameValue, onRenameChange, onRenameSubmit, onRenameCancel, onRename, onDelete }: TreeNodeProps) {
  const isExpanded = expandedFolders.has(node.path);
  const isLoading = loadingFolders?.has(node.path);
  const isActive = activeTabId === node.path;
  const isRenaming = renaming === node.path;
  const childCount = node.children?.length ?? 0;
  const depthStyle: DepthStyle = { '--depth': depth };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'F2' || isRenaming) return;
    event.preventDefault();
    event.stopPropagation();
    void onRename(node);
  };
  const nameNode = isRenaming ? (
    <input
      className="rename-input"
      value={renameValue}
      onChange={(e) => onRenameChange(e.target.value)}
      onBlur={() => { void onRenameSubmit(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          void onRenameSubmit();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onRenameCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      autoFocus
    />
  ) : (
    <span className="name">{node.name}</span>
  );

  if (node.type === 'folder') {
    return (
      <div>
        <div
          className={`file-tree-item ${isActive ? 'active' : ''}`}
          style={depthStyle}
          tabIndex={0}
          onClick={() => toggleFolder(node.path)}
          onKeyDown={handleKeyDown}
          onContextMenu={(e) => onContextMenu(e, node)}
          title={`${node.path}`}
        >
          {isLoading ? (
            <span className="spinner" />
          ) : isExpanded ? (
            <ChevronDown size={12} className="chevron expanded" />
          ) : (
            <ChevronRight size={12} className="chevron" />
          )}
          <Folder size={14} className="icon" />
          {nameNode}
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 2 }}>{childCount}</span>
        </div>
        {isExpanded && node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedFolders={expandedFolders}
            loadingFolders={loadingFolders}
            toggleFolder={toggleFolder}
            openFile={openFile}
            activeTabId={activeTabId}
            onContextMenu={onContextMenu}
            renaming={renaming}
            renameValue={renameValue}
            onRenameChange={onRenameChange}
            onRenameSubmit={onRenameSubmit}
            onRenameCancel={onRenameCancel}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`file-tree-item ${isActive ? 'active' : ''}`}
      style={depthStyle}
      tabIndex={0}
      onClick={() => openFile(node)}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e, node); }}
    >
      <span style={{ width: 12 }} />
      <File size={14} className="icon" />
      {nameNode}
    </div>
  );
}

function RecentFiles({
  recentFiles,
  language,
  text,
  openFile,
}: {
  recentFiles: RecentFile[];
  language: string;
  text: ReturnType<typeof getLocaleText>;
  openFile: (rf: RecentFile) => void | Promise<void>;
}) {
  if (recentFiles.length === 0) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center' }}>
        <File size={32} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
        <p style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
          {text.sidebar.noRecentFiles}
        </p>
      </div>
    );
  }

  return (
    <div>
      {recentFiles.map(rf => (
        <div key={rf.path} className="recent-file-item" onClick={() => openFile(rf)}>
          <File size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
          <div className="recent-file-info">
            <div className="recent-file-name">{rf.name}</div>
            <div className="recent-file-path">{rf.path}</div>
          </div>
          <span className="recent-file-time">{formatTime(rf.lastOpened, language, text)}</span>
        </div>
      ))}
    </div>
  );
}

function formatTime(timestamp: number, language: string, text: ReturnType<typeof getLocaleText>): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return text.sidebar.now;
  if (diff < 3600000) return text.sidebar.minutesAgo(Math.floor(diff / 60000));
  if (diff < 86400000) return text.sidebar.hoursAgo(Math.floor(diff / 3600000));
  if (diff < 172800000) return text.sidebar.yesterday;
  return new Date(timestamp).toLocaleDateString(language);
}

function findNode(tree: FileNode[], path: string): FileNode | null {
  for (const node of tree) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

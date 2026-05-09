import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { FolderOpen, Folder, File, ChevronRight, ChevronDown, FilePlus, Trash2, Pencil } from 'lucide-react';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, rename, remove } from '../utils/fs';
import { buildHidePatterns, findFirstMdFile, readFirstLevel } from '../utils/workspace';
import type { FileNode } from '../types';

export default function Sidebar() {
  const { state, dispatch } = useApp();
  const files = useSettingsStore(s => s.files);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: FileNode | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());

  // Combine default + user-configured hidden patterns
  const hidePatterns = useMemo(() => buildHidePatterns(files.hidePatterns || []), [files.hidePatterns]);

  // Keep refs in sync for async callbacks
  const expandedRef = useRef(expandedFolders);
  const treeRef = useRef(state.workspaceTree);
  const workspacePathRef = useRef(state.workspacePath);
  const hidePatternsRef = useRef(hidePatterns);

  useEffect(() => { expandedRef.current = expandedFolders; }, [expandedFolders]);
  useEffect(() => { treeRef.current = state.workspaceTree; }, [state.workspaceTree]);
  useEffect(() => { workspacePathRef.current = state.workspacePath; }, [state.workspacePath]);
  useEffect(() => { hidePatternsRef.current = hidePatterns; }, [hidePatterns]);

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
        title: '选择工作区文件夹',
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
  }, [dispatch, hidePatterns]);

  const openFile = useCallback(async (node: FileNode) => {
    if (node.type !== 'file') return;
    const id = node.path;
    const ext = node.name.split('.').pop()?.toLowerCase() || '';
    const supportedExts = ['md', 'markdown', 'mdown', 'mkd', 'txt', 'text'];

    if (!supportedExts.includes(ext)) {
      dispatch({ type: 'OPEN_TAB', payload: { id, name: node.name, path: node.path, content: `# ${node.name}\n\n暂不支持打开 .${ext} 格式文件\n` } });
      return;
    }

    try {
      const content = await readTextFile(node.path);
      dispatch({ type: 'OPEN_TAB', payload: { id, name: node.name, path: node.path, content } });
      dispatch({ type: 'ADD_RECENT_FILE', payload: { path: node.path, name: node.name, lastOpened: Date.now() } });
    } catch {
      dispatch({ type: 'OPEN_TAB', payload: { id, name: node.name, path: node.path, content: `# ${node.name.replace(/\.\w+$/, '')}\n\n` } });
    }
  }, [dispatch]);

  const handleContextMenu = useCallback((e: React.MouseEvent, item: FileNode | null) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleRename = useCallback(async (item: FileNode) => {
    setRenaming(item.path);
    setRenameValue(item.name);
    setContextMenu(null);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renaming || !renameValue) return;
    const dirPath = renaming.substring(0, renaming.lastIndexOf('/'));
    const newPath = dirPath ? `${dirPath}/${renameValue}` : renameValue;
    try {
      await rename(renaming, newPath);
      function updateTree(nodes: FileNode[]): FileNode[] {
        return nodes.map(node => {
          if (node.path === renaming) return { ...node, name: renameValue, path: newPath };
          if (node.children) return { ...node, children: updateTree(node.children) };
          return node;
        });
      }
      dispatch({ type: 'SET_WORKSPACE', payload: { path: state.workspacePath!, tree: updateTree(state.workspaceTree) } });
      const activeTab = state.tabs.find(t => t.path === renaming);
      if (activeTab) {
        const content = await readTextFile(newPath);
        dispatch({ type: 'CLOSE_TAB', payload: activeTab.id });
        dispatch({ type: 'OPEN_TAB', payload: { id: newPath, name: renameValue, path: newPath, content } });
      }
    } catch (e) {
      console.error('Failed to rename:', e);
    }
    setRenaming(null);
  }, [renaming, renameValue, dispatch, state.workspacePath, state.workspaceTree, state.tabs]);

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

  return (
    <>
      <div className={`sidebar ${!state.sidebarVisible ? 'collapsed' : ''}`}>
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${state.sidebarActiveTab === 'workspace' ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'workspace' })}
          >
            工作区
          </button>
          <button
            className={`sidebar-tab ${state.sidebarActiveTab === 'recent' ? 'active' : ''}`}
            onClick={() => dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'recent' })}
          >
            最近文件
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
              onRename={handleRename}
              onDelete={handleDelete}
            />
          )}

          {state.sidebarActiveTab === 'recent' && (
            <RecentFiles recentFiles={state.recentFiles} openFile={async (rf) => {
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
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.item && (
            <>
              <div className="context-menu-item" onClick={() => handleRename(contextMenu.item!)}>
                <Pencil size={14} /> 重命名
              </div>
              {contextMenu.item.type === 'folder' && (
                <div className="context-menu-item">
                  <FilePlus size={14} /> 新建文件
                </div>
              )}
              <div className="context-menu-divider" />
              <div className="context-menu-item danger" onClick={() => handleDelete(contextMenu.item!)}>
                <Trash2 size={14} /> 删除
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
  onContextMenu, renaming, renameValue, onRenameChange, onRenameSubmit, onRename, onDelete
}: any) {
  if (tree.length === 0) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center' }}>
        <FolderOpen size={32} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
        <p style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginBottom: '12px' }}>
          打开文件夹开始工作
        </p>
        <button
          className="welcome-btn secondary"
          style={{ fontSize: '12px', padding: '6px 16px' }}
          onClick={openFolder}
        >
          打开文件夹
        </button>
      </div>
    );
  }

  return (
    <div>
      {tree.map((node: any) => (
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
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function TreeNode({ node, depth, expandedFolders, loadingFolders, toggleFolder, openFile, activeTabId, onContextMenu, renaming, renameValue, onRenameChange, onRenameSubmit, onRename, onDelete }: any) {
  const isExpanded = expandedFolders.has(node.path);
  const isLoading = loadingFolders?.has(node.path);
  const isActive = activeTabId === node.path;
  const isRenaming = renaming === node.path;
  const childCount = node.children?.length ?? 0;

  if (node.type === 'folder') {
    return (
      <div>
        <div
          className={`file-tree-item ${isActive ? 'active' : ''}`}
          style={{ '--depth': depth } as any}
          onClick={() => toggleFolder(node.path)}
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
          <span className="name">{node.name}</span>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 2 }}>{childCount}</span>
        </div>
        {isExpanded && node.children?.map((child: any) => (
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
      style={{ '--depth': depth } as any}
      onClick={() => openFile(node)}
      onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e, node); }}
    >
      <span style={{ width: 12 }} />
      <File size={14} className="icon" />
      {isRenaming ? (
        <input
          className="rename-input"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameSubmit}
          onKeyDown={(e) => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameSubmit(); }}
          onClick={(e) => e.stopPropagation()}
          autoFocus
        />
      ) : (
        <span className="name">{node.name}</span>
      )}
    </div>
  );
}

function RecentFiles({ recentFiles, openFile }: { recentFiles: any[], openFile: (rf: any) => void }) {
  if (recentFiles.length === 0) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center' }}>
        <File size={32} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
        <p style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
          暂无最近文件
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
          <span className="recent-file-time">{formatTime(rf.lastOpened)}</span>
        </div>
      ))}
    </div>
  );
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 172800000) return '昨天';
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function findNode(tree: any[], path: string): any | null {
  for (const node of tree) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

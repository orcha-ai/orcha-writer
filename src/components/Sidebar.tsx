import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { FolderOpen, Folder, File, ChevronRight, FilePlus, FolderPlus, Trash2, Pencil, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { message } from 'antd';
import { ensureDir, pathExists, readTextFile, rename, remove, writeTextFile } from '../utils/fs';
import { buildHidePatterns, readFirstLevel } from '../utils/workspace';
import type { FileNode, RecentFile } from '../types';
import { getLocaleText, normalizeAppLanguage } from '../i18n';

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 240;
const ROOT_DROP_TARGET = '__orcha_workspace_root__';
type DepthStyle = CSSProperties & { '--depth': number };

interface CreateFolderState {
  parentPath: string | null;
  value: string;
}

interface CreateFileState {
  parentPath: string | null;
  value: string;
}

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
  creatingFolder: CreateFolderState | null;
  onCreateFolderStart: (parentPath: string | null) => void | Promise<void>;
  onCreateFolderChange: (value: string) => void;
  onCreateFolderSubmit: () => void | Promise<void>;
  onCreateFolderCancel: () => void;
  creatingFile: CreateFileState | null;
  onCreateFileStart: (parentPath: string | null) => void | Promise<void>;
  onCreateFileChange: (value: string) => void;
  onCreateFileSubmit: () => void | Promise<void>;
  onCreateFileCancel: () => void;
  draggingPath: string | null;
  dropTargetPath: string | null;
  onDragStart: (event: DragEvent<HTMLDivElement>, node: FileNode) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, targetPath: string | null) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, targetPath: string | null) => void | Promise<void>;
  onDragEnd: () => void;
}

interface WorkspaceTreeProps extends TreeHandlers {
  tree: FileNode[];
  workspacePath: string | null;
  text: ReturnType<typeof getLocaleText>;
}

interface TreeNodeProps extends TreeHandlers {
  node: FileNode;
  depth: number;
  text: ReturnType<typeof getLocaleText>;
}

function clampSidebarWidth(width: unknown): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

function renamedPath(path: string, nextName: string): string {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex >= 0 ? `${path.slice(0, separatorIndex + 1)}${nextName}` : nextName;
}

function parentPathOf(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex >= 0 ? path.slice(0, separatorIndex) : '';
}

function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isPathWithinWorkspace(path: string, workspacePath: string): boolean {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedWorkspace = normalizePathForCompare(workspacePath);
  return normalizedPath === normalizedWorkspace || normalizedPath.startsWith(`${normalizedWorkspace}/`);
}

function ancestorFoldersForFile(filePath: string, workspacePath: string): string[] {
  const workspace = normalizePathForCompare(workspacePath);
  const ancestors: string[] = [];
  let current = parentPathOf(filePath);

  while (current && normalizePathForCompare(current) !== workspace) {
    ancestors.push(current);
    current = parentPathOf(current);
  }

  return ancestors.reverse();
}

function joinPath(directory: string, name: string): string {
  return `${directory.replace(/[\\/]+$/, '')}/${name}`;
}

function hasPathSeparator(name: string): boolean {
  return name.includes('/') || name.includes('\\');
}

function hasFileExtension(name: string): boolean {
  const separatorIndex = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const dotIndex = name.lastIndexOf('.');
  return dotIndex > separatorIndex && dotIndex > 0 && dotIndex < name.length - 1;
}

function withNameIndex(name: string, index: number): string {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) return `${name} ${index}`;
  return `${name.slice(0, dotIndex)} ${index}${name.slice(dotIndex)}`;
}

function rebasePath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`) || path.startsWith(`${oldPath}\\`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }
  return path;
}

function isPathInside(path: string, parentPath: string): boolean {
  return path.startsWith(`${parentPath}/`) || path.startsWith(`${parentPath}\\`);
}

function dropTargetKey(targetPath: string | null): string {
  return targetPath ?? ROOT_DROP_TARGET;
}

function rebaseExpandedFolders(expanded: Set<string>, oldPath: string, newPath: string): Set<string> {
  return new Set([...expanded].map(path => rebasePath(path, oldPath, newPath)));
}

async function readVisibleTree(
  rootPath: string,
  expandedFolders: Set<string>,
  hidePatterns: string[],
): Promise<FileNode[]> {
  const load = async (dirPath: string): Promise<FileNode[]> => {
    const nodes = await readFirstLevel(dirPath, hidePatterns);
    return Promise.all(nodes.map(async node => {
      if (node.type !== 'folder' || !expandedFolders.has(node.path)) return node;
      try {
        return { ...node, children: await load(node.path) };
      } catch (error) {
        console.warn('[Sidebar] Failed to refresh expanded folder:', node.path, error);
        return node;
      }
    }));
  };

  return load(rootPath);
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
  const [creatingFolder, setCreatingFolder] = useState<CreateFolderState | null>(null);
  const [creatingFile, setCreatingFile] = useState<CreateFileState | null>(null);
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
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
  const createFolderInFlightRef = useRef(false);
  const createFileInFlightRef = useRef(false);
  const dragNodeRef = useRef<FileNode | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const sidebarContentRef = useRef<HTMLDivElement | null>(null);
  const pendingRevealPathRef = useRef<string | null>(null);

  const activeWorkspaceFilePath = useMemo(() => {
    if (!state.activeTabId || !state.workspacePath) return null;
    const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
    if (!activeTab || activeTab.isDraft) return null;
    return isPathWithinWorkspace(activeTab.path, state.workspacePath) ? activeTab.path : null;
  }, [state.activeTabId, state.tabs, state.workspacePath]);

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

  const refreshWorkspaceTree = useCallback(async (expanded = expandedRef.current) => {
    const workspacePath = workspacePathRef.current;
    if (!workspacePath) return;
    const tree = await readVisibleTree(workspacePath, expanded, hidePatternsRef.current);
    dispatch({ type: 'SET_WORKSPACE', payload: { path: workspacePath, tree } });
  }, [dispatch]);

  const scrollActiveTreeItemIntoView = useCallback(() => {
    window.requestAnimationFrame(() => {
      const activeItem = sidebarContentRef.current?.querySelector<HTMLElement>('.workspace-tree .file-tree-item.active');
      activeItem?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, []);

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
    if (wasExpanded && creatingFolder?.parentPath === path) {
      setCreatingFolder(null);
    }
    if (wasExpanded && creatingFile?.parentPath === path) {
      setCreatingFile(null);
    }

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
  }, [creatingFile?.parentPath, creatingFolder?.parentPath, loadFolderChildren]);

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

  const nextAvailableFolderName = useCallback(async (parentPath: string) => {
    const baseName = text.sidebar.newFolderDefaultName;
    let candidate: string = baseName;
    let index = 2;
    while (await pathExists(joinPath(parentPath, candidate))) {
      candidate = `${baseName} ${index}`;
      index += 1;
    }
    return candidate;
  }, [text.sidebar.newFolderDefaultName]);

  const nextAvailableFileName = useCallback(async (parentPath: string) => {
    const baseName = text.sidebar.newFileDefaultName;
    let candidate: string = baseName;
    let index = 2;
    while (await pathExists(joinPath(parentPath, candidate))) {
      candidate = withNameIndex(baseName, index);
      index += 1;
    }
    return candidate;
  }, [text.sidebar.newFileDefaultName]);

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
    setCreatingFolder(null);
    setCreatingFile(null);
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

  const handleCreateFolderStart = useCallback(async (parentPath: string | null) => {
    const workspacePath = workspacePathRef.current;
    if (!workspacePath) {
      message.info(text.sidebar.openFolderHint);
      return;
    }

    setContextMenu(null);
    setRenaming(null);
    setCreatingFile(null);

    const parentDirectory = parentPath ?? workspacePath;
    const nextExpanded = new Set(expandedRef.current);
    if (parentPath) {
      nextExpanded.add(parentPath);
      setExpandedFolders(nextExpanded);
      await refreshWorkspaceTree(nextExpanded);
    }

    setCreatingFolder({
      parentPath,
      value: await nextAvailableFolderName(parentDirectory),
    });
  }, [nextAvailableFolderName, refreshWorkspaceTree, text.sidebar.openFolderHint]);

  const handleCreateFolderCancel = useCallback(() => {
    createFolderInFlightRef.current = false;
    setCreatingFolder(null);
  }, []);

  const handleCreateFolderSubmit = useCallback(async () => {
    if (!creatingFolder || createFolderInFlightRef.current) return;

    const workspacePath = workspacePathRef.current;
    const parentDirectory = creatingFolder.parentPath ?? workspacePath;
    const folderName = creatingFolder.value.trim();
    if (!workspacePath || !parentDirectory) {
      handleCreateFolderCancel();
      return;
    }
    if (!folderName) {
      handleCreateFolderCancel();
      return;
    }
    if (hasPathSeparator(folderName)) {
      message.warning(text.sidebar.folderNameInvalid);
      return;
    }

    const folderPath = joinPath(parentDirectory, folderName);
    createFolderInFlightRef.current = true;
    try {
      if (await pathExists(folderPath)) {
        message.warning(text.sidebar.folderAlreadyExists(folderName));
        return;
      }

      await ensureDir(folderPath);
      const nextExpanded = new Set(expandedRef.current);
      if (creatingFolder.parentPath) nextExpanded.add(creatingFolder.parentPath);
      nextExpanded.add(folderPath);
      setExpandedFolders(nextExpanded);
      setCreatingFolder(null);
      await refreshWorkspaceTree(nextExpanded);
      message.success(text.sidebar.folderCreated(folderName));
    } catch (error) {
      console.error('Failed to create folder:', error);
      message.error(text.sidebar.createFolderFailed);
    } finally {
      createFolderInFlightRef.current = false;
    }
  }, [creatingFolder, handleCreateFolderCancel, refreshWorkspaceTree, text.sidebar]);

  const handleCreateFileStart = useCallback(async (parentPath: string | null) => {
    const workspacePath = workspacePathRef.current;
    if (!workspacePath) {
      message.info(text.sidebar.openFolderHint);
      return;
    }

    setContextMenu(null);
    setRenaming(null);
    setCreatingFolder(null);

    const parentDirectory = parentPath ?? workspacePath;
    const nextExpanded = new Set(expandedRef.current);
    if (parentPath) {
      nextExpanded.add(parentPath);
      setExpandedFolders(nextExpanded);
      await refreshWorkspaceTree(nextExpanded);
    }

    setCreatingFile({
      parentPath,
      value: await nextAvailableFileName(parentDirectory),
    });
  }, [nextAvailableFileName, refreshWorkspaceTree, text.sidebar.openFolderHint]);

  const handleCreateFileCancel = useCallback(() => {
    createFileInFlightRef.current = false;
    setCreatingFile(null);
  }, []);

  const handleCreateFileSubmit = useCallback(async () => {
    if (!creatingFile || createFileInFlightRef.current) return;

    const workspacePath = workspacePathRef.current;
    const parentDirectory = creatingFile.parentPath ?? workspacePath;
    const rawFileName = creatingFile.value.trim();
    if (!workspacePath || !parentDirectory) {
      handleCreateFileCancel();
      return;
    }
    if (!rawFileName) {
      handleCreateFileCancel();
      return;
    }
    if (hasPathSeparator(rawFileName)) {
      message.warning(text.sidebar.fileNameInvalid);
      return;
    }

    const fileName = hasFileExtension(rawFileName) ? rawFileName : `${rawFileName}.md`;
    const filePath = joinPath(parentDirectory, fileName);
    createFileInFlightRef.current = true;
    try {
      if (await pathExists(filePath)) {
        message.warning(text.sidebar.fileAlreadyExists(fileName));
        return;
      }

      await writeTextFile(filePath, `# ${fileName.replace(/\.\w+$/, '')}\n\n`);
      const nextExpanded = new Set(expandedRef.current);
      if (creatingFile.parentPath) nextExpanded.add(creatingFile.parentPath);
      setCreatingFile(null);
      await refreshWorkspaceTree(nextExpanded);
      dispatch({
        type: 'OPEN_TAB',
        payload: { id: filePath, name: fileName, path: filePath, content: `# ${fileName.replace(/\.\w+$/, '')}\n\n` },
      });
      dispatch({ type: 'ADD_RECENT_FILE', payload: { path: filePath, name: fileName, lastOpened: Date.now() } });
      message.success(text.sidebar.fileCreated(fileName));
    } catch (error) {
      console.error('Failed to create file:', error);
      message.error(text.sidebar.createFileFailed);
    } finally {
      createFileInFlightRef.current = false;
    }
  }, [creatingFile, dispatch, handleCreateFileCancel, refreshWorkspaceTree, text.sidebar]);

  const canDropInto = useCallback((source: FileNode | null, targetPath: string | null) => {
    const workspacePath = workspacePathRef.current;
    if (!source || !workspacePath) return false;
    const targetDirectory = targetPath ?? workspacePath;
    if (source.path === targetDirectory) return false;
    if (source.type === 'folder' && isPathInside(targetDirectory, source.path)) return false;
    if (parentPathOf(source.path) === targetDirectory) return false;
    return true;
  }, []);

  const handleTreeDragStart = useCallback((event: DragEvent<HTMLDivElement>, node: FileNode) => {
    if (renaming || creatingFolder || creatingFile) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    dragNodeRef.current = node;
    setDraggingPath(node.path);
    setDropTargetPath(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-orcha-workspace-path', node.path);
    event.dataTransfer.setData('text/plain', node.path);
  }, [creatingFile, creatingFolder, renaming]);

  const handleTreeDragOver = useCallback((event: DragEvent<HTMLDivElement>, targetPath: string | null) => {
    if (!canDropInto(dragNodeRef.current, targetPath)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetPath(dropTargetKey(targetPath));
  }, [canDropInto]);

  const handleTreeDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (relatedTarget && event.currentTarget.contains(relatedTarget)) return;
    setDropTargetPath(null);
  }, []);

  const handleTreeDragEnd = useCallback(() => {
    dragNodeRef.current = null;
    setDraggingPath(null);
    setDropTargetPath(null);
  }, []);

  const handleTreeDrop = useCallback(async (event: DragEvent<HTMLDivElement>, targetPath: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    const source = dragNodeRef.current;
    const workspacePath = workspacePathRef.current;
    setDropTargetPath(null);
    if (!source || !workspacePath || !canDropInto(source, targetPath)) {
      handleTreeDragEnd();
      return;
    }

    const targetDirectory = targetPath ?? workspacePath;
    const nextPath = joinPath(targetDirectory, source.name);
    try {
      if (await pathExists(nextPath)) {
        message.warning(text.sidebar.moveTargetExists(source.name));
        return;
      }

      await rename(source.path, nextPath);
      const nextExpanded = rebaseExpandedFolders(expandedRef.current, source.path, nextPath);
      if (targetPath) nextExpanded.add(targetPath);
      setExpandedFolders(nextExpanded);
      dispatch({ type: 'RENAME_PATH', payload: { oldPath: source.path, newPath: nextPath, name: source.name } });
      await refreshWorkspaceTree(nextExpanded);
      message.success(text.sidebar.itemMoved(source.name));
    } catch (error) {
      console.error('Failed to move workspace item:', error);
      message.error(text.sidebar.moveItemFailed);
    } finally {
      handleTreeDragEnd();
    }
  }, [canDropInto, dispatch, handleTreeDragEnd, refreshWorkspaceTree, text.sidebar]);

  useEffect(() => {
    if (!activeWorkspaceFilePath) {
      pendingRevealPathRef.current = null;
      return;
    }

    let cancelled = false;

    const revealActiveFile = async () => {
      const workspacePath = workspacePathRef.current;
      if (!workspacePath || !isPathWithinWorkspace(activeWorkspaceFilePath, workspacePath)) return;

      const nextExpanded = new Set(expandedRef.current);
      let expandedChanged = false;
      for (const folderPath of ancestorFoldersForFile(activeWorkspaceFilePath, workspacePath)) {
        if (!nextExpanded.has(folderPath)) {
          nextExpanded.add(folderPath);
          expandedChanged = true;
        }
      }

      pendingRevealPathRef.current = activeWorkspaceFilePath;
      if (state.sidebarActiveTab !== 'workspace') {
        dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'workspace' });
      }

      if (expandedChanged || !findNode(treeRef.current, activeWorkspaceFilePath)) {
        setExpandedFolders(nextExpanded);
        await refreshWorkspaceTree(nextExpanded);
        return;
      }

      if (!cancelled) {
        scrollActiveTreeItemIntoView();
      }
    };

    void revealActiveFile();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceFilePath, dispatch, refreshWorkspaceTree, scrollActiveTreeItemIntoView, state.sidebarActiveTab]);

  useEffect(() => {
    const pendingPath = pendingRevealPathRef.current;
    if (!pendingPath || pendingPath !== activeWorkspaceFilePath || state.sidebarActiveTab !== 'workspace') return;
    if (!findNode(state.workspaceTree, pendingPath)) return;

    pendingRevealPathRef.current = null;
    scrollActiveTreeItemIntoView();
  }, [activeWorkspaceFilePath, scrollActiveTreeItemIntoView, state.sidebarActiveTab, state.workspaceTree]);

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

        <div ref={sidebarContentRef} className="sidebar-content" onClick={closeContextMenu}>
          {state.sidebarActiveTab === 'workspace' && (
            <WorkspaceTree
              tree={state.workspaceTree}
              workspacePath={state.workspacePath}
              expandedFolders={expandedFolders}
              loadingFolders={loadingFolders}
              toggleFolder={toggleFolder}
              openFile={openFile}
              activeTabId={state.activeTabId}
              onContextMenu={handleContextMenu}
              renaming={renaming}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={handleRenameCancel}
              onRename={handleRename}
              creatingFolder={creatingFolder}
              onCreateFolderStart={handleCreateFolderStart}
              onCreateFolderChange={(value) => setCreatingFolder(current => current ? { ...current, value } : current)}
              onCreateFolderSubmit={handleCreateFolderSubmit}
              onCreateFolderCancel={handleCreateFolderCancel}
              creatingFile={creatingFile}
              onCreateFileStart={handleCreateFileStart}
              onCreateFileChange={(value) => setCreatingFile(current => current ? { ...current, value } : current)}
              onCreateFileSubmit={handleCreateFileSubmit}
              onCreateFileCancel={handleCreateFileCancel}
              draggingPath={draggingPath}
              dropTargetPath={dropTargetPath}
              onDragStart={handleTreeDragStart}
              onDragOver={handleTreeDragOver}
              onDragLeave={handleTreeDragLeave}
              onDrop={handleTreeDrop}
              onDragEnd={handleTreeDragEnd}
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

      {contextMenu && (contextMenu.item || state.workspacePath) && (
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
                <>
                  <div className="context-menu-item" onClick={() => void handleCreateFolderStart(contextMenu.item!.path)}>
                    <FolderPlus size={14} /> {text.contextMenu.newFolder}
                  </div>
                  <div className="context-menu-item" onClick={() => void handleCreateFileStart(contextMenu.item!.path)}>
                    <FilePlus size={14} /> {text.contextMenu.newFile}
                  </div>
                </>
              )}
              <div className="context-menu-divider" />
              <div className="context-menu-item danger" onClick={() => handleDelete(contextMenu.item!)}>
                <Trash2 size={14} /> {text.contextMenu.delete}
              </div>
            </>
          )}
          {!contextMenu.item && state.workspacePath && (
            <>
              <div className="context-menu-item" onClick={() => void handleCreateFolderStart(null)}>
                <FolderPlus size={14} /> {text.contextMenu.newFolder}
              </div>
              <div className="context-menu-item" onClick={() => void handleCreateFileStart(null)}>
                <FilePlus size={14} /> {text.contextMenu.newFile}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function WorkspaceTree({
  tree, workspacePath, expandedFolders, loadingFolders, toggleFolder, openFile, activeTabId,
  onContextMenu, renaming, renameValue, onRenameChange, onRenameSubmit, onRenameCancel, onRename,
  creatingFolder, onCreateFolderStart, onCreateFolderChange, onCreateFolderSubmit, onCreateFolderCancel,
  creatingFile, onCreateFileStart, onCreateFileChange, onCreateFileSubmit, onCreateFileCancel,
  draggingPath, dropTargetPath, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, text
}: WorkspaceTreeProps) {
  const hasWorkspace = Boolean(workspacePath);
  const isRootDropTarget = dropTargetPath === ROOT_DROP_TARGET;

  if (tree.length === 0) {
    return (
      <div
        className={`workspace-tree ${isRootDropTarget ? 'drop-target' : ''}`}
        onDragOver={(event) => onDragOver(event, null)}
        onDragLeave={onDragLeave}
        onDrop={(event) => { void onDrop(event, null); }}
        onContextMenu={(event) => onContextMenu(event, null)}
      >
        {creatingFolder?.parentPath === null && (
          <NewFolderInput
            depth={0}
            value={creatingFolder.value}
            onChange={onCreateFolderChange}
            onSubmit={onCreateFolderSubmit}
            onCancel={onCreateFolderCancel}
            text={text}
          />
        )}
        {creatingFile?.parentPath === null && (
          <NewFileInput
            depth={0}
            value={creatingFile.value}
            onChange={onCreateFileChange}
            onSubmit={onCreateFileSubmit}
            onCancel={onCreateFileCancel}
            text={text}
          />
        )}
        {!creatingFolder && !creatingFile && (
          <div style={{ padding: '20px 16px', textAlign: 'center' }}>
            <FolderOpen size={32} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
            <p style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginBottom: '12px' }}>
              {hasWorkspace ? text.sidebar.emptyWorkspace : text.sidebar.openFolderHint}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`workspace-tree ${isRootDropTarget ? 'drop-target' : ''}`}
      onDragOver={(event) => onDragOver(event, null)}
      onDragLeave={onDragLeave}
      onDrop={(event) => { void onDrop(event, null); }}
      onContextMenu={(event) => onContextMenu(event, null)}
    >
      {creatingFolder?.parentPath === null && (
        <NewFolderInput
          depth={0}
          value={creatingFolder.value}
          onChange={onCreateFolderChange}
          onSubmit={onCreateFolderSubmit}
          onCancel={onCreateFolderCancel}
          text={text}
        />
      )}
      {creatingFile?.parentPath === null && (
        <NewFileInput
          depth={0}
          value={creatingFile.value}
          onChange={onCreateFileChange}
          onSubmit={onCreateFileSubmit}
          onCancel={onCreateFileCancel}
          text={text}
        />
      )}
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
          creatingFolder={creatingFolder}
          onCreateFolderStart={onCreateFolderStart}
          onCreateFolderChange={onCreateFolderChange}
          onCreateFolderSubmit={onCreateFolderSubmit}
          onCreateFolderCancel={onCreateFolderCancel}
          creatingFile={creatingFile}
          onCreateFileStart={onCreateFileStart}
          onCreateFileChange={onCreateFileChange}
          onCreateFileSubmit={onCreateFileSubmit}
          onCreateFileCancel={onCreateFileCancel}
          draggingPath={draggingPath}
          dropTargetPath={dropTargetPath}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          text={text}
        />
      ))}
    </div>
  );
}

function TreeNode({
  node, depth, expandedFolders, loadingFolders, toggleFolder, openFile, activeTabId, onContextMenu,
  renaming, renameValue, onRenameChange, onRenameSubmit, onRenameCancel, onRename, creatingFolder,
  onCreateFolderStart, onCreateFolderChange, onCreateFolderSubmit, onCreateFolderCancel,
  creatingFile, onCreateFileStart, onCreateFileChange, onCreateFileSubmit, onCreateFileCancel,
  draggingPath, dropTargetPath, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, text,
}: TreeNodeProps) {
  const isExpanded = expandedFolders.has(node.path);
  const isLoading = loadingFolders?.has(node.path);
  const isActive = activeTabId === node.path;
  const isRenaming = renaming === node.path;
  const isDragging = draggingPath === node.path;
  const isDropTarget = dropTargetPath === node.path;
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
          className={`file-tree-item ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
          style={depthStyle}
          tabIndex={0}
          draggable={!isRenaming}
          onClick={() => toggleFolder(node.path)}
          onDragStart={(event) => onDragStart(event, node)}
          onDragOver={(event) => onDragOver(event, node.path)}
          onDragLeave={onDragLeave}
          onDrop={(event) => { void onDrop(event, node.path); }}
          onDragEnd={onDragEnd}
          onKeyDown={handleKeyDown}
          onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e, node); }}
          title={`${node.path}`}
        >
          {isLoading ? (
            <span className="spinner" />
          ) : (
            <ChevronRight size={12} className={`chevron ${isExpanded ? 'expanded' : ''}`} />
          )}
          <Folder size={14} className="icon" />
          {nameNode}
        </div>
        {isExpanded && creatingFolder?.parentPath === node.path && (
          <NewFolderInput
            depth={depth + 1}
            value={creatingFolder.value}
            onChange={onCreateFolderChange}
            onSubmit={onCreateFolderSubmit}
            onCancel={onCreateFolderCancel}
            text={text}
          />
        )}
        {isExpanded && creatingFile?.parentPath === node.path && (
          <NewFileInput
            depth={depth + 1}
            value={creatingFile.value}
            onChange={onCreateFileChange}
            onSubmit={onCreateFileSubmit}
            onCancel={onCreateFileCancel}
            text={text}
          />
        )}
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
            creatingFolder={creatingFolder}
            onCreateFolderStart={onCreateFolderStart}
            onCreateFolderChange={onCreateFolderChange}
            onCreateFolderSubmit={onCreateFolderSubmit}
            onCreateFolderCancel={onCreateFolderCancel}
            creatingFile={creatingFile}
            onCreateFileStart={onCreateFileStart}
            onCreateFileChange={onCreateFileChange}
            onCreateFileSubmit={onCreateFileSubmit}
            onCreateFileCancel={onCreateFileCancel}
            draggingPath={draggingPath}
            dropTargetPath={dropTargetPath}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            text={text}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`file-tree-item ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
      style={depthStyle}
      tabIndex={0}
      draggable={!isRenaming}
      onClick={() => openFile(node)}
      onDragStart={(event) => onDragStart(event, node)}
      onDragEnd={onDragEnd}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e, node); }}
    >
      <span style={{ width: 12 }} />
      <File size={14} className="icon" />
      {nameNode}
    </div>
  );
}

function NewFileInput({
  depth,
  value,
  onChange,
  onSubmit,
  onCancel,
  text,
}: {
  depth: number;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
  text: ReturnType<typeof getLocaleText>;
}) {
  const depthStyle: DepthStyle = { '--depth': depth };
  return (
    <div className="file-tree-item new-file-row" style={depthStyle}>
      <span style={{ width: 12 }} />
      <File size={14} className="icon" />
      <input
        className="rename-input"
        value={value}
        aria-label={text.sidebar.newFile}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { void onSubmit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            void onSubmit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.currentTarget.select()}
        autoFocus
      />
    </div>
  );
}

function NewFolderInput({
  depth,
  value,
  onChange,
  onSubmit,
  onCancel,
  text,
}: {
  depth: number;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
  text: ReturnType<typeof getLocaleText>;
}) {
  const depthStyle: DepthStyle = { '--depth': depth };
  return (
    <div className="file-tree-item new-folder-row" style={depthStyle}>
      <span style={{ width: 12 }} />
      <Folder size={14} className="icon" />
      <input
        className="rename-input"
        value={value}
        aria-label={text.sidebar.newFolder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { void onSubmit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            void onSubmit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.currentTarget.select()}
        autoFocus
      />
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

import { invoke } from '@tauri-apps/api/core';
import type { FileNode } from '../types';

export const DEFAULT_HIDDEN_PATTERNS = [
  '.DS_Store',
  '.localized',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '__pycache__',
  '.venv',
  'vendor',
  'dist',
  'build',
  '.next',
  '.output',
  'target',
  '.vscode',
  '.idea',
  '.eslintcache',
  '.turbo',
  '.Trash',
  '.CFUserTextEncoding',
  '.ssh',
  '.config',
  '.cache',
];

const VISIBLE_DOTFILES = ['.gitkeep', '.gitignore', '.env', '.env.local', '.editorconfig'];

export function buildHidePatterns(patterns: string[] = []): string[] {
  return [...new Set([...DEFAULT_HIDDEN_PATTERNS, ...patterns.filter(Boolean)])];
}

export function isHidden(name: string, patterns: string[] = DEFAULT_HIDDEN_PATTERNS): boolean {
  if (name.startsWith('.') && !VISIBLE_DOTFILES.includes(name)) return true;
  return patterns.includes(name);
}

export async function readFirstLevel(dirPath: string, userPatterns: string[] = []): Promise<FileNode[]> {
  const patterns = buildHidePatterns(userPatterns);
  const entries: Array<{ name: string; is_directory: boolean }> = await invoke('read_directory_entries', { dirPath });
  const items: FileNode[] = entries
    .filter(entry => !isHidden(entry.name, patterns))
    .map(entry => ({
      name: entry.name,
      path: `${dirPath}/${entry.name}`,
      type: entry.is_directory ? 'folder' : 'file',
      children: entry.is_directory ? [] : undefined,
    }));

  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  return items;
}

export function findFirstMdFile(tree: FileNode[]): FileNode | null {
  for (const node of tree) {
    if (node.type === 'file' && /\.(md|markdown|mdown|mkd)$/i.test(node.name)) return node;
    if (node.type === 'folder' && node.children) {
      const found = findFirstMdFile(node.children);
      if (found) return found;
    }
  }
  return null;
}

import type { FileNode } from '../types';
import { readFirstLevel } from './workspace';

export interface FileSearchResult {
  node: FileNode;
  relativePath: string;
}

function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function relativeWorkspacePath(path: string, workspacePath: string): string {
  const normalizedPath = normalizePathForCompare(path);
  const normalizedWorkspace = normalizePathForCompare(workspacePath);
  if (normalizedPath === normalizedWorkspace) return '';
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return normalizedPath;
}

export function matchesFileSearchText(name: string, path: string, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return false;
  const haystack = `${name} ${path}`.toLowerCase();
  return terms.every(term => haystack.includes(term));
}

export async function searchWorkspaceFiles(
  workspacePath: string,
  query: string,
  hidePatterns: string[],
  limit: number,
  shouldCancel?: () => boolean,
): Promise<FileSearchResult[]> {
  const results: FileSearchResult[] = [];

  const visit = async (directoryPath: string) => {
    if (results.length >= limit || shouldCancel?.()) return;
    let nodes: FileNode[];
    try {
      nodes = await readFirstLevel(directoryPath, hidePatterns);
    } catch (error) {
      console.warn('[fileSearch] Failed to search folder:', directoryPath, error);
      return;
    }
    if (shouldCancel?.()) return;

    for (const node of nodes) {
      if (results.length >= limit || shouldCancel?.()) return;
      const relativePath = relativeWorkspacePath(node.path, workspacePath);
      if (node.type === 'file' && matchesFileSearchText(node.name, relativePath, query)) {
        results.push({ node, relativePath });
      }
      if (node.type === 'folder') {
        await visit(node.path);
      }
    }
  };

  await visit(workspacePath);
  return results;
}

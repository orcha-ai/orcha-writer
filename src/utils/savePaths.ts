import { pathExists } from './fs';

export function decodeDialogPath(path: string): string {
  if (path.startsWith('file://')) {
    return decodeURIComponent(path.slice(7));
  }
  return path;
}

export function fileNameFromPath(path: string, fallback = 'untitled.md'): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || fallback;
}

export function normalizeMarkdownFileName(name: string): string {
  const trimmed = name.trim() || '未命名.md';
  const withoutSlashes = trimmed.replace(/[\\/:*?"<>|]/g, '-');
  return /\.md$/i.test(withoutSlashes) ? withoutSlashes : `${withoutSlashes}.md`;
}

export async function availableMarkdownPath(directory: string, preferredName: string): Promise<string> {
  const name = normalizeMarkdownFileName(preferredName);
  const extensionMatch = name.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] || '.md';
  const baseName = extensionMatch ? name.slice(0, -extension.length) : name;
  const cleanDirectory = directory.replace(/\/+$/, '');

  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index === 0 ? name : `${baseName}-${index + 1}${extension}`;
    const candidatePath = `${cleanDirectory}/${candidateName}`;
    if (!(await pathExists(candidatePath))) return candidatePath;
  }

  return `${cleanDirectory}/${baseName}-${Date.now()}${extension}`;
}

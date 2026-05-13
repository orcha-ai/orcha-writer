import { pathExists } from './fs';
import { getDocumentLanguage, translateText } from '../i18n';
import type { FilePreviewKind } from '../types';

export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd'];
export const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif'];
export const PDF_FILE_EXTENSIONS = ['pdf'];

export const TEXT_FILE_EXTENSIONS = [
  ...MARKDOWN_EXTENSIONS,
  'txt',
  'text',
  'yaml',
  'yml',
  'xml',
  'sql',
  'py',
  'json',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'html',
  'htm',
  'csv',
  'log',
  'sh',
  'toml',
  'ini',
  'env',
];

export const TEXT_FILE_DIALOG_FILTERS = [
  { name: '文本与代码', extensions: TEXT_FILE_EXTENSIONS },
  { name: 'Markdown', extensions: MARKDOWN_EXTENSIONS },
  { name: '纯文本', extensions: ['txt', 'text'] },
  { name: '配置文件', extensions: ['yaml', 'yml', 'json', 'toml', 'ini', 'env', 'xml'] },
  { name: '代码文件', extensions: ['sql', 'py', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'html', 'htm', 'sh'] },
];

export function getTextFileDialogFilters(language: unknown): typeof TEXT_FILE_DIALOG_FILTERS {
  return TEXT_FILE_DIALOG_FILTERS.map(filter => ({
    ...filter,
    name: translateText(language, filter.name),
  }));
}

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

function extensionFromName(name: string): string | null {
  const separatorIndex = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= separatorIndex || dotIndex <= 0 || dotIndex >= name.length - 1) return null;
  return name.slice(dotIndex + 1).toLowerCase();
}

export function fileExtensionFromName(name: string): string | null {
  return extensionFromName(name);
}

function sanitizeFileName(name: string, fallback = translateText(getDocumentLanguage(), '未命名.md')): string {
  return (name.trim() || fallback).replace(/[\\/:*?"<>|]/g, '-');
}

export function isMarkdownFileName(name: string): boolean {
  const extension = extensionFromName(name);
  return Boolean(extension && MARKDOWN_EXTENSIONS.includes(extension));
}

export function isOpenableTextFileName(name: string): boolean {
  const extension = extensionFromName(name);
  return Boolean(extension && TEXT_FILE_EXTENSIONS.includes(extension));
}

export function getPreviewFileKind(name: string): FilePreviewKind | null {
  const extension = extensionFromName(name);
  if (!extension) return null;
  if (IMAGE_FILE_EXTENSIONS.includes(extension)) return 'image';
  if (PDF_FILE_EXTENSIONS.includes(extension)) return 'pdf';
  return null;
}

export function isPreviewableFileName(name: string): boolean {
  return Boolean(getPreviewFileKind(name));
}

export function normalizeTextFileName(name: string): string {
  const sanitized = sanitizeFileName(name);
  return extensionFromName(sanitized) ? sanitized : `${sanitized}.md`;
}

export function ensureTextFileExtension(path: string, preferredName: string): string {
  if (extensionFromName(path)) return path;
  const preferredExtension = extensionFromName(preferredName) || 'md';
  return `${path}.${preferredExtension}`;
}

export function normalizeMarkdownFileName(name: string): string {
  const withoutSlashes = sanitizeFileName(name);
  return /\.md$/i.test(withoutSlashes) ? withoutSlashes : `${withoutSlashes}.md`;
}

export async function availableTextFilePath(directory: string, preferredName: string): Promise<string> {
  const name = normalizeTextFileName(preferredName);
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

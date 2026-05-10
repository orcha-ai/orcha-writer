import { convertFileSrc, isTauri } from '@tauri-apps/api/core';

const SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;
const ABSOLUTE_PATH_RE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? '/' : '';
  const parts = normalized.split('/').filter(Boolean);
  const stack: string[] = [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!prefix) {
        stack.push(part);
      }
      continue;
    }
    stack.push(part);
  }

  return prefix + stack.join('/');
}

function joinPath(base: string, relative: string): string {
  if (!base) return relative;
  return normalizePath(`${base.replace(/\/+$/, '')}/${relative}`);
}

function relativePath(fromDir: string, toPath: string): string {
  const from = fromDir.replace(/\\/g, '/').split('/').filter(Boolean);
  const to = toPath.replace(/\\/g, '/').split('/').filter(Boolean);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1;
  }
  if (common === 0) return toPath.replace(/\\/g, '/');
  return [
    ...Array.from({ length: from.length - common }, () => '..'),
    ...to.slice(common),
  ].join('/') || './';
}

export function formatMarkdownImageUrl(url: string): string {
  const normalized = url.replace(/\\/g, '/');
  return /[\s()<>]/.test(normalized) ? `<${normalized.replace(/>/g, '%3E')}>` : normalized;
}

export function markdownImagePathForDocument(imagePath: string, documentPath?: string): string {
  if (!documentPath || !/[/\\]/.test(documentPath)) return imagePath.replace(/\\/g, '/');
  return relativePath(dirname(documentPath), imagePath);
}

function shouldWrapBareImageDestination(destination: string): boolean {
  const trimmed = destination.trim();
  if (!/\s/.test(trimmed)) return false;
  if (/["']/.test(trimmed)) return false;
  return /^(?:\/|\.{1,2}\/|~\/|[A-Za-z]:[\\/]|file:\/\/)/i.test(trimmed);
}

export function normalizeMarkdownImageSyntax(content: string): string {
  return content.replace(/!\[([^\]\n]*)\]\((?!<)([^)\n]*\s[^)\n]*)\)/g, (match, alt: string, destination: string) => {
    if (!shouldWrapBareImageDestination(destination)) return match;
    return `![${alt}](${formatMarkdownImageUrl(destination.trim())})`;
  });
}

export interface ResolvedMarkdownImageSource {
  originalSrc: string;
  src: string;
  filePath?: string;
  isLocalFile: boolean;
  note?: string;
}

function fileUrlToPath(src: string): string {
  try {
    const url = new URL(src);
    return decodeURIComponent(url.pathname);
  } catch {
    return safeDecodeUri(src.replace(/^file:\/\//i, ''));
  }
}

export function resolveMarkdownImageSource(src: string, documentPath?: string): ResolvedMarkdownImageSource {
  const trimmed = src.trim();
  if (!trimmed) {
    return { originalSrc: src, src, isLocalFile: false, note: 'empty-src' };
  }

  if (/^(?:data|blob|asset|https?):/i.test(trimmed)) {
    return { originalSrc: src, src: trimmed, isLocalFile: false };
  }
  if (!isTauri()) {
    return { originalSrc: src, src: trimmed, isLocalFile: false, note: 'not-tauri' };
  }

  if (/^file:\/\//i.test(trimmed)) {
    const filePath = fileUrlToPath(trimmed);
    return { originalSrc: src, src: convertFileSrc(filePath), filePath, isLocalFile: true };
  }

  const decoded = safeDecodeUri(trimmed);
  if (ABSOLUTE_PATH_RE.test(decoded)) {
    return { originalSrc: src, src: convertFileSrc(decoded), filePath: decoded, isLocalFile: true };
  }

  if (SCHEME_RE.test(decoded)) {
    return { originalSrc: src, src: trimmed, isLocalFile: false, note: 'unsupported-scheme' };
  }

  const baseDir = documentPath && /[/\\]/.test(documentPath) ? dirname(documentPath) : '';
  if (!baseDir) {
    return { originalSrc: src, src: trimmed, isLocalFile: true, note: 'missing-document-path' };
  }
  const filePath = joinPath(baseDir, decoded);
  return { originalSrc: src, src: convertFileSrc(filePath), filePath, isLocalFile: true };
}

export function resolveMarkdownImageSrc(src: string, documentPath?: string): string {
  return resolveMarkdownImageSource(src, documentPath).src;
}

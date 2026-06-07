import type { TabFile } from '../types';
import { copyFile, ensureDir, readClipboardFileUrls, readClipboardImage, writeBinaryFile } from './fs';
import { basename, dirname, markdownImagePathForDocument, stripExtension } from './markdownImages';

export type PasteImageAction = 'assets' | 'workspace-assets' | 'original';

export interface PasteImageContext {
  action: PasteImageAction;
  activeTab?: Pick<TabFile, 'path' | 'isDraft'>;
  workspacePath: string | null;
}

export interface PastedMarkdownImage {
  markdownPath: string;
  alt: string;
  fallbackToDataUrl?: boolean;
}

let pastedImageSerial = 0;
const ORCHA_RESOURCE_DIR = '.orcha-writer/resources';

export function isImageLikeType(type: string): boolean {
  return type.startsWith('image/') || type === 'public.tiff';
}

export function imageExtensionFromType(type: string): string {
  if (type === 'public.tiff' || type === 'image/tiff') return 'tiff';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/svg+xml') return 'svg';
  const subtype = type.match(/^image\/([a-z0-9.+-]+)$/i)?.[1]?.toLowerCase();
  return subtype ? subtype.replace(/^x-/, '') : 'png';
}

export function isImageFile(file: File): boolean {
  return isImageLikeType(file.type) || /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|avif|heic|heif)$/i.test(file.name);
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|avif|heic|heif)$/i.test(path.split(/[?#]/)[0]);
}

function decodeClipboardPath(value: string): string {
  const trimmed = value.trim();
  if (/^file:\/\//i.test(trimmed)) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return decodeURIComponent(trimmed.replace(/^file:\/\//i, ''));
    }
  }
  return trimmed;
}

export function extractImagePathsFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(decodeClipboardPath)
    .filter(path => /^(?:\/|[A-Za-z]:[\\/])/.test(path) && isImagePath(path));
}

export async function readClipboardImagePaths(): Promise<string[]> {
  const fileUrls = await readClipboardFileUrls().catch(() => []);
  return extractImagePathsFromText(fileUrls.join('\n'));
}

export function extractDataImageUrlsFromHtml(html: string): string[] {
  const urls: string[] = [];
  const pattern = /<img\b[^>]*\bsrc=["'](data:image\/[^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    urls.push(match[1]);
  }
  return urls;
}

export async function dataUrlToFile(dataUrl: string, index: number): Promise<File | null> {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  if (!match) return null;
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const extension = imageExtensionFromType(match[1]);
  return new File([blob], `clipboard-image-${index + 1}.${extension}`, { type: match[1] });
}

function imageExtension(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif'].includes(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName;
  }
  if (file.type) return imageExtensionFromType(file.type);
  return 'png';
}

function makePastedImageFileName(file: File): string {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  pastedImageSerial += 1;
  return `pasted-${timestamp}-${pastedImageSerial}.${imageExtension(file)}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

export async function readClipboardImageFiles(): Promise<File[]> {
  const nativeImage = await readClipboardImage().catch(() => null);
  if (nativeImage?.bytes?.length) {
    return [
      new File(
        [new Uint8Array(nativeImage.bytes)],
        nativeImage.fileName || 'clipboard-image.png',
        { type: nativeImage.mimeType || 'image/png' },
      ),
    ];
  }

  if (!navigator.clipboard?.read) return [];

  const items = await navigator.clipboard.read();
  const files: File[] = [];

  for (const item of items) {
    const type = item.types.find(isImageLikeType);
    if (!type) continue;

    const blob = await item.getType(type);
    const mimeType = blob.type && isImageLikeType(blob.type)
      ? blob.type
      : type === 'public.tiff'
        ? 'image/tiff'
        : blob.type;
    const extension = imageExtensionFromType(mimeType || type);
    files.push(new File([blob], `clipboard-image.${extension}`, { type: mimeType }));
  }

  return files;
}

export function imageFilesFromClipboardData(clipboard: DataTransfer): File[] {
  const itemFiles = Array.from(clipboard.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null && isImageFile(file));

  return itemFiles.length > 0
    ? itemFiles
    : Array.from(clipboard.files).filter(isImageFile);
}

export function imagePathsFromClipboardData(clipboard: DataTransfer): string[] {
  return extractImagePathsFromText(clipboard.getData('text/uri-list') || clipboard.getData('text/plain'));
}

export function dataImageUrlsFromClipboardData(clipboard: DataTransfer): string[] {
  return extractDataImageUrlsFromHtml(clipboard.getData('text/html'));
}

export function hasClipboardFileUrlHint(clipboard: DataTransfer): boolean {
  return Array.from(clipboard.types).some(type => type === 'Files' || /file-url/i.test(type));
}

export function hasNativeClipboardImageHint(clipboard: DataTransfer): boolean {
  const plainText = clipboard.getData('text/plain');
  const uriText = clipboard.getData('text/uri-list');
  const htmlText = clipboard.getData('text/html');
  return Array.from(clipboard.types).some(type => (
    type === 'Files'
    || isImageLikeType(type)
    || /(?:image|file|public\.tiff)/i.test(type)
  )) || (!plainText && !uriText && !htmlText);
}

function getPastedImageTarget(
  file: File,
  action: PasteImageAction,
  activeTab: PasteImageContext['activeTab'],
  workspacePath: string | null,
): { dir: string; filePath: string; markdownPath: string; fileName: string } | null {
  if (action === 'original') return null;

  const hasSavedDocument = Boolean(activeTab && !activeTab.isDraft && /[/\\]/.test(activeTab.path));
  const documentDir = hasSavedDocument && activeTab ? dirname(activeTab.path) : '';
  const assetRoot = action === 'workspace-assets' && workspacePath
    ? workspacePath
    : documentDir;

  if (!assetRoot) return null;

  const fileName = makePastedImageFileName(file);
  const dir = `${assetRoot}/${ORCHA_RESOURCE_DIR}`;
  const filePath = `${dir}/${fileName}`;
  const markdownPath = activeTab ? markdownImagePathForDocument(filePath, activeTab.path) : filePath;

  return { dir, filePath, markdownPath, fileName };
}

export async function writePastedMarkdownImageFile(file: File, context: PasteImageContext): Promise<PastedMarkdownImage> {
  const target = getPastedImageTarget(file, context.action, context.activeTab, context.workspacePath);

  if (!target) {
    return {
      markdownPath: await fileToDataUrl(file),
      alt: stripExtension(file.name),
      fallbackToDataUrl: context.action !== 'original',
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  await ensureDir(target.dir);
  await writeBinaryFile(target.filePath, bytes);

  return {
    markdownPath: target.markdownPath,
    alt: stripExtension(file.name) || stripExtension(target.fileName),
  };
}

export async function writePastedMarkdownImagePath(sourcePath: string, context: PasteImageContext): Promise<PastedMarkdownImage> {
  const sourceName = basename(sourcePath);
  const placeholder = new File([], sourceName || 'clipboard-image.png');
  const target = getPastedImageTarget(placeholder, context.action, context.activeTab, context.workspacePath);

  if (!target) {
    return {
      markdownPath: markdownImagePathForDocument(sourcePath, context.activeTab?.path),
      alt: stripExtension(sourceName),
    };
  }

  await ensureDir(target.dir);
  await copyFile(sourcePath, target.filePath);

  return {
    markdownPath: target.markdownPath,
    alt: stripExtension(sourceName) || stripExtension(target.fileName),
  };
}

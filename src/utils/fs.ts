import { invoke } from '@tauri-apps/api/core';

export interface ClipboardImageData {
  fileName: string;
  mimeType: string;
  bytes: number[];
}

/** Read text file content via custom Rust command (bypasses fs plugin scope restrictions) */
export async function readTextFile(filePath: string): Promise<string> {
  return invoke<string>('read_file_content', { filePath });
}

/** Write text content to file via custom Rust command */
export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await invoke('write_file_content', { filePath, content });
}

/** Write binary content to file via custom Rust command */
export async function writeBinaryFile(filePath: string, bytes: Uint8Array): Promise<void> {
  await invoke('write_binary_file', { filePath, bytes: Array.from(bytes) });
}

/** Read binary content via custom Rust command */
export async function readBinaryFile(filePath: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('read_binary_file', { filePath });
  return new Uint8Array(bytes);
}

/** Create a directory and all missing parents */
export async function ensureDir(dirPath: string): Promise<void> {
  await invoke('create_dir_all', { dirPath });
}

/** Copy a file via custom Rust command */
export async function copyFile(sourcePath: string, targetPath: string): Promise<void> {
  await invoke('copy_file_content', { sourcePath, targetPath });
}

/** Read image bytes from the native system clipboard when WebView clipboard APIs cannot. */
export async function readClipboardImage(): Promise<ClipboardImageData | null> {
  return invoke<ClipboardImageData | null>('read_clipboard_image');
}

/** Read file URLs from the native system clipboard when images are copied from Finder. */
export async function readClipboardFileUrls(): Promise<string[]> {
  return invoke<string[]>('read_clipboard_file_urls');
}

/** Check whether a path exists */
export async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>('path_exists', { path });
}

/** Delete file or directory via custom Rust command */
export async function remove(path: string, options?: { recursive?: boolean }): Promise<void> {
  await invoke('delete_path', { path, recursive: options?.recursive ?? false });
}

/** Rename file or directory via custom Rust command */
export async function rename(from: string, to: string): Promise<void> {
  await invoke('rename_path', { from, to });
}

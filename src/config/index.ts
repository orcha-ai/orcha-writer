// Configuration read/write layer
// Uses custom Rust commands to read/write ~/.orcha-writer/config/ files.
// Falls back to localStorage in browser/dev mode.

import { invoke } from '@tauri-apps/api/core';
import { readTextFile, writeTextFile } from '../utils/fs';

const CONFIG_PREFIX = 'orcha-config:';
let configDirCache: string | null = null;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function getConfigDir(): Promise<string> {
  if (configDirCache) return configDirCache;

  if (isTauri()) {
    configDirCache = await invoke<string>('ensure_config_dir');
    return configDirCache;
  }
  return '';
}

async function ensureConfigDir(): Promise<void> {
  if (isTauri()) {
    try {
      await getConfigDir();
    } catch {
      // ignore
    }
  }
}

function filePath(filename: string): string {
  return `${CONFIG_PREFIX}${filename}`;
}

// Browser mode helpers
function readFromLocalStorage(filename: string): unknown {
  try {
    const raw = localStorage.getItem(filePath(filename));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function writeToLocalStorage(filename: string, data: unknown): void {
  localStorage.setItem(filePath(filename), JSON.stringify(data));
}

export async function readConfig<T>(filename: string, fallback: T): Promise<T> {
  if (isTauri()) {
    await ensureConfigDir();
    const dir = await getConfigDir();
    const fullPath = `${dir}/${filename}.json`;
    try {
      const raw = await readTextFile(fullPath);
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  const data = readFromLocalStorage(filename);
  return (data ?? fallback) as T;
}

export async function writeConfig(filename: string, data: unknown): Promise<void> {
  if (isTauri()) {
    await ensureConfigDir();
    const dir = await getConfigDir();
    const fullPath = `${dir}/${filename}.json`;
    await writeTextFile(fullPath, JSON.stringify(data, null, 2));
    return;
  }
  writeToLocalStorage(filename, data);
}

export async function deleteConfig(filename: string): Promise<void> {
  if (isTauri()) {
    const dir = await getConfigDir();
    const fullPath = `${dir}/${filename}.json`;
    try {
      const { remove } = await import('../utils/fs');
      await remove(fullPath);
    } catch {
      // ignore
    }
    return;
  }
  localStorage.removeItem(filePath(filename));
}

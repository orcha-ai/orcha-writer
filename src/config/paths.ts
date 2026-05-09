// Get platform-specific config directory path
// In browser mode, use localStorage; in Tauri, use appDataDir

export function getOrchaWriterDir(): string {
  return '~/.orcha-writer';
}

export function getConfigDir(): string {
  return `${getOrchaWriterDir()}/config`;
}

export function getPluginsDir(): string {
  return `${getOrchaWriterDir()}/plugins`;
}

export function getCacheDir(): string {
  return `${getOrchaWriterDir()}/cache`;
}

export function getLogsDir(): string {
  return `${getOrchaWriterDir()}/logs`;
}

export function getTempDir(): string {
  return `${getOrchaWriterDir()}/temp`;
}

export function getStateDir(): string {
  return `${getOrchaWriterDir()}/state`;
}

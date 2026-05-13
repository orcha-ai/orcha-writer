import { isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check as checkNativeUpdate, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getDocumentLanguage, translateText } from '../i18n';

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  available: boolean;
  installMode: 'native' | 'manual';
  message?: string;
}

export interface UpdateInstallProgress {
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export interface UpdateInstallResult extends UpdateCheckResult {
  status: 'up-to-date' | 'installed' | 'manual';
}

const FALLBACK_CURRENT_VERSION = __APP_VERSION__;
const LATEST_RELEASE_API = 'https://api.github.com/repos/orcha-ai/orcha-writer/releases/latest';
const RELEASES_URL = 'https://github.com/orcha-ai/orcha-writer/releases';

function t(value: string, params?: Record<string, string | number>): string {
  return translateText(getDocumentLanguage(), value, params);
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a).split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function getCurrentVersion(): Promise<string> {
  if (isTauri()) {
    try {
      return await getVersion();
    } catch (error) {
      console.warn('[update] Failed to read app version from Tauri metadata:', error);
    }
  }

  return FALLBACK_CURRENT_VERSION;
}

async function checkGithubRelease(currentVersion: string, manualReason?: string): Promise<UpdateCheckResult> {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error(t('检查更新失败：HTTP {status}', { status: response.status }));
  }

  const release = await response.json() as {
    tag_name?: string;
    name?: string;
    html_url?: string;
  };
  const latestVersion = release.tag_name || release.name || currentVersion;
  const releaseUrl = release.html_url || RELEASES_URL;
  const available = compareVersions(latestVersion, currentVersion) > 0;

  return {
    currentVersion,
    latestVersion,
    releaseUrl,
    available,
    installMode: available && manualReason ? 'manual' : 'native',
    message: manualReason,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : t('自动更新失败');
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = await getCurrentVersion();
  let manualReason: string | undefined = isTauri() ? undefined : t('当前环境不支持自动安装。');

  if (isTauri()) {
    try {
      const nativeUpdate = await checkNativeUpdate();
      if (nativeUpdate) {
        return {
          currentVersion: nativeUpdate.currentVersion,
          latestVersion: nativeUpdate.version,
          releaseUrl: RELEASES_URL,
          available: true,
          installMode: 'native',
        };
      }
      manualReason = t('自动安装通道没有返回可安装更新。');
    } catch (error) {
      manualReason = t('自动安装通道不可用：{error}', { error: errorMessage(error) });
    }
  }

  return checkGithubRelease(currentVersion, manualReason);
}

export async function installAvailableUpdate(
  onProgress?: (progress: UpdateInstallProgress) => void,
): Promise<UpdateInstallResult> {
  let manualReason: string | undefined = isTauri() ? undefined : t('当前环境不支持自动安装。');
  let githubResult: UpdateCheckResult;

  if (isTauri()) {
    try {
      const nativeUpdate = await checkNativeUpdate();
      if (nativeUpdate) {
        let downloadedBytes = 0;
        let totalBytes: number | undefined;
        await nativeUpdate.downloadAndInstall((event: DownloadEvent) => {
          if (event.event === 'Started') {
            downloadedBytes = 0;
            totalBytes = event.data.contentLength;
          } else if (event.event === 'Progress') {
            downloadedBytes += event.data.chunkLength;
          } else if (event.event === 'Finished') {
            downloadedBytes = totalBytes ?? downloadedBytes;
          }
          onProgress?.({
            downloadedBytes,
            totalBytes,
            percent: totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : undefined,
          });
        });

        return {
          currentVersion: nativeUpdate.currentVersion,
          latestVersion: nativeUpdate.version,
          releaseUrl: RELEASES_URL,
          available: true,
          installMode: 'native',
          status: 'installed',
        };
      }
      manualReason = t('自动安装通道没有返回可安装更新。');
    } catch (error) {
      manualReason = t('自动安装通道不可用：{error}', { error: errorMessage(error) });
    }
  }

  try {
    githubResult = await checkGithubRelease(await getCurrentVersion(), manualReason);
  } catch (error) {
    if (manualReason) {
      throw new Error(t('{reason}；GitHub Releases 检查也失败：{error}', { reason: manualReason, error: errorMessage(error) }), { cause: error });
    }
    throw error;
  }

  if (!githubResult.available) {
    return {
      ...githubResult,
      status: 'up-to-date',
      message: manualReason,
    };
  }

  return {
    ...githubResult,
    installMode: 'manual',
    status: 'manual',
    message: manualReason || t('当前环境不支持自动安装，可打开发布页手动下载。'),
  };
}

export async function relaunchApplication(): Promise<void> {
  await relaunch();
}

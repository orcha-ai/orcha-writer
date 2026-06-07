import { Modal, Progress, message } from 'antd';
import { open as openPath } from '@tauri-apps/plugin-shell';
import {
  checkForUpdates,
  installAvailableUpdate,
  relaunchApplication,
  type UpdateCheckResult,
  type UpdateInstallProgress,
  type UpdateInstallResult,
} from './update';
import { getDocumentLanguage, translateText } from '../i18n';

type UpdatePromptResult = UpdateCheckResult | UpdateInstallResult;
type UpdateModalHandle = ReturnType<typeof Modal.confirm>;

interface UpdateCheckFlowOptions {
  onInstallStart?: () => void;
}

async function openReleaseUrl(url: string): Promise<void> {
  try {
    await openPath(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function showManualUpdatePrompt(result: UpdatePromptResult, title?: string): void {
  const language = getDocumentLanguage();
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  Modal.confirm({
    title: title || t('发现新版本 {version}', { version: result.latestVersion }),
    content: (
      <div>
        <p>{t('当前版本：{version}', { version: result.currentVersion })}</p>
        <p>{result.message || t('自动安装暂不可用，可打开发布页手动下载。')}</p>
      </div>
    ),
    okText: t('打开发布页'),
    cancelText: t('稍后'),
    onOk: () => openReleaseUrl(result.releaseUrl),
  });
}

function showRelaunchPrompt(result: UpdateInstallResult): void {
  const language = getDocumentLanguage();
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  Modal.confirm({
    title: t('新版本 {version} 已安装', { version: result.latestVersion }),
    content: t('重启应用后即可使用新版本。'),
    okText: t('立即重启'),
    cancelText: t('稍后'),
    onOk: () => relaunchApplication(),
  });
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function installProgressTitle(
  t: (value: string, params?: Record<string, string | number>) => string,
  version?: string,
): string {
  return version ? t('正在安装新版本 {version}', { version }) : t('正在安装更新');
}

function installProgressDescription(
  t: (value: string, params?: Record<string, string | number>) => string,
  progress?: UpdateInstallProgress,
): string {
  if (!progress) return t('准备下载更新...');
  if (progress.totalBytes) {
    return t('已下载 {downloaded} / {total}', {
      downloaded: formatBytes(progress.downloadedBytes),
      total: formatBytes(progress.totalBytes),
    });
  }
  return t('已下载 {downloaded}', { downloaded: formatBytes(progress.downloadedBytes) });
}

function renderInstallProgress(
  t: (value: string, params?: Record<string, string | number>) => string,
  progress?: UpdateInstallProgress,
) {
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0));

  return (
    <div style={{ minWidth: 280 }}>
      <p style={{ marginTop: 0 }}>{t('正在下载并安装更新...')}</p>
      <Progress percent={percent} status={percent >= 100 ? 'success' : 'active'} />
      <p style={{ marginBottom: 0, color: 'var(--text-secondary)' }}>
        {installProgressDescription(t, progress)}
      </p>
    </div>
  );
}

async function installCheckedUpdate(options: {
  modal?: UpdateModalHandle;
  update?: UpdateCheckResult;
  onInstallStart?: () => void;
} = {}): Promise<void> {
  const language = getDocumentLanguage();
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  const updateProgress = (progress?: UpdateInstallProgress) => {
    options.modal?.update({
      title: installProgressTitle(t, options.update?.latestVersion),
      content: renderInstallProgress(t, progress),
      okButtonProps: { loading: true, disabled: true },
      cancelButtonProps: { disabled: true },
    });
  };

  options.onInstallStart?.();
  updateProgress();

  try {
    const installResult = await installAvailableUpdate(updateProgress);
    options.modal?.destroy();
    if (installResult.status === 'installed') {
      showRelaunchPrompt(installResult);
      return;
    }
    if (installResult.status === 'manual') {
      showManualUpdatePrompt(installResult, t('无法自动安装 {version}', { version: installResult.latestVersion }));
      return;
    }
    message.success(t('当前已是最新版本（{version}）', { version: installResult.currentVersion }));
  } catch (error) {
    options.modal?.destroy();
    message.warning(error instanceof Error ? error.message : t('下载安装更新失败'));
  }
}

export async function runUpdateCheckFlow(options: UpdateCheckFlowOptions = {}): Promise<void> {
  const language = getDocumentLanguage();
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  try {
    const result = await checkForUpdates();
    if (!result.available) {
      message.success(t('当前已是最新版本（{version}）', { version: result.currentVersion }));
      return;
    }
    if (result.installMode === 'manual') {
      showManualUpdatePrompt(result);
      return;
    }

    let updatePrompt: UpdateModalHandle | undefined;
    updatePrompt = Modal.confirm({
      title: t('发现新版本 {version}', { version: result.latestVersion }),
      content: t('当前版本：{version}', { version: result.currentVersion }),
      okText: t('下载并安装'),
      cancelText: t('稍后'),
      onOk: () => installCheckedUpdate({
        modal: updatePrompt,
        update: result,
        onInstallStart: options.onInstallStart,
      }),
    });
  } catch (error) {
    message.warning(error instanceof Error ? error.message : t('检查更新失败'));
  }
}

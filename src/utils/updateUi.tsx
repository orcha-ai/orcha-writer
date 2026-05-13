import { Modal, message } from 'antd';
import { open as openPath } from '@tauri-apps/plugin-shell';
import {
  checkForUpdates,
  installAvailableUpdate,
  relaunchApplication,
  type UpdateCheckResult,
  type UpdateInstallResult,
} from './update';
import { getDocumentLanguage, translateText } from '../i18n';

type UpdatePromptResult = UpdateCheckResult | UpdateInstallResult;

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

async function installCheckedUpdate(): Promise<void> {
  const language = getDocumentLanguage();
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  const hide = message.loading(t('正在下载并安装更新...'), 0);
  try {
    const installResult = await installAvailableUpdate();
    hide();
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
    hide();
    message.warning(error instanceof Error ? error.message : t('下载安装更新失败'));
  }
}

export async function runUpdateCheckFlow(): Promise<void> {
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

    Modal.confirm({
      title: t('发现新版本 {version}', { version: result.latestVersion }),
      content: t('当前版本：{version}', { version: result.currentVersion }),
      okText: t('下载并安装'),
      cancelText: t('稍后'),
      onOk: installCheckedUpdate,
    });
  } catch (error) {
    message.warning(error instanceof Error ? error.message : t('检查更新失败'));
  }
}

import { Modal, message } from 'antd';
import { open as openPath } from '@tauri-apps/plugin-shell';
import {
  checkForUpdates,
  installAvailableUpdate,
  relaunchApplication,
  type UpdateCheckResult,
  type UpdateInstallResult,
} from './update';

type UpdatePromptResult = UpdateCheckResult | UpdateInstallResult;

async function openReleaseUrl(url: string): Promise<void> {
  try {
    await openPath(url);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function showManualUpdatePrompt(result: UpdatePromptResult, title = `发现新版本 ${result.latestVersion}`): void {
  Modal.confirm({
    title,
    content: (
      <div>
        <p>当前版本：{result.currentVersion}</p>
        <p>{result.message || '自动安装暂不可用，可打开发布页手动下载。'}</p>
      </div>
    ),
    okText: '打开发布页',
    cancelText: '稍后',
    onOk: () => openReleaseUrl(result.releaseUrl),
  });
}

function showRelaunchPrompt(result: UpdateInstallResult): void {
  Modal.confirm({
    title: `新版本 ${result.latestVersion} 已安装`,
    content: '重启应用后即可使用新版本。',
    okText: '立即重启',
    cancelText: '稍后',
    onOk: () => relaunchApplication(),
  });
}

async function installCheckedUpdate(): Promise<void> {
  const hide = message.loading('正在下载并安装更新...', 0);
  try {
    const installResult = await installAvailableUpdate();
    hide();
    if (installResult.status === 'installed') {
      showRelaunchPrompt(installResult);
      return;
    }
    if (installResult.status === 'manual') {
      showManualUpdatePrompt(installResult, `无法自动安装 ${installResult.latestVersion}`);
      return;
    }
    message.success(`当前已是最新版本（${installResult.currentVersion}）`);
  } catch (error) {
    hide();
    message.warning(error instanceof Error ? error.message : '下载安装更新失败');
  }
}

export async function runUpdateCheckFlow(): Promise<void> {
  try {
    const result = await checkForUpdates();
    if (!result.available) {
      message.success(`当前已是最新版本（${result.currentVersion}）`);
      return;
    }
    if (result.installMode === 'manual') {
      showManualUpdatePrompt(result);
      return;
    }

    Modal.confirm({
      title: `发现新版本 ${result.latestVersion}`,
      content: `当前版本：${result.currentVersion}`,
      okText: '下载并安装',
      cancelText: '稍后',
      onOk: installCheckedUpdate,
    });
  } catch (error) {
    message.warning(error instanceof Error ? error.message : '检查更新失败');
  }
}

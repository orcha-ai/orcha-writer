import { Modal } from 'antd';
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
import type { TabFile } from '../types';
import { translateText } from '../i18n';

export function tabNeedsCloseConfirmation(tab: TabFile): boolean {
  return !tab.preview && (tab.isDraft || !tab.saved);
}

export function tabsNeedingCloseConfirmation(tabs: TabFile[]): TabFile[] {
  return tabs.filter(tabNeedsCloseConfirmation);
}

function formatCloseMessage(tabs: TabFile[], language: unknown): string {
  const t = (value: string, params?: Record<string, string | number>) => (
    translateText(language, value, params)
  );

  if (tabs.length === 1) {
    const tab = tabs[0];
    return tab.isDraft
      ? t('「{name}」还没有保存。关闭后草稿内容会丢失。', { name: tab.name })
      : t('「{name}」有未保存修改。关闭后修改会丢失。', { name: tab.name });
  }

  const visibleNames = tabs.slice(0, 3).map(tab => `「${tab.name}」`).join('、');
  const moreText = tabs.length > 3 ? t(' 等') : '';
  return t('有 {count} 个文档尚未保存：{names}{moreText}。关闭后未保存内容会丢失。', {
    count: tabs.length,
    names: visibleNames,
    moreText,
  });
}

export async function confirmCloseTabs(tabs: TabFile[], language: unknown): Promise<boolean> {
  const unsafeTabs = tabsNeedingCloseConfirmation(tabs);
  if (unsafeTabs.length === 0) return true;

  const content = formatCloseMessage(unsafeTabs, language);
  const t = (value: string) => translateText(language, value);

  try {
    return await confirmDialog(content, {
      title: t('有未保存的文档'),
      kind: 'warning',
      okLabel: t('仍然关闭'),
      cancelLabel: t('取消'),
    });
  } catch {
    return new Promise((resolve) => {
      Modal.confirm({
        title: t('有未保存的文档'),
        content,
        okText: t('仍然关闭'),
        okButtonProps: { danger: true },
        cancelText: t('取消'),
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }
}

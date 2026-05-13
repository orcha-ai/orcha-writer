import { useCallback, useEffect, useMemo, useState } from 'react';
import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { open as openPath } from '@tauri-apps/plugin-shell';
import { Copy, ExternalLink, FileWarning, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { message } from 'antd';
import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { translateText } from '../i18n';

const MIN_IMAGE_SCALE = 0.25;
const MAX_IMAGE_SCALE = 4;
const IMAGE_SCALE_STEP = 0.25;

function clampScale(value: number): number {
  return Math.min(Math.max(value, MIN_IMAGE_SCALE), MAX_IMAGE_SCALE);
}

function localFileSrc(path: string): string {
  return isTauri() ? convertFileSrc(path) : path;
}

export default function FilePreview() {
  const { state } = useApp();
  const language = useSettingsStore(s => s.general.language);
  const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
  const [imageScale, setImageScale] = useState(1);
  const [fitImage, setFitImage] = useState(true);
  const [naturalImageWidth, setNaturalImageWidth] = useState<number | null>(null);
  const t = useCallback((value: string, params?: Record<string, string | number>) => (
    translateText(language, value, params)
  ), [language]);

  const preview = activeTab?.preview;
  const fileSrc = useMemo(() => (
    activeTab?.path ? localFileSrc(activeTab.path) : ''
  ), [activeTab?.path]);

  useEffect(() => {
    setImageScale(1);
    setFitImage(true);
    setNaturalImageWidth(null);
  }, [activeTab?.path]);

  if (!activeTab || !preview) return null;

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(activeTab.path);
      message.success(t('路径已复制'));
    } catch {
      message.error(t('复制路径失败'));
    }
  };

  const openInSystem = () => {
    void openPath(activeTab.path);
  };

  const zoomIn = () => {
    setFitImage(false);
    setImageScale(value => clampScale(value + IMAGE_SCALE_STEP));
  };

  const zoomOut = () => {
    setFitImage(false);
    setImageScale(value => clampScale(value - IMAGE_SCALE_STEP));
  };

  const fitToWindow = () => {
    setFitImage(true);
    setImageScale(1);
  };

  const actualSize = () => {
    setFitImage(false);
    setImageScale(1);
  };

  return (
    <div className="file-preview-panel">
      <div className="file-preview-toolbar">
        <div className="file-preview-title">
          <span>{preview.kind === 'image' ? t('图片预览') : t('PDF 预览')}</span>
          <strong>{activeTab.name}</strong>
        </div>
        <div className="file-preview-actions">
          {preview.kind === 'image' && (
            <>
              <button type="button" onClick={zoomOut} title={t('缩小预览')} aria-label={t('缩小预览')}>
                <ZoomOut size={14} />
              </button>
              <button type="button" onClick={zoomIn} title={t('放大预览')} aria-label={t('放大预览')}>
                <ZoomIn size={14} />
              </button>
              <button type="button" onClick={fitToWindow} title={t('适应窗口')} aria-label={t('适应窗口')}>
                <Maximize2 size={14} />
              </button>
              <button type="button" onClick={actualSize} title={t('实际大小')} aria-label={t('实际大小')}>
                1:1
              </button>
            </>
          )}
          <button type="button" onClick={copyPath} title={t('复制路径')} aria-label={t('复制路径')}>
            <Copy size={14} />
          </button>
          <button type="button" onClick={openInSystem} title={t('在系统中打开')} aria-label={t('在系统中打开')}>
            <ExternalLink size={14} />
          </button>
        </div>
      </div>

      <div className={`file-preview-body file-preview-body-${preview.kind}`}>
        {preview.kind === 'image' ? (
          <div className="file-preview-image-scroll">
            <img
              className={`file-preview-image ${fitImage ? 'is-fit' : 'is-actual'}`}
              src={fileSrc}
              alt={activeTab.name}
              onLoad={(event) => setNaturalImageWidth(event.currentTarget.naturalWidth)}
              style={!fitImage && naturalImageWidth ? { width: `${Math.round(naturalImageWidth * imageScale)}px` } : undefined}
            />
          </div>
        ) : preview.kind === 'pdf' ? (
          <iframe
            className="file-preview-pdf-frame"
            title={activeTab.name}
            src={fileSrc}
          />
        ) : (
          <div className="file-preview-unsupported">
            <FileWarning size={28} />
            <strong>{t('无法预览此文件')}</strong>
            <span>{t('可以尝试使用系统默认应用打开。')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

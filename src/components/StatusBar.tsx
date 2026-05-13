import { useApp } from '../AppContext';
import { Save } from 'lucide-react';
import { useSettingsStore } from '../store';
import { translateText } from '../i18n';

export default function StatusBar() {
  const { state } = useApp();
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);
  const blockStatus = state.viewMode === 'block' ? state.blockSelectionStatus : null;

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <div className={`statusbar-item ${activeTab && !activeTab.saved ? 'unsaved' : 'saved'}`}>
          {activeTab && !activeTab.saved ? (
            <>
              <span>{t('未保存')}</span>
            </>
          ) : activeTab && activeTab.saved ? (
            <>
              <Save size={12} />
              <span>{t('已保存')}</span>
            </>
          ) : (
            <span>{t('就绪')}</span>
          )}
        </div>
        {activeTab?.isDraft && (
          <span>{t('草稿')}</span>
        )}
      </div>

      <div className="statusbar-center">
        {blockStatus ? (
          <div className="statusbar-item statusbar-block-info" title={`${blockStatus.id} · ${blockStatus.summary}`}>
            <span>{t('当前块：{type}', { type: blockStatus.typeLabel })}</span>
            <span>{blockStatus.sourceLabel}</span>
            <span>{t('{count} 字', { count: blockStatus.characterCount })}</span>
          </div>
        ) : state.viewMode === 'block' && activeTab ? (
          <div className="statusbar-item">
            <span>{t('未选中块')}</span>
          </div>
        ) : null}
      </div>

      <div className="statusbar-right">
        <div className="statusbar-item">
          <span>UTF-8</span>
        </div>
        <div className="statusbar-item">
          <span>Markdown</span>
        </div>
        {activeTab && (
          <>
            <div className="statusbar-item">
              <span>{t('行 {line}, 列 {column}', { line: state.cursorPosition.line, column: state.cursorPosition.ch })}</span>
            </div>
            <div className="statusbar-item">
              <span>{t('{count} 字', { count: state.wordCount })}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

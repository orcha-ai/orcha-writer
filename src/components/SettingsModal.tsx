import { useApp } from '../AppContext';
import { X } from 'lucide-react';
import { useSettingsStore } from '../store';
import { translateText } from '../i18n';
import type { ViewMode } from '../types';

export default function SettingsModal() {
  const { state, dispatch } = useApp();
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);

  if (!state.settingsOpen) return null;

  const settings = state.editorSettings;

  const Toggle = ({ on, onChange }: { on: boolean; onChange: () => void }) => (
    <div className={`toggle ${on ? 'on' : ''}`} onClick={onChange} />
  );

  return (
    <div className="modal-overlay" onClick={() => dispatch({ type: 'TOGGLE_SETTINGS' })}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t('设置')}</span>
          <button className="modal-close" onClick={() => dispatch({ type: 'TOGGLE_SETTINGS' })}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          {/* Editor Settings */}
          <div className="settings-section">
            <div className="settings-section-title">{t('编辑器')}</div>
            <div className="settings-row">
              <span className="settings-label">{t('字体大小')}</span>
              <div className="settings-value">
                <input
                  className="settings-input"
                  type="number"
                  min={10}
                  max={24}
                  value={settings.fontSize}
                  onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', payload: { fontSize: Number(e.target.value) } })}
                />
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>px</span>
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-label">{t('行高')}</span>
              <div className="settings-value">
                <input
                  className="settings-input"
                  type="number"
                  min={1}
                  max={3}
                  step={0.1}
                  value={settings.lineHeight}
                  onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', payload: { lineHeight: Number(e.target.value) } })}
                />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-label">{t('显示行号')}</span>
              <Toggle on={settings.showLineNumbers} onChange={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { showLineNumbers: !settings.showLineNumbers } })} />
            </div>
            <div className="settings-row">
              <span className="settings-label">{t('自动换行')}</span>
              <Toggle on={settings.autoWrap} onChange={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { autoWrap: !settings.autoWrap } })} />
            </div>
            <div className="settings-row">
              <span className="settings-label">{t('Tab 宽度')}</span>
              <div className="settings-value">
                <input
                  className="settings-input"
                  type="number"
                  min={2}
                  max={8}
                  value={settings.tabSize}
                  onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', payload: { tabSize: Number(e.target.value) } })}
                />
              </div>
            </div>
          </div>

          {/* Preview Settings */}
          <div className="settings-section">
            <div className="settings-section-title">{t('预览')}</div>
            <div className="settings-row">
              <span className="settings-label">{t('同屏滚动')}</span>
              <Toggle on={settings.syncScroll} onChange={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { syncScroll: !settings.syncScroll } })} />
            </div>
            <div className="settings-row">
              <span className="settings-label">{t('默认视图')}</span>
              <div className="settings-value">
                <select
                  className="settings-input"
                  style={{ width: 'auto' }}
                  value={state.viewMode}
                  onChange={(e) => dispatch({ type: 'SET_VIEW_MODE', payload: e.target.value as ViewMode })}
                >
                  <option value="block">{t('块编辑模式')}</option>
                  <option value="edit">{t('MD 源码模式')}</option>
                  <option value="preview">{t('预览模式')}</option>
                  <option value="split">{t('双栏模式')}</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

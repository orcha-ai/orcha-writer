import { useApp } from '../AppContext';
import { Save } from 'lucide-react';

export default function StatusBar() {
  const { state } = useApp();
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);
  const blockStatus = state.viewMode === 'block' ? state.blockSelectionStatus : null;

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <div className={`statusbar-item ${activeTab && !activeTab.saved ? 'unsaved' : 'saved'}`}>
          {activeTab && !activeTab.saved ? (
            <>
              <span>未保存</span>
            </>
          ) : activeTab && activeTab.saved ? (
            <>
              <Save size={12} />
              <span>已保存</span>
            </>
          ) : (
            <span>就绪</span>
          )}
        </div>
        {activeTab?.isDraft && (
          <span>草稿</span>
        )}
      </div>

      <div className="statusbar-center">
        {blockStatus ? (
          <div className="statusbar-item statusbar-block-info" title={`${blockStatus.id} · ${blockStatus.summary}`}>
            <span>当前块：{blockStatus.typeLabel}</span>
            <span>{blockStatus.sourceLabel}</span>
            <span>{blockStatus.characterCount} 字</span>
          </div>
        ) : state.viewMode === 'block' && activeTab ? (
          <div className="statusbar-item">
            <span>未选中块</span>
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
              <span>行 {state.cursorPosition.line}, 列 {state.cursorPosition.ch}</span>
            </div>
            <div className="statusbar-item">
              <span>{state.wordCount} 字</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

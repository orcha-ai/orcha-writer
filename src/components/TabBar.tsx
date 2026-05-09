import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { X } from 'lucide-react';

export default function TabBar() {
  const { state, dispatch } = useApp();
  const appearance = useSettingsStore(s => s.appearance);

  if (state.tabs.length === 0) return null;
  if (!appearance.showTabs) return null;

  return (
    <div className="tab-bar">
      {state.tabs.map(tab => (
        <div
          key={tab.id}
          className={`tab ${state.activeTabId === tab.id ? 'active' : ''}`}
          onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', payload: tab.id })}
          onAuxClick={(e) => { if (e.button === 1) dispatch({ type: 'CLOSE_TAB', payload: tab.id }); }}
        >
          {!tab.saved && <span className="unsaved-dot" />}
          <span className="tab-name">{tab.name}</span>
          <button
            className="tab-close"
            onClick={(e) => { e.stopPropagation(); dispatch({ type: 'CLOSE_TAB', payload: tab.id }); }}
            title="关闭标签"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

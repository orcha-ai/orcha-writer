import { useEffect, useRef } from 'react';
import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { X } from 'lucide-react';

export default function TabBar() {
  const { state, dispatch } = useApp();
  const appearance = useSettingsStore(s => s.appearance);
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = tabBarRef.current;
    const activeTab = activeTabRef.current;
    if (!container || !activeTab) return;

    const padding = 12;
    const containerLeft = container.scrollLeft;
    const containerRight = containerLeft + container.clientWidth;
    const tabLeft = activeTab.offsetLeft;
    const tabRight = tabLeft + activeTab.offsetWidth;

    if (tabLeft < containerLeft + padding) {
      container.scrollTo({ left: Math.max(tabLeft - padding, 0), behavior: 'smooth' });
    } else if (tabRight > containerRight - padding) {
      container.scrollTo({ left: tabRight - container.clientWidth + padding, behavior: 'smooth' });
    }
  }, [state.activeTabId, state.tabs.length]);

  if (state.tabs.length === 0) return null;
  if (!appearance.showTabs) return null;

  return (
    <div className="tab-bar" ref={tabBarRef}>
      {state.tabs.map(tab => (
        <div
          key={tab.id}
          ref={(element) => {
            if (state.activeTabId === tab.id) activeTabRef.current = element;
          }}
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

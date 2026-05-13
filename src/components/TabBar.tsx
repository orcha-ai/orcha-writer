import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { X } from 'lucide-react';
import { rename } from '../utils/fs';
import { translateText } from '../i18n';

function renamedPath(path: string, nextName: string): string {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex >= 0 ? `${path.slice(0, separatorIndex + 1)}${nextName}` : nextName;
}

export default function TabBar() {
  const { state, dispatch } = useApp();
  const appearance = useSettingsStore(s => s.appearance);
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string) => translateText(language, value);
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const renameInFlightRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

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

  const beginRename = useCallback((tabId: string, currentName: string) => {
    renameInFlightRef.current = false;
    renameCancelledRef.current = false;
    setRenamingTabId(tabId);
    setRenameValue(currentName);
  }, []);

  const cancelRename = useCallback(() => {
    renameInFlightRef.current = false;
    renameCancelledRef.current = true;
    setRenamingTabId(null);
    setRenameValue('');
  }, []);

  const submitRename = useCallback(async () => {
    if (!renamingTabId || renameInFlightRef.current) return;
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      return;
    }

    const tab = state.tabs.find(item => item.id === renamingTabId);
    if (!tab) {
      cancelRename();
      return;
    }

    const nextName = renameValue.trim();
    if (!nextName || nextName === tab.name) {
      cancelRename();
      return;
    }

    if (tab.isDraft || !/[/\\]/.test(tab.path)) {
      dispatch({ type: 'RENAME_TAB_TITLE', payload: { id: tab.id, name: nextName } });
      cancelRename();
      return;
    }

    const newPath = renamedPath(tab.path, nextName);
    renameInFlightRef.current = true;
    try {
      await rename(tab.path, newPath);
      dispatch({ type: 'RENAME_PATH', payload: { oldPath: tab.path, newPath, name: nextName } });
    } catch (error) {
      console.error('Failed to rename tab file:', error);
    } finally {
      renameInFlightRef.current = false;
      setRenamingTabId(null);
      setRenameValue('');
    }
  }, [cancelRename, dispatch, renameValue, renamingTabId, state.tabs]);

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
          {renamingTabId === tab.id ? (
            <input
              className="tab-rename-input"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={() => { void submitRename(); }}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  void submitRename();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelRename();
                }
              }}
              autoFocus
            />
          ) : (
            <span
              className="tab-name"
              onDoubleClick={(event) => {
                event.stopPropagation();
                beginRename(tab.id, tab.name);
              }}
            >
              {tab.name}
            </span>
          )}
          <button
            className="tab-close"
            onClick={(e) => { e.stopPropagation(); dispatch({ type: 'CLOSE_TAB', payload: tab.id }); }}
            title={t('关闭标签')}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

import { useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';

interface Heading {
  level: number;
  text: string;
  id: string;
}

type OutlineItemStyle = CSSProperties & { '--level': number };

export default function Outline() {
  const { state, dispatch } = useApp();
  const updateAppearance = useSettingsStore(s => s.updateAppearance);
  const saveSettings = useSettingsStore(s => s.saveAll);
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);

  const setOutlineVisible = useCallback((visible: boolean) => {
    dispatch({ type: 'SET_OUTLINE_VISIBLE', payload: visible });
    updateAppearance({ showOutline: visible });
    void saveSettings();
  }, [dispatch, saveSettings, updateAppearance]);

  const headings = useMemo<Heading[]>(() => {
    if (!activeTab?.content) return [];
    const lines = activeTab.content.split('\n');
    const result: Heading[] = [];
    for (const line of lines) {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].replace(/[*_`~]/g, '');
        result.push({ level, text, id: text.toLowerCase().replace(/[^\w一-鿿\s-]/g, '').replace(/\s+/g, '-') });
      }
    }
    return result;
  }, [activeTab]);

  if (!state.outlineVisible) {
    return (
      <button
        className="side-panel-toggle outline-panel-toggle"
        onClick={() => setOutlineVisible(true)}
        title="显示大纲"
        aria-label="显示大纲"
      >
        <PanelRightOpen size={14} />
      </button>
    );
  }

  return (
    <div className="outline-panel">
      <div className="outline-header">
        <span className="outline-title">大纲</span>
        <button
          className="panel-collapse-btn"
          onClick={() => setOutlineVisible(false)}
          title="隐藏大纲"
          aria-label="隐藏大纲"
        >
          <PanelRightClose size={14} />
        </button>
      </div>
      <div className="outline-content">
        {headings.length === 0 ? (
          <div style={{ padding: '12px', color: 'var(--text-tertiary)', fontSize: '12px' }}>
            无标题
          </div>
        ) : (
          headings.map((h, i) => (
            <div
              key={i}
              className={`outline-item h${h.level}`}
              style={{ '--level': h.level } as OutlineItemStyle}
              title={h.text}
              onClick={() => {
                const target = document.getElementById(h.id);
                if (target) target.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {h.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

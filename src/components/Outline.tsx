import { useMemo } from 'react';
import { useApp } from '../AppContext';

interface Heading {
  level: number;
  text: string;
  id: string;
}

export default function Outline() {
  const { state } = useApp();
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);

  const headings = useMemo<Heading[]>(() => {
    if (!activeTab) return [];
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
  }, [activeTab?.content]);

  if (!state.outlineVisible) return null;

  return (
    <div className="outline-panel">
      <div className="outline-header">大纲</div>
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
              style={{ '--level': h.level } as any}
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

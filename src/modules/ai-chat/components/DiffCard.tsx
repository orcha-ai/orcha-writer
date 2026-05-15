import type { AIDiffPayload } from '../types';
import { useSettingsStore } from '../../../store';
import { translateText } from '../../../i18n';

export interface DiffCardProps {
  diff: AIDiffPayload;
}

type DiffLineType = 'equal' | 'removed' | 'added' | 'omitted';

interface DiffLineRow {
  id: string;
  type: DiffLineType;
  text: string;
}

interface DiffRows {
  rows: DiffLineRow[];
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
}

const UNCHANGED_CONTEXT_LINES = 2;

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.split('\n');
}

function appendEqualRows(rows: DiffLineRow[], lines: string[], offset: number, t: (value: string, params?: Record<string, string | number>) => string): void {
  const limit = UNCHANGED_CONTEXT_LINES * 2 + 1;
  if (lines.length <= limit) {
    lines.forEach((line, index) => {
      rows.push({ id: `equal-${offset + index}`, type: 'equal', text: line });
    });
    return;
  }

  lines.slice(0, UNCHANGED_CONTEXT_LINES).forEach((line, index) => {
    rows.push({ id: `equal-${offset + index}`, type: 'equal', text: line });
  });
  rows.push({
    id: `omitted-${offset}-${lines.length}`,
    type: 'omitted',
    text: t('已折叠 {count} 行未变化内容', { count: lines.length - UNCHANGED_CONTEXT_LINES * 2 }),
  });
  lines.slice(-UNCHANGED_CONTEXT_LINES).forEach((line, index) => {
    rows.push({
      id: `equal-${offset + lines.length - UNCHANGED_CONTEXT_LINES + index}`,
      type: 'equal',
      text: line,
    });
  });
}

function buildDiffRows(originalText: string, newText: string, t: (value: string, params?: Record<string, string | number>) => string): DiffRows {
  const originalLines = splitLines(originalText);
  const newLines = splitLines(newText);
  let prefix = 0;
  while (
    prefix < originalLines.length &&
    prefix < newLines.length &&
    originalLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < originalLines.length - prefix &&
    suffix < newLines.length - prefix &&
    originalLines[originalLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const rows: DiffLineRow[] = [];
  const removedLines = originalLines.slice(prefix, originalLines.length - suffix);
  const addedLines = newLines.slice(prefix, newLines.length - suffix);

  appendEqualRows(rows, originalLines.slice(0, prefix), 0, t);
  removedLines.forEach((line, index) => {
    rows.push({ id: `removed-${prefix + index}`, type: 'removed', text: line });
  });
  addedLines.forEach((line, index) => {
    rows.push({ id: `added-${prefix + index}`, type: 'added', text: line });
  });
  appendEqualRows(rows, originalLines.slice(originalLines.length - suffix), originalLines.length - suffix, t);

  return {
    rows,
    addedCount: addedLines.length,
    removedCount: removedLines.length,
    unchangedCount: prefix + suffix,
  };
}

export function DiffCard({ diff }: DiffCardProps) {
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  const diffRows = buildDiffRows(diff.originalText, diff.newText, t);

  return (
    <div className="ai-diff-card">
      <div className="ai-diff-summary">
        <span className="ai-diff-stat removed">-{diffRows.removedCount}</span>
        <span className="ai-diff-stat added">+{diffRows.addedCount}</span>
        <span className="ai-diff-stat neutral">{t('{count} 行未变', { count: diffRows.unchangedCount })}</span>
      </div>
      <div className="ai-diff-lines" role="list" aria-label={t('修改建议')}>
        {diffRows.rows.length > 0 ? diffRows.rows.map((row) => (
          <div key={row.id} className={`ai-diff-line ${row.type}`} role="listitem">
            <span className="ai-diff-sign">
              {row.type === 'added' ? '+' : row.type === 'removed' ? '-' : row.type === 'omitted' ? '...' : ' '}
            </span>
            <span className="ai-diff-text">{row.text || ' '}</span>
          </div>
        )) : (
          <div className="ai-diff-line omitted">
            <span className="ai-diff-sign">...</span>
            <span className="ai-diff-text">{t('无选中文本')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

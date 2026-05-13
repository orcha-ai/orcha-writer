import type { AIDiffPayload } from '../types';
import { useSettingsStore } from '../../../store';
import { translateText } from '../../../i18n';

export interface DiffCardProps {
  diff: AIDiffPayload;
}

export function DiffCard({ diff }: DiffCardProps) {
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string) => translateText(language, value);

  return (
    <div className="ai-diff-card">
      <div className="ai-diff-column">
        <div className="ai-diff-title">{t('原文')}</div>
        <pre>{diff.originalText || t('无选中文本')}</pre>
      </div>
      <div className="ai-diff-column changed">
        <div className="ai-diff-title">{t('修改后')}</div>
        <pre>{diff.newText}</pre>
      </div>
    </div>
  );
}

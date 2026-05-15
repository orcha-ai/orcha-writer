import { Button, Tag } from 'antd';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { describeContextSource } from '../services/aiContextBuilder';
import type { AIContextSnapshot } from '../types';
import { useSettingsStore } from '../../../store';
import { translateText } from '../../../i18n';

interface ContextBoxProps {
  context?: AIContextSnapshot;
}

function countLabel(value: number | undefined, language: unknown): string {
  return typeof value === 'number' ? translateText(language, '{count} 字', { count: value }) : '';
}

export function ContextBox({ context }: ContextBoxProps) {
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  const [expanded, setExpanded] = useState(false);

  if (!context) {
    return null;
  }

  return (
    <div className="ai-context-box is-compact">
      <div className="ai-section-row">
        <span className="ai-section-label">{t('上次引用')}</span>
        <Button
          type="text"
          size="small"
          icon={expanded ? <EyeOff size={14} /> : <Eye size={14} />}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('收起') : t('查看')}
        </Button>
      </div>
      <div className="ai-context-tags">
        {context.includedSources.map((source) => (
          <Tag key={source} bordered={false} color={source === 'selected_text' ? 'blue' : 'default'}>
            {describeContextSource(source, language)}
            {source === 'selected_text' ? ` ${countLabel(context.selectedTextLength, language)}` : ''}
            {source === 'current_document' ? ` ${countLabel(context.documentContentLength, language)}` : ''}
          </Tag>
        ))}
      </div>
      {expanded && (
        <div className="ai-context-detail">
          {context.documentTitle && <div>{t('文档：{title}', { title: context.documentTitle })}</div>}
          {context.documentPath && <div>{t('路径：{path}', { path: context.documentPath })}</div>}
          {context.selectedText && <pre>{context.selectedText}</pre>}
          {!context.selectedText && context.documentContent && <pre>{context.documentContent.slice(0, 1200)}</pre>}
        </div>
      )}
    </div>
  );
}

import { Button, Tag } from 'antd';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { describeContextSource } from '../services/aiContextBuilder';
import type { AIContextSnapshot } from '../types';

interface ContextBoxProps {
  context?: AIContextSnapshot;
}

function countLabel(value?: number): string {
  return typeof value === 'number' ? `${value} 字` : '';
}

export function ContextBox({ context }: ContextBoxProps) {
  const [expanded, setExpanded] = useState(false);

  if (!context) {
    return (
      <div className="ai-context-box">
        <div className="ai-section-row">
          <span className="ai-section-label">本次引用上下文</span>
        </div>
        <div className="ai-muted">尚未发送请求</div>
      </div>
    );
  }

  return (
    <div className="ai-context-box">
      <div className="ai-section-row">
        <span className="ai-section-label">本次引用上下文</span>
        <Button
          type="text"
          size="small"
          icon={expanded ? <EyeOff size={14} /> : <Eye size={14} />}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : '查看'}
        </Button>
      </div>
      <div className="ai-context-tags">
        {context.includedSources.map((source) => (
          <Tag key={source} bordered={false} color={source === 'selected_text' ? 'blue' : 'default'}>
            {describeContextSource(source)}
            {source === 'selected_text' ? ` ${countLabel(context.selectedTextLength)}` : ''}
            {source === 'current_document' ? ` ${countLabel(context.documentContentLength)}` : ''}
          </Tag>
        ))}
      </div>
      {expanded && (
        <div className="ai-context-detail">
          {context.documentTitle && <div>文档：{context.documentTitle}</div>}
          {context.documentPath && <div>路径：{context.documentPath}</div>}
          {context.selectedText && <pre>{context.selectedText}</pre>}
          {!context.selectedText && context.documentContent && <pre>{context.documentContent.slice(0, 1200)}</pre>}
        </div>
      )}
    </div>
  );
}

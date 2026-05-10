import type { AIDiffPayload } from '../types';

export interface DiffCardProps {
  diff: AIDiffPayload;
}

export function DiffCard({ diff }: DiffCardProps) {
  return (
    <div className="ai-diff-card">
      <div className="ai-diff-column">
        <div className="ai-diff-title">原文</div>
        <pre>{diff.originalText || '无选中文本'}</pre>
      </div>
      <div className="ai-diff-column changed">
        <div className="ai-diff-title">修改后</div>
        <pre>{diff.newText}</pre>
      </div>
    </div>
  );
}

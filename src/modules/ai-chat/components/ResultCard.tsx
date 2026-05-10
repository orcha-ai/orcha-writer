import { Button, Tooltip } from 'antd';
import { Check, Clipboard, Copy, FilePlus, RotateCcw, SendToBack } from 'lucide-react';
import { DiffCard } from './DiffCard';
import type { AIResultAction, AIResultCard as AIResultCardType } from '../types';

export interface ResultCardProps {
  card: AIResultCardType;
  onAction: (action: AIResultAction, card: AIResultCardType) => void;
}

function iconForAction(type: AIResultAction['type']) {
  switch (type) {
    case 'replace_selection':
      return <Check size={15} />;
    case 'insert_at_cursor':
      return <SendToBack size={15} />;
    case 'append_to_document':
      return <Clipboard size={15} />;
    case 'create_markdown_file':
      return <FilePlus size={15} />;
    case 'regenerate':
      return <RotateCcw size={15} />;
    case 'copy':
    default:
      return <Copy size={15} />;
  }
}

export function ResultCard({ card, onAction }: ResultCardProps) {
  return (
    <div className={`ai-result-card ${card.type}`}>
      <div className="ai-result-head">
        <div className="ai-result-title">{card.title}</div>
        <div className="ai-result-actions">
          {card.actions.slice(0, 4).map((action) => (
            <Tooltip key={action.type} title={action.label}>
              <Button
                type={action.primary ? 'primary' : 'text'}
                size="small"
                shape="circle"
                icon={iconForAction(action.type)}
                aria-label={action.label}
                onClick={() => onAction(action, card)}
              />
            </Tooltip>
          ))}
        </div>
      </div>
      {card.diff ? <DiffCard diff={card.diff} /> : <pre className="ai-result-markdown">{card.markdown || card.content}</pre>}
    </div>
  );
}

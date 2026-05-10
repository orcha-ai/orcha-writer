import { Button, Empty } from 'antd';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AICommandPreset } from '../types';

export interface ShortcutCommandBarProps {
  commands: AICommandPreset[];
  onRunCommand: (commandId: string) => void;
}

export function ShortcutCommandBar({ commands, onRunCommand }: ShortcutCommandBarProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleCommands = useMemo(() => expanded ? commands : commands.slice(0, 3), [commands, expanded]);

  return (
    <div className="ai-shortcut-bar">
      <div className="ai-section-row">
        <span className="ai-section-label">快捷指令</span>
        {commands.length > 3 && (
          <Button
            type="text"
            size="small"
            icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '收起' : '展开'}
          </Button>
        )}
      </div>
      {commands.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前智能体暂无快捷指令" />
      ) : (
        <div className="ai-command-list">
          {visibleCommands.map((command) => (
            <button
              type="button"
              key={command.id}
              className="ai-command-chip"
              onClick={() => onRunCommand(command.id)}
              title={command.description || command.name}
            >
              <span>{command.iconText || 'AI'}</span>
              {command.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

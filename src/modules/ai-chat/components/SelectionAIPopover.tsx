import { Button, Input } from 'antd';
import { Send, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AICommandPreset } from '../types';

export interface SelectionAIPopoverProps {
  visible: boolean;
  selectionText: string;
  position: { x: number; y: number };
  commands: AICommandPreset[];
  onRunCommand: (commandId: string) => void;
  onSubmitCustomPrompt: (prompt: string) => void;
}

function slashQuery(input: string): string | null {
  const value = input.trimStart();
  if (!value.startsWith('/')) return null;
  return value.slice(1).trim().toLowerCase();
}

function isPrimaryShortcut(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return navigator.platform.toUpperCase().includes('MAC') ? event.metaKey : event.ctrlKey;
}

export function SelectionAIPopover({
  visible,
  selectionText,
  position,
  commands,
  onRunCommand,
  onSubmitCustomPrompt,
}: SelectionAIPopoverProps) {
  const [customPrompt, setCustomPrompt] = useState('');
  const [highlightedCommandId, setHighlightedCommandId] = useState<string | null>(null);
  const query = slashQuery(customPrompt);
  const commandMenuOpen = visible && query !== null;
  const filteredCommands = useMemo(() => {
    if (query === null) return [];
    const keyword = query.trim();
    const matched = keyword
      ? commands.filter((command) => [
          command.name,
          command.code,
          command.description || '',
        ].some((part) => part.toLowerCase().includes(keyword)))
      : commands;
    return matched.slice(0, 8);
  }, [commands, query]);

  useEffect(() => {
    setHighlightedCommandId(filteredCommands[0]?.id || null);
  }, [filteredCommands]);

  if (!visible) return null;

  const submit = () => {
    const value = customPrompt.trim();
    if (!value) return;
    onSubmitCustomPrompt(value);
    setCustomPrompt('');
  };

  const runCommand = (commandId: string) => {
    onRunCommand(commandId);
    setCustomPrompt('');
  };

  return (
    <div
      className="ai-selection-popover"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('input, textarea')) return;
        event.preventDefault();
      }}
    >
      <div className="ai-selection-head">
        <Sparkles size={14} />
        <span>{selectionText.length} 字</span>
      </div>
      <div className="ai-selection-input-wrap">
        <Input.TextArea
          value={customPrompt}
          placeholder="输入 / 调用快捷指令，或写自定义要求"
          autoSize={{ minRows: 2, maxRows: 6 }}
          onChange={(event) => setCustomPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (commandMenuOpen && filteredCommands.length > 0) {
              const currentIndex = Math.max(0, filteredCommands.findIndex((command) => command.id === highlightedCommandId));
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                const next = filteredCommands[(currentIndex + 1) % filteredCommands.length];
                setHighlightedCommandId(next.id);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                const next = filteredCommands[(currentIndex - 1 + filteredCommands.length) % filteredCommands.length];
                setHighlightedCommandId(next.id);
                return;
              }
              if (event.key === 'Enter' && highlightedCommandId) {
                event.preventDefault();
                runCommand(highlightedCommandId);
                return;
              }
            }
            if (commandMenuOpen && event.key === 'Escape') {
              event.preventDefault();
              setCustomPrompt('');
              return;
            }
            if (event.key === 'Enter' && isPrimaryShortcut(event)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Button
          className="ai-selection-send"
          type="primary"
          size="small"
          icon={<Send size={13} />}
          disabled={!customPrompt.trim()}
          onClick={submit}
        />
        {commandMenuOpen && (
          <div className="ai-slash-command-popover ai-selection-command-popover">
            {filteredCommands.length === 0 ? (
              <div className="ai-slash-command-empty">没有匹配的指令</div>
            ) : filteredCommands.map((command) => (
              <button
                key={command.id}
                type="button"
                className={`ai-slash-command-item${command.id === highlightedCommandId ? ' active' : ''}`}
                onMouseEnter={() => setHighlightedCommandId(command.id)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  runCommand(command.id);
                }}
              >
                <span className="ai-slash-command-icon">{command.iconText || '/'}</span>
                <span className="ai-slash-command-main">
                  <span className="ai-slash-command-name">{command.name}</span>
                  {command.description && <span className="ai-slash-command-desc">{command.description}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

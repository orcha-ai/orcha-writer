import { Button, Dropdown, Input, Switch, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { Bot, Brain, ChevronDown, Send, Settings } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AIAgentConfig, AICommandPreset } from '../types';

interface AIInputBoxProps {
  disabled?: boolean;
  sending?: boolean;
  onSend: (value: string) => void;
  modelLabel?: string;
  agents: AIAgentConfig[];
  currentAgent: AIAgentConfig;
  onChangeAgent: (agentId: string) => void;
  onOpenAgentManager?: () => void;
  commands: AICommandPreset[];
  onRunCommand: (commandId: string) => void;
  thinkingAvailable?: boolean;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  onChangeThinking?: (enabled: boolean) => void;
}

const MANAGE_AGENTS_KEY = '__manage_agents';

function slashQuery(input: string): string | null {
  const value = input.trimStart();
  if (!value.startsWith('/')) return null;
  return value.slice(1).trim().toLowerCase();
}

export function AIInputBox({
  disabled,
  sending,
  onSend,
  modelLabel,
  agents,
  currentAgent,
  onChangeAgent,
  onOpenAgentManager,
  commands,
  onRunCommand,
  thinkingAvailable,
  thinkingEnabled,
  thinkingBudget,
  onChangeThinking,
}: AIInputBoxProps) {
  const [value, setValue] = useState('');
  const [highlightedCommandId, setHighlightedCommandId] = useState<string | null>(null);
  const query = slashQuery(value);
  const commandMenuOpen = query !== null && !disabled && !sending;
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

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  const runCommand = (commandId: string) => {
    onRunCommand(commandId);
    setValue('');
  };

  useEffect(() => {
    setHighlightedCommandId(filteredCommands[0]?.id || null);
  }, [filteredCommands]);

  const agentItems: MenuProps['items'] = [
    ...agents.map((agent) => ({
      key: agent.id,
      disabled: !agent.enabled,
      label: (
        <span className="ai-agent-menu-item">
          <span className="ai-agent-icon compact">{agent.iconText || 'AI'}</span>
          <span className="ai-agent-menu-main">
            <span className="ai-agent-name">{agent.name}</span>
            {agent.description && <span className="ai-agent-desc">{agent.description}</span>}
          </span>
        </span>
      ),
    })),
    { type: 'divider' },
    {
      key: MANAGE_AGENTS_KEY,
      label: (
        <span className="ai-agent-manage-item">
          <Settings size={14} />
          管理智能体
        </span>
      ),
    },
  ];

  const onAgentMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === MANAGE_AGENTS_KEY) {
      onOpenAgentManager?.();
      return;
    }
    onChangeAgent(String(key));
  };

  return (
    <div className="ai-input-box">
      <Input.TextArea
        value={value}
        placeholder="问 AI，输入 / 调用快捷指令..."
        autoSize={{ minRows: 2, maxRows: 5 }}
        disabled={disabled || sending}
        onChange={(event) => setValue(event.target.value)}
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
            if (event.key === 'Enter' && !event.shiftKey && highlightedCommandId) {
              event.preventDefault();
              runCommand(highlightedCommandId);
              return;
            }
          }
          if (commandMenuOpen && event.key === 'Escape') {
            event.preventDefault();
            setValue('');
            return;
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {commandMenuOpen && (
        <div className="ai-slash-command-popover">
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
      <div className="ai-input-footer">
        <div className="ai-input-picker">
          <Dropdown menu={{ items: agentItems, onClick: onAgentMenuClick }} trigger={['click']} disabled={disabled || sending}>
            <Button type="text" size="small" className="ai-input-agent-button">
              <span className="ai-agent-icon compact">{currentAgent.iconText || <Bot size={14} />}</span>
              <span className="ai-input-agent-name">{currentAgent.name}</span>
              <ChevronDown size={13} />
            </Button>
          </Dropdown>
          <span className="ai-input-model-caption">{modelLabel || '模型未配置'}</span>
        </div>
        <Tooltip
          title={
            thinkingAvailable
              ? thinkingBudget
                ? `开启后，本次请求会启用深度思考，预算 ${thinkingBudget} tokens`
                : '开启后，本次请求会启用深度思考'
              : '当前模型配置未启用深度思考支持'
          }
        >
          <span className={`ai-thinking-toggle${thinkingEnabled ? ' active' : ''}${thinkingAvailable ? '' : ' disabled'}`}>
            <Brain size={13} />
            深度思考
            <Switch
              size="small"
              checked={Boolean(thinkingEnabled)}
              disabled={disabled || sending || !thinkingAvailable}
              onChange={(checked) => onChangeThinking?.(checked)}
            />
          </span>
        </Tooltip>
        <Button type="primary" size="small" icon={<Send size={15} />} loading={sending} disabled={disabled} onClick={submit}>
          发送
        </Button>
      </div>
    </div>
  );
}

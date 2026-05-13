import { Button, Tag, Tooltip } from 'antd';
import { Settings } from 'lucide-react';
import type { AIAgentConfig } from '../types';
import { useSettingsStore } from '../../../store';
import { translateText } from '../../../i18n';

export interface AgentSelectorProps {
  agents: AIAgentConfig[];
  currentAgentId: string;
  onChangeAgent: (agentId: string) => void;
  onOpenAgentManager: () => void;
}

export function AgentSelector({ agents, currentAgentId, onChangeAgent, onOpenAgentManager }: AgentSelectorProps) {
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string) => translateText(language, value);

  return (
    <div className="ai-agent-selector">
      <div className="ai-section-row">
        <span className="ai-section-label">{t('智能体')}</span>
        <Button type="text" size="small" icon={<Settings size={14} />} onClick={onOpenAgentManager}>
          {t('管理')}
        </Button>
      </div>
      <div className="ai-agent-grid">
        {agents.map((agent) => {
          const active = agent.id === currentAgentId;
          return (
            <Tooltip key={agent.id} title={agent.description || agent.name}>
              <button
                type="button"
                className={`ai-agent-card${active ? ' active' : ''}`}
                disabled={!agent.enabled}
                onClick={() => onChangeAgent(agent.id)}
              >
                <span className="ai-agent-icon">{agent.iconText || 'AI'}</span>
                <span className="ai-agent-main">
                  <span className="ai-agent-name">{agent.name}</span>
                  <span className="ai-agent-desc">{agent.description || t('自定义智能体')}</span>
                </span>
                {!agent.enabled && <Tag bordered={false}>{t('停用')}</Tag>}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

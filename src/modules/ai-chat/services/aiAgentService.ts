import type { AgentConfig } from '../../../types';
import { BUILTIN_AI_AGENTS, DEFAULT_AGENT_ID } from '../constants/builtinAgents';
import type { AIAgentConfig } from '../types';

const CAPABILITY_COMMANDS: Record<string, string[]> = {
  rewrite: ['polish_selection', 'expand_selection', 'block_polish', 'block_expand', 'block_shorten', 'block_generate_next'],
  summarize: ['summarize_document', 'extract_todos'],
  translate: ['translate_to_zh', 'translate_to_en'],
  outline: ['generate_readme'],
  markdown_format: ['fix_heading_level', 'block_convert_to_list', 'convert_to_md_table'],
};

function commandIdsForCustomAgent(agent: AgentConfig): string[] {
  const commandIds = agent.capabilities
    .filter((capability) => capability.enabled)
    .flatMap((capability) => CAPABILITY_COMMANDS[capability.code] || []);
  return Array.from(new Set(commandIds.length > 0 ? commandIds : ['polish_selection', 'summarize_document']));
}

export function normalizeAIAgents(customAgents: AgentConfig[]): AIAgentConfig[] {
  return customAgents.map((agent, index): AIAgentConfig => ({
    id: agent.id,
    code: agent.id,
    name: agent.name,
    description: agent.description,
    iconText: agent.icon || 'AI',
    enabled: agent.enabled,
    builtin: false,
    sortOrder: 100 + index,
    modelConfigId: agent.modelConfigId,
    systemPrompt: agent.systemPrompt,
    commandIds: commandIdsForCustomAgent(agent),
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  })).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function findUsableAgent(agents: AIAgentConfig[], preferredAgentId?: string): AIAgentConfig {
  return (
    agents.find((agent) => agent.id === preferredAgentId && agent.enabled) ||
    agents.find((agent) => agent.id === DEFAULT_AGENT_ID && agent.enabled) ||
    agents.find((agent) => agent.enabled) ||
    BUILTIN_AI_AGENTS[0]
  );
}

import { BUILTIN_AI_COMMANDS } from '../constants/builtinCommands';
import type { AIAgentConfig, AICommandPreset } from '../types';

export function getAllAICommands(): AICommandPreset[] {
  return [...BUILTIN_AI_COMMANDS].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getAvailableCommands(agentId: string, allCommands: AICommandPreset[] = BUILTIN_AI_COMMANDS): AICommandPreset[] {
  return allCommands
    .filter((command) => command.enabled && command.agentIds.includes(agentId))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getAgentCommands(agent: AIAgentConfig, allCommands: AICommandPreset[] = BUILTIN_AI_COMMANDS): AICommandPreset[] {
  return allCommands
    .filter((command) => command.enabled && agent.commandIds.includes(command.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function findCommand(commandId: string, allCommands: AICommandPreset[] = BUILTIN_AI_COMMANDS): AICommandPreset | undefined {
  return allCommands.find((command) => command.id === commandId);
}

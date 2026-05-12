import { create } from 'zustand';
import type { AiProviderConfig, AiModelConfig, AgentConfig } from '../types';
import { readConfig, writeConfig } from '../config';
import { BUILTIN_AI_AGENTS } from '../modules/ai-chat/constants/builtinAgents';

interface AiState {
  providers: AiProviderConfig[];
  models: AiModelConfig[];
  agents: AgentConfig[];

  // Provider
  addProvider: (provider: Omit<AiProviderConfig, 'id'>) => Promise<void>;
  updateProvider: (id: string, partial: Partial<AiProviderConfig>) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  toggleProvider: (id: string) => Promise<void>;

  // Model
  addModel: (model: Omit<AiModelConfig, 'id'>) => Promise<void>;
  updateModel: (id: string, partial: Partial<AiModelConfig>) => Promise<void>;
  removeModel: (id: string) => Promise<void>;
  toggleModel: (id: string) => Promise<void>;

  // Agent
  addAgent: (agent: Omit<AgentConfig, 'id'>) => Promise<void>;
  updateAgent: (id: string, partial: Partial<AgentConfig>) => Promise<void>;
  removeAgent: (id: string) => Promise<void>;
  toggleAgent: (id: string) => Promise<void>;

  // Persistence
  load: () => Promise<void>;
  save: () => Promise<void>;
}

const defaultProviders: AiProviderConfig[] = [];

interface AiConfigSnapshot {
  providers: AiProviderConfig[];
  models: AiModelConfig[];
  agents: AgentConfig[];
}

let saveQueue: Promise<void> = Promise.resolve();

async function writeAiConfigSnapshot(snapshot: AiConfigSnapshot): Promise<void> {
  await writeConfig('ai-providers', snapshot.providers);
  await writeConfig('ai-models', snapshot.models);
  await writeConfig('agents', snapshot.agents);
}

function queueAiConfigSave(readSnapshot: () => AiConfigSnapshot): Promise<void> {
  const nextSave = saveQueue
    .catch(() => undefined)
    .then(() => writeAiConfigSnapshot(readSnapshot()));
  saveQueue = nextSave;
  return nextSave;
}

const DEFAULT_PROVIDER_IDS = new Set(['openai', 'anthropic', 'qwen']);

const DEFAULT_PROVIDER_URLS: Record<string, string[]> = {
  openai: ['https://api.openai.com/v1', 'https://api.openai.com/v1/chat/completions'],
  anthropic: ['https://api.anthropic.com', 'https://api.anthropic.com/v1/messages'],
  qwen: [
    'https://coding.dashscope.aliyuncs.com/v1',
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  ],
};

const REQUEST_URL_MIGRATIONS: Record<string, string> = {
  'https://api.openai.com/v1': 'https://api.openai.com/v1/chat/completions',
  'https://api.anthropic.com': 'https://api.anthropic.com/v1/messages',
  'https://coding.dashscope.aliyuncs.com/v1': 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  'https://dashscope.aliyuncs.com/compatible-mode/v1': 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
};

function normalizeThinkingBudget(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

function normalizeModels(models: AiModelConfig[]): { models: AiModelConfig[]; changed: boolean } {
  let changed = false;
  const normalized = models.map((model) => {
    const thinkingSupported = model.thinkingSupported ?? Boolean(model.thinkingEnabled);
    const thinkingEnabled = thinkingSupported ? Boolean(model.thinkingEnabled) : false;
    const thinkingBudget = thinkingSupported ? normalizeThinkingBudget(model.thinkingBudget) : undefined;
    const next = { ...model, thinkingSupported, thinkingEnabled, thinkingBudget };

    if (
      next.thinkingSupported !== model.thinkingSupported ||
      next.thinkingEnabled !== model.thinkingEnabled ||
      next.thinkingBudget !== model.thinkingBudget
    ) {
      changed = true;
    }

    return next;
  });

  return { models: normalized, changed };
}

function normalizeProviders(
  providers: AiProviderConfig[],
  models: AiModelConfig[],
): { providers: AiProviderConfig[]; changed: boolean } {
  let changed = false;
  const normalized = providers
    .map((provider) => {
      const migratedUrl = REQUEST_URL_MIGRATIONS[provider.baseUrl];
      if (migratedUrl) {
        changed = true;
        return { ...provider, baseUrl: migratedUrl };
      }
      return provider;
    })
    .filter((provider) => {
      const hasCredential = Boolean(provider.credentialRef?.trim());
      const hasModel = models.some((model) => model.providerId === provider.id);
      const looksLikeDefault = DEFAULT_PROVIDER_IDS.has(provider.id) &&
        (DEFAULT_PROVIDER_URLS[provider.id] || []).includes(provider.baseUrl);

      if (looksLikeDefault && !hasCredential && !hasModel) {
        changed = true;
        return false;
      }
      return true;
    });

  return { providers: normalized, changed };
}

function capabilitiesForBuiltinAgent(agentId: string) {
  const enabledCodesByAgent: Record<string, string[]> = {
    writing_assistant: ['rewrite', 'summarize'],
    tech_doc_assistant: ['summarize', 'outline'],
    translator_assistant: ['translate'],
    markdown_format_assistant: ['markdown_format'],
  };
  const enabledCodes = new Set(enabledCodesByAgent[agentId] || ['rewrite']);
  return [
    { code: 'rewrite', name: '改写润色', enabled: enabledCodes.has('rewrite') },
    { code: 'summarize', name: '摘要提炼', enabled: enabledCodes.has('summarize') },
    { code: 'translate', name: '翻译', enabled: enabledCodes.has('translate') },
    { code: 'outline', name: '大纲生成', enabled: enabledCodes.has('outline') },
    { code: 'markdown_format', name: 'Markdown 格式', enabled: enabledCodes.has('markdown_format') },
  ];
}

function editableAgentFromBuiltin(agent: typeof BUILTIN_AI_AGENTS[number], modelConfigId: string): AgentConfig {
  return {
    id: agent.id,
    name: agent.name,
    icon: agent.iconText,
    description: agent.description,
    modelConfigId,
    systemPrompt: agent.systemPrompt,
    enabled: agent.enabled,
    capabilities: capabilitiesForBuiltinAgent(agent.id),
    accessScope: 'current-document',
  };
}

function seedBuiltinAgents(
  agents: AgentConfig[],
  models: AiModelConfig[],
): { agents: AgentConfig[]; changed: boolean } {
  const existingIds = new Set(agents.map((agent) => agent.id));
  const fallbackModelId = models.find((model) => model.enabled)?.id || models[0]?.id || '';
  const missingAgents = BUILTIN_AI_AGENTS
    .filter((agent) => !existingIds.has(agent.id))
    .map((agent) => editableAgentFromBuiltin(agent, fallbackModelId));

  if (missingAgents.length === 0) {
    return { agents, changed: false };
  }

  return {
    agents: [...missingAgents, ...agents],
    changed: true,
  };
}

function normalizeAgents(
  agents: AgentConfig[],
  models: AiModelConfig[],
): { agents: AgentConfig[]; changed: boolean } {
  let changed = false;
  const modelIds = new Set(models.map((model) => model.id));
  const normalized = agents.map((agent) => {
    if (agent.modelConfigId && !modelIds.has(agent.modelConfigId)) {
      changed = true;
      return { ...agent, modelConfigId: '' };
    }
    return agent;
  });

  return { agents: normalized, changed };
}

export const useAiStore = create<AiState>((set, get) => ({
  providers: [],
  models: [],
  agents: [],

  addProvider: (provider) => {
    set((s) => ({
      providers: [...s.providers, { ...provider, id: `provider-${Date.now()}` }],
    }));
    return get().save();
  },
  updateProvider: (id, partial) => {
    set((s) => ({
      providers: s.providers.map((p) => p.id === id ? { ...p, ...partial } : p),
    }));
    return get().save();
  },
  removeProvider: (id) => {
    set((s) => ({
      providers: s.providers.filter((p) => p.id !== id),
      models: s.models.filter((m) => m.providerId !== id),
      agents: s.agents.filter((agent) => !s.models.some((m) => m.providerId === id && m.id === agent.modelConfigId)),
    }));
    return get().save();
  },
  toggleProvider: (id) => {
    set((s) => ({
      providers: s.providers.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p),
    }));
    return get().save();
  },

  addModel: (model) => {
    set((s) => ({
      models: [...s.models, { ...model, id: `model-${Date.now()}`, enabled: model.enabled ?? true }],
    }));
    return get().save();
  },
  updateModel: (id, partial) => {
    set((s) => ({
      models: s.models.map((m) => m.id === id ? { ...m, ...partial } : m),
    }));
    return get().save();
  },
  removeModel: (id) => {
    set((s) => ({
      models: s.models.filter((m) => m.id !== id),
      agents: s.agents.filter((a) => a.modelConfigId !== id),
    }));
    return get().save();
  },
  toggleModel: (id) => {
    set((s) => ({
      models: s.models.map((m) => m.id === id ? { ...m, enabled: !m.enabled } : m),
    }));
    return get().save();
  },

  addAgent: (agent) => {
    set((s) => ({
      agents: [...s.agents, { ...agent, id: `agent-${Date.now()}`, enabled: agent.enabled ?? true, capabilities: agent.capabilities || [] }],
    }));
    return get().save();
  },
  updateAgent: (id, partial) => {
    set((s) => ({
      agents: s.agents.map((a) => a.id === id ? { ...a, ...partial } : a),
    }));
    return get().save();
  },
  removeAgent: (id) => {
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== id),
    }));
    return get().save();
  },
  toggleAgent: (id) => {
    set((s) => ({
      agents: s.agents.map((a) => a.id === id ? { ...a, enabled: !a.enabled } : a),
    }));
    return get().save();
  },

  load: async () => {
    const rawProviders = await readConfig<AiProviderConfig[]>('ai-providers', defaultProviders);
    const rawModels = await readConfig<AiModelConfig[]>('ai-models', []);
    const rawAgents = await readConfig<AgentConfig[]>('agents', []);
    const agentsSeeded = await readConfig<boolean>('ai-agents-seeded', false);
    const { models, changed: modelsChanged } = normalizeModels(rawModels);
    const { providers, changed: providersChanged } = normalizeProviders(rawProviders, models);
    const seeded = agentsSeeded
      ? { agents: rawAgents, changed: false }
      : seedBuiltinAgents(rawAgents, models);
    const { agents, changed: agentsChanged } = normalizeAgents(seeded.agents, models);
    set({ providers, models, agents });
    if (providersChanged) {
      await writeConfig('ai-providers', providers);
    }
    if (modelsChanged) {
      await writeConfig('ai-models', models);
    }
    if (!agentsSeeded || seeded.changed || agentsChanged) {
      await writeConfig('agents', agents);
      await writeConfig('ai-agents-seeded', true);
    }
  },
  save: async () => {
    await queueAiConfigSave(() => {
      const s = get();
      return {
        providers: s.providers,
        models: s.models,
        agents: s.agents,
      };
    });
  },
}));

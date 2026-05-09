import { create } from 'zustand';
import type { AiProviderConfig, AiModelConfig, AgentConfig } from '../types';
import { readConfig, writeConfig } from '../config';

interface AiState {
  providers: AiProviderConfig[];
  models: AiModelConfig[];
  agents: AgentConfig[];

  // Provider
  addProvider: (provider: Omit<AiProviderConfig, 'id'>) => void;
  updateProvider: (id: string, partial: Partial<AiProviderConfig>) => void;
  removeProvider: (id: string) => void;
  toggleProvider: (id: string) => void;

  // Model
  addModel: (model: Omit<AiModelConfig, 'id'>) => void;
  updateModel: (id: string, partial: Partial<AiModelConfig>) => void;
  removeModel: (id: string) => void;
  toggleModel: (id: string) => void;

  // Agent
  addAgent: (agent: Omit<AgentConfig, 'id'>) => void;
  updateAgent: (id: string, partial: Partial<AgentConfig>) => void;
  removeAgent: (id: string) => void;
  toggleAgent: (id: string) => void;

  // Persistence
  load: () => Promise<void>;
  save: () => Promise<void>;
}

const defaultProviders: AiProviderConfig[] = [
  { id: 'openai', name: 'OpenAI', type: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', enabled: true },
  { id: 'anthropic', name: 'Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com', enabled: true },
  { id: 'qwen', name: 'Qwen', type: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', enabled: true },
];

export const useAiStore = create<AiState>((set, get) => ({
  providers: defaultProviders,
  models: [],
  agents: [],

  addProvider: (provider) => {
    set((s) => ({
      providers: [...s.providers, { ...provider, id: `provider-${Date.now()}` }],
    }));
    void get().save();
  },
  updateProvider: (id, partial) => {
    set((s) => ({
      providers: s.providers.map((p) => p.id === id ? { ...p, ...partial } : p),
    }));
    void get().save();
  },
  removeProvider: (id) => {
    set((s) => ({
      providers: s.providers.filter((p) => p.id !== id),
      models: s.models.filter((m) => m.providerId !== id),
      agents: s.agents.filter((agent) => !s.models.some((m) => m.providerId === id && m.id === agent.modelConfigId)),
    }));
    void get().save();
  },
  toggleProvider: (id) => {
    set((s) => ({
      providers: s.providers.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p),
    }));
    void get().save();
  },

  addModel: (model) => {
    set((s) => ({
      models: [...s.models, { ...model, id: `model-${Date.now()}`, enabled: model.enabled ?? true }],
    }));
    void get().save();
  },
  updateModel: (id, partial) => {
    set((s) => ({
      models: s.models.map((m) => m.id === id ? { ...m, ...partial } : m),
    }));
    void get().save();
  },
  removeModel: (id) => {
    set((s) => ({
      models: s.models.filter((m) => m.id !== id),
      agents: s.agents.filter((a) => a.modelConfigId !== id),
    }));
    void get().save();
  },
  toggleModel: (id) => {
    set((s) => ({
      models: s.models.map((m) => m.id === id ? { ...m, enabled: !m.enabled } : m),
    }));
    void get().save();
  },

  addAgent: (agent) => {
    set((s) => ({
      agents: [...s.agents, { ...agent, id: `agent-${Date.now()}`, enabled: agent.enabled ?? true, capabilities: agent.capabilities || [] }],
    }));
    void get().save();
  },
  updateAgent: (id, partial) => {
    set((s) => ({
      agents: s.agents.map((a) => a.id === id ? { ...a, ...partial } : a),
    }));
    void get().save();
  },
  removeAgent: (id) => {
    set((s) => ({
      agents: s.agents.filter((a) => a.id !== id),
    }));
    void get().save();
  },
  toggleAgent: (id) => {
    set((s) => ({
      agents: s.agents.map((a) => a.id === id ? { ...a, enabled: !a.enabled } : a),
    }));
    void get().save();
  },

  load: async () => {
    const providers = await readConfig<AiProviderConfig[]>('ai-providers', defaultProviders);
    const models = await readConfig<AiModelConfig[]>('ai-models', []);
    const agents = await readConfig<AgentConfig[]>('agents', []);
    set({ providers, models, agents });
  },
  save: async () => {
    const s = get();
    await writeConfig('ai-providers', s.providers);
    await writeConfig('ai-models', s.models);
    await writeConfig('agents', s.agents);
  },
}));

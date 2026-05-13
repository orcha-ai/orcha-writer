import { create } from 'zustand';
import type { PluginSource, PluginManifest, PluginInstalled } from '../types';
import { readConfig, writeConfig } from '../config';
import { getDocumentLanguage, translateText } from '../i18n';

interface PluginState {
  sources: PluginSource[];
  installed: PluginInstalled[];
  registry: PluginManifest[];
  loading: boolean;
  error: string | null;

  // Source management
  addSource: (source: Omit<PluginSource, 'id' | 'lastSyncAt'>) => void;
  updateSource: (id: string, partial: Partial<PluginSource>) => void;
  removeSource: (id: string) => void;
  toggleSource: (id: string) => void;
  syncSource: (id: string) => Promise<void>;

  // Plugin management
  installPlugin: (manifest: PluginManifest) => Promise<void>;
  uninstallPlugin: (id: string) => void;
  togglePlugin: (id: string) => void;

  // Registry
  fetchRegistry: () => Promise<void>;

  // Persistence
  load: () => Promise<void>;
  save: () => Promise<void>;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  sources: [
    { id: 'official', name: translateText(getDocumentLanguage(), '官方插件源'), type: 'official-registry', url: 'https://raw.githubusercontent.com/orcha-writer/plugin-registry/main/registry.json', enabled: true, official: true },
  ],
  installed: [],
  registry: [],
  loading: false,
  error: null,

  addSource: (source) => {
    set((s) => ({
      sources: [...s.sources, { ...source, id: `source-${Date.now()}` }],
    }));
    void get().save();
  },
  updateSource: (id, partial) => {
    set((s) => ({
      sources: s.sources.map((src) => src.id === id ? { ...src, ...partial } : src),
    }));
    void get().save();
  },
  removeSource: (id) => {
    set((s) => ({
      sources: s.sources.filter((src) => src.id !== id),
    }));
    void get().save();
  },
  toggleSource: (id) => {
    set((s) => ({
      sources: s.sources.map((src) => src.id === id ? { ...src, enabled: !src.enabled } : src),
    }));
    void get().save();
  },
  syncSource: async (id) => {
    const source = get().sources.find((s) => s.id === id);
    if (!source) return;
    set({ loading: true });
    try {
      const res = await fetch(source.url);
      const data = await res.json();
      if (data.plugins) {
        const manifests: PluginManifest[] = [];
        for (const plugin of data.plugins) {
          if (plugin.manifestUrl) {
            try {
              const mr = await fetch(plugin.manifestUrl);
              manifests.push(await mr.json());
            } catch { /* skip */ }
          }
        }
        set((s) => ({
          registry: [...s.registry.filter((m) => !manifests.find((n) => n.id === m.id)), ...manifests],
          sources: s.sources.map((src) => src.id === id ? { ...src, lastSyncAt: new Date().toISOString() } : src),
        }));
        await get().save();
      }
    } catch (e) {
      const error = translateText(getDocumentLanguage(), '同步失败: {error}', { error: (e as Error).message });
      set({ error });
      throw new Error(error, { cause: e });
    } finally {
      set({ loading: false });
    }
  },

  installPlugin: async (manifest) => {
    set({ loading: true });
    // In a real implementation, this would download the plugin package
    // For now, we just register it
    set((s) => ({
      installed: s.installed.some((plugin) => plugin.id === manifest.id) ? s.installed : [...s.installed, {
        id: manifest.id,
        manifest,
        installedAt: new Date().toISOString(),
        enabled: true,
        version: manifest.version,
      }],
      loading: false,
    }));
    await get().save();
  },
  uninstallPlugin: (id) => {
    set((s) => ({
      installed: s.installed.filter((p) => p.id !== id),
    }));
    void get().save();
  },
  togglePlugin: (id) => {
    set((s) => ({
      installed: s.installed.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p),
    }));
    void get().save();
  },

  fetchRegistry: async () => {
    set({ loading: true });
    try {
      for (const source of get().sources) {
        if (!source.enabled) continue;
        const res = await fetch(source.url).catch(() => null);
        if (!res) continue;
        const data = await res.json().catch(() => null);
        if (data?.plugins) {
          const manifests: PluginManifest[] = [];
          for (const plugin of data.plugins) {
            if (plugin.manifestUrl) {
              try {
                const mr = await fetch(plugin.manifestUrl);
                manifests.push(await mr.json());
              } catch { /* skip */ }
            }
          }
          set((s) => ({
            registry: [...s.registry.filter((m) => !manifests.find((n) => n.id === m.id)), ...manifests],
          }));
        }
      }
    } catch {
      set({ error: 'Failed to fetch registry' });
    } finally {
      set({ loading: false });
    }
  },

  load: async () => {
    const sources = await readConfig<PluginSource[]>('plugin-sources', [
      { id: 'official', name: translateText(getDocumentLanguage(), '官方插件源'), type: 'official-registry', url: 'https://raw.githubusercontent.com/orcha-writer/plugin-registry/main/registry.json', enabled: true, official: true },
    ]);
    const installed = await readConfig<PluginInstalled[]>('plugin-installed', []);
    set({ sources, installed });
  },
  save: async () => {
    const s = get();
    await writeConfig('plugin-sources', s.sources);
    await writeConfig('plugin-installed', s.installed);
  },
}));

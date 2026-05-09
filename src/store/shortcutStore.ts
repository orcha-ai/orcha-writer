import type { ShortcutConfig } from '../types';
import { defaultShortcuts } from '../types';
import { create } from 'zustand';
import { readConfig, writeConfig } from '../config';

export interface ShortcutState {
  shortcuts: ShortcutConfig[];

  updateShortcut: (id: string, keys: string) => void;
  toggleShortcut: (id: string) => void;
  resetShortcut: (id: string) => void;
  resetAll: () => void;

  load: () => Promise<void>;
  save: () => Promise<void>;
}

const supportedShortcutIds = new Set(defaultShortcuts.map(sc => sc.id));

function normalizeShortcuts(saved: ShortcutConfig[] | null | undefined): ShortcutConfig[] {
  const savedById = new Map(
    (saved ?? [])
      .filter(sc => sc.source === 'core' && supportedShortcutIds.has(sc.id))
      .map(sc => [sc.id, sc])
  );

  return defaultShortcuts.map(defaultShortcut => {
    const savedShortcut = savedById.get(defaultShortcut.id);
    if (!savedShortcut) return defaultShortcut;
    return {
      ...defaultShortcut,
      keys: savedShortcut.keys || defaultShortcut.keys,
      enabled: typeof savedShortcut.enabled === 'boolean' ? savedShortcut.enabled : defaultShortcut.enabled,
    };
  });
}

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  shortcuts: defaultShortcuts,

  updateShortcut: (id, keys) => {
    set((s) => ({
      shortcuts: s.shortcuts.map((sc) => sc.id === id ? { ...sc, keys } : sc),
    }));
    void get().save();
  },
  toggleShortcut: (id) => {
    set((s) => ({
      shortcuts: s.shortcuts.map((sc) => sc.id === id ? { ...sc, enabled: !sc.enabled } : sc),
    }));
    void get().save();
  },
  resetShortcut: (id) => {
    set((s) => ({
      shortcuts: s.shortcuts.map((sc) => sc.id === id && sc.defaultKeys ? { ...sc, keys: sc.defaultKeys, enabled: true } : sc),
    }));
    void get().save();
  },
  resetAll: () => {
    set((s) => ({
      shortcuts: s.shortcuts.map((sc) => sc.defaultKeys ? { ...sc, keys: sc.defaultKeys, enabled: true } : sc),
    }));
    void get().save();
  },

  load: async () => {
    const shortcuts = await readConfig<ShortcutConfig[]>('shortcuts', defaultShortcuts);
    set({ shortcuts: normalizeShortcuts(shortcuts) });
  },
  save: async () => {
    await writeConfig('shortcuts', get().shortcuts);
  },
}));

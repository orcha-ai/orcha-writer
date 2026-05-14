import { create } from 'zustand';
import type {
  GeneralSettings, AppearanceSettings, EditorSettingsV2,
  MarkdownSettings, PreviewSettings, FileSettings, ExportSettings, ExportConfig,
  SecuritySettings, AdvancedSettings,
} from '../types';
import {
  defaultGeneralSettings, defaultAppearanceSettings,
  defaultEditorSettingsV2, defaultMarkdownSettings,
  defaultPreviewSettings, defaultFileSettings, defaultExportSettings,
  defaultSecuritySettings, defaultAdvancedSettings,
} from '../types';
import { readConfig, writeConfig } from '../config';
import { normalizePreviewThemeId } from '../previewThemes';
import { normalizePreviewCodeThemeId } from '../codeThemes';
import { normalizeAppLanguage } from '../i18n';

const EXPORT_CONFIG_VERSION = '1.0.0';

function normalizeGeneralSettings(value: unknown): GeneralSettings {
  const raw = value as Partial<GeneralSettings>;
  return {
    language: normalizeAppLanguage(raw?.language),
    startupOpen: raw?.startupOpen ?? defaultGeneralSettings.startupOpen,
    autoUpdate: raw?.autoUpdate ?? defaultGeneralSettings.autoUpdate,
    recentFileCount: raw?.recentFileCount ?? defaultGeneralSettings.recentFileCount,
    lastViewMode: raw?.lastViewMode ?? defaultGeneralSettings.lastViewMode,
  };
}

function wrapExportConfig(settings: ExportSettings): ExportConfig {
  return {
    version: EXPORT_CONFIG_VERSION,
    general: {
      defaultExportDir: settings.defaultExportDir,
      overwriteExisting: settings.overwriteExisting,
      openAfterExport: settings.openAfterExport,
    },
    pdf: {
      defaultEngine: settings.defaultPdfEngine,
      fallbackEngine: settings.defaultPdfEngine === 'auto' ? 'system_print' : settings.defaultPdfEngine,
      systemChrome: settings.systemChrome,
      page: settings.page,
      headerFooter: settings.headerFooter,
    },
  };
}

function unwrapExportConfig(config: ExportConfig): ExportSettings {
  return {
    defaultExportDir: config.general?.defaultExportDir ?? defaultExportSettings.defaultExportDir,
    defaultPdfEngine: config.pdf.defaultEngine,
    systemChrome: { ...defaultExportSettings.systemChrome, ...config.pdf.systemChrome },
    page: {
      ...defaultExportSettings.page,
      ...config.pdf.page,
      margin: { ...defaultExportSettings.page.margin, ...config.pdf.page?.margin },
    },
    headerFooter: { ...defaultExportSettings.headerFooter, ...config.pdf.headerFooter },
    overwriteExisting: config.general?.overwriteExisting ?? defaultExportSettings.overwriteExisting,
    openAfterExport: config.general?.openAfterExport ?? defaultExportSettings.openAfterExport,
  };
}

function normalizeExportSettings(value: unknown): ExportSettings {
  const maybeConfig = value as Partial<ExportConfig>;
  if (maybeConfig?.pdf) {
    return unwrapExportConfig(maybeConfig as ExportConfig);
  }

  const flat = value as Partial<ExportSettings>;
  return {
    ...defaultExportSettings,
    ...flat,
    systemChrome: { ...defaultExportSettings.systemChrome, ...flat?.systemChrome },
    page: {
      ...defaultExportSettings.page,
      ...flat?.page,
      margin: { ...defaultExportSettings.page.margin, ...flat?.page?.margin },
    },
    headerFooter: { ...defaultExportSettings.headerFooter, ...flat?.headerFooter },
  };
}

function normalizeMarkdownSettings(value: unknown): MarkdownSettings {
  const raw = value as Partial<MarkdownSettings>;
  return {
    ...defaultMarkdownSettings,
    dialect: raw?.dialect === 'commonmark' ? 'commonmark' : 'gfm',
    frontMatter: raw?.frontMatter ?? defaultMarkdownSettings.frontMatter,
    tableEnhanced: raw?.tableEnhanced ?? defaultMarkdownSettings.tableEnhanced,
    callout: raw?.callout ?? defaultMarkdownSettings.callout,
    codeHighlight: raw?.codeHighlight ?? defaultMarkdownSettings.codeHighlight,
    toc: raw?.toc ?? defaultMarkdownSettings.toc,
  };
}

function normalizeEditorSettings(value: unknown): EditorSettingsV2 {
  const raw = value as Partial<EditorSettingsV2>;
  return {
    ...defaultEditorSettingsV2,
    ...raw,
    pasteImageAction: raw?.pasteImageAction === 'workspace-assets' || raw?.pasteImageAction === 'original'
      ? raw.pasteImageAction
      : 'assets',
  };
}

function normalizePreviewSettings(value: unknown): PreviewSettings {
  const raw = value as Partial<PreviewSettings>;
  return {
    ...defaultPreviewSettings,
    ...raw,
    previewTheme: normalizePreviewThemeId(raw?.previewTheme),
    codeTheme: normalizePreviewCodeThemeId(raw?.codeTheme),
  };
}

function normalizeFileSettings(value: unknown): FileSettings {
  const raw = value as Partial<FileSettings>;
  const attachmentRule = raw?.attachmentRule === 'workspace-assets' || raw?.attachmentRule === 'document-assets'
    ? raw.attachmentRule
    : defaultFileSettings.attachmentRule;

  return {
    defaultWorkspace: raw?.defaultWorkspace ?? defaultFileSettings.defaultWorkspace,
    attachmentRule,
    hidePatterns: Array.isArray(raw?.hidePatterns)
      ? raw.hidePatterns.filter((item): item is string => typeof item === 'string')
      : defaultFileSettings.hidePatterns,
    defaultTemplate: raw?.defaultTemplate ?? defaultFileSettings.defaultTemplate,
    deleteBehavior: raw?.deleteBehavior === 'direct' || raw?.deleteBehavior === 'trash'
      ? raw.deleteBehavior
      : defaultFileSettings.deleteBehavior,
  };
}

function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const raw = value && typeof value === 'object' ? value as Partial<AppearanceSettings> : {};
  const outlinePosition = raw?.outlinePosition === 'left' || raw?.outlinePosition === 'right'
    ? raw.outlinePosition
    : defaultAppearanceSettings.outlinePosition;

  return {
    ...defaultAppearanceSettings,
    ...raw,
    outlinePosition,
  };
}

interface SettingsState {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  editor: EditorSettingsV2;
  markdown: MarkdownSettings;
  preview: PreviewSettings;
  files: FileSettings;
  export: ExportSettings;
  security: SecuritySettings;
  advanced: AdvancedSettings;

  // Actions
  updateGeneral: (partial: Partial<GeneralSettings>) => void;
  updateAppearance: (partial: Partial<AppearanceSettings>) => void;
  updateEditor: (partial: Partial<EditorSettingsV2>) => void;
  updateMarkdown: (partial: Partial<MarkdownSettings>) => void;
  updatePreview: (partial: Partial<PreviewSettings>) => void;
  updateFiles: (partial: Partial<FileSettings>) => void;
  updateExport: (partial: Partial<ExportSettings>) => void;
  updateSecurity: (partial: Partial<SecuritySettings>) => void;
  updateAdvanced: (partial: Partial<AdvancedSettings>) => void;

  // Persistence
  loadAll: () => Promise<void>;
  saveAll: () => Promise<void>;
  resetAll: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  general: defaultGeneralSettings,
  appearance: defaultAppearanceSettings,
  editor: defaultEditorSettingsV2,
  markdown: defaultMarkdownSettings,
  preview: defaultPreviewSettings,
  files: defaultFileSettings,
  export: defaultExportSettings,
  security: defaultSecuritySettings,
  advanced: defaultAdvancedSettings,

  updateGeneral: (partial) => set((s) => ({ general: { ...s.general, ...partial } })),
  updateAppearance: (partial) => set((s) => ({ appearance: { ...s.appearance, ...partial } })),
  updateEditor: (partial) => set((s) => ({ editor: { ...s.editor, ...partial } })),
  updateMarkdown: (partial) => set((s) => ({ markdown: { ...s.markdown, ...partial } })),
  updatePreview: (partial) => set((s) => ({ preview: { ...s.preview, ...partial } })),
  updateFiles: (partial) => set((s) => ({ files: { ...s.files, ...partial } })),
  updateExport: (partial) => set((s) => ({
    export: {
      ...s.export,
      ...partial,
      systemChrome: { ...s.export.systemChrome, ...partial.systemChrome },
      page: {
        ...s.export.page,
        ...partial.page,
        margin: { ...s.export.page.margin, ...partial.page?.margin },
      },
      headerFooter: { ...s.export.headerFooter, ...partial.headerFooter },
    },
  })),
  updateSecurity: (partial) => set((s) => ({ security: { ...s.security, ...partial } })),
  updateAdvanced: (partial) => set((s) => ({ advanced: { ...s.advanced, ...partial } })),

  loadAll: async () => {
    const general = await readConfig<unknown>('app', defaultGeneralSettings);
    const appearance = await readConfig<AppearanceSettings>('appearance', defaultAppearanceSettings);
    const editor = await readConfig<EditorSettingsV2>('editor', defaultEditorSettingsV2);
    const markdown = await readConfig<unknown>('markdown', defaultMarkdownSettings);
    const preview = await readConfig<PreviewSettings>('preview', defaultPreviewSettings);
    const files = await readConfig<unknown>('files', defaultFileSettings);
    const exportCfg = await readConfig<unknown>('export', wrapExportConfig(defaultExportSettings));
    const security = await readConfig<SecuritySettings>('security', defaultSecuritySettings);
    const advanced = await readConfig<AdvancedSettings>('advanced', defaultAdvancedSettings);

    set({
      general: normalizeGeneralSettings(general),
      appearance: normalizeAppearanceSettings(appearance),
      editor: normalizeEditorSettings(editor),
      markdown: normalizeMarkdownSettings(markdown),
      preview: normalizePreviewSettings(preview),
      files: normalizeFileSettings(files),
      export: normalizeExportSettings(exportCfg),
      security: { ...defaultSecuritySettings, ...security },
      advanced: { ...defaultAdvancedSettings, ...advanced },
    });
  },

  saveAll: async () => {
    const s = get();
    await writeConfig('app', s.general);
    await writeConfig('appearance', s.appearance);
    await writeConfig('editor', s.editor);
    await writeConfig('markdown', s.markdown);
    await writeConfig('preview', s.preview);
    await writeConfig('files', s.files);
    await writeConfig('export', wrapExportConfig(s.export));
    await writeConfig('security', s.security);
    await writeConfig('advanced', s.advanced);
  },

  resetAll: async () => {
    set({
      general: defaultGeneralSettings,
      appearance: defaultAppearanceSettings,
      editor: defaultEditorSettingsV2,
      markdown: defaultMarkdownSettings,
      preview: defaultPreviewSettings,
      files: defaultFileSettings,
      export: defaultExportSettings,
      security: defaultSecuritySettings,
      advanced: defaultAdvancedSettings,
    });
    await get().saveAll();
  },
}));

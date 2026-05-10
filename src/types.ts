import type { PreviewThemeId } from './previewThemes';
import type { PreviewCodeThemeId } from './codeThemes';

// ===== Core Types =====

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
}

export interface TabFile {
  id: string;
  name: string;
  path: string;
  content: string;
  saved: boolean;
  isDraft: boolean;
}

export type ViewMode = 'edit' | 'preview' | 'split';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppState {
  tabs: TabFile[];
  activeTabId: string | null;
  viewMode: ViewMode;
  theme: ThemeMode;
  sidebarVisible: boolean;
  outlineVisible: boolean;
  sidebarActiveTab: 'workspace' | 'recent';
  workspacePath: string | null;
  workspaceTree: FileNode[];
  recentFiles: RecentFile[];
  cursorPosition: { line: number; ch: number };
  wordCount: number;
  searchOpen: boolean;
  searchQuery: string;
  searchMatchIndex: number;
  replaceOpen: boolean;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  editorSettings: EditorSettings;
}

export interface RecentFile {
  path: string;
  name: string;
  lastOpened: number;
}

export interface EditorSettings {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  showLineNumbers: boolean;
  autoWrap: boolean;
  tabSize: number;
  autoSave: boolean;
  autoSaveDelay: number;
  syncScroll: boolean;
}

export const defaultEditorSettings: EditorSettings = {
  fontSize: 14,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  lineHeight: 1.6,
  showLineNumbers: true,
  autoWrap: true,
  tabSize: 2,
  autoSave: true,
  autoSaveDelay: 2000,
  syncScroll: true,
};

// ===== Plugin Types =====

export interface PluginSource {
  id: string;
  name: string;
  type: 'official-registry' | 'github-registry' | 'custom-registry' | 'enterprise-registry' | 'local';
  url: string;
  enabled: boolean;
  official?: boolean;
  lastSyncAt?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  license: string;
  category: 'export' | 'markdown' | 'theme' | 'sync' | 'ai' | 'devtool';
  tags: string[];
  permissions: string[];
  homepage?: string;
  repository?: string;
  download?: {
    url: string;
    sha256: string;
  };
}

export interface PluginInstalled {
  id: string;
  manifest: PluginManifest;
  installedAt: string;
  enabled: boolean;
  version: string;
}

export interface ExporterPlugin {
  id: string;
  name: string;
  formats: string[];
  export(input: ExportInput): Promise<ExportResult>;
}

export interface ExportInput {
  markdown: string;
  html: string;
  assetsDir: string;
  outputPath: string;
  options: Record<string, unknown>;
}

export interface ExportResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

// ===== AI Types =====

export interface AiProviderConfig {
  id: string;
  name: string;
  type: 'openai-compatible' | 'anthropic' | 'gemini' | 'ollama' | 'custom';
  baseUrl: string;
  credentialRef?: string;
  enabled: boolean;
}

export interface AiModelConfig {
  id: string;
  name: string;
  providerId: string;
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  thinkingEnabled?: boolean;
  enabled: boolean;
}

export interface AgentConfig {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  modelConfigId: string;
  systemPrompt: string;
  enabled: boolean;
  capabilities: AgentCapability[];
  accessScope: 'selection' | 'current-document' | 'workspace';
}

export interface AgentCapability {
  code: string;
  name: string;
  enabled: boolean;
}

// ===== Shortcut Types =====

export interface ShortcutConfig {
  id: string;
  name: string;
  category: 'file' | 'edit' | 'markdown' | 'view' | 'export' | 'ai' | 'plugin' | 'system';
  keys: string;
  defaultKeys: string | null;
  enabled: boolean;
  source: 'core' | 'plugin';
  pluginId?: string;
}

// ===== Settings Types =====

export interface GeneralSettings {
  language: string;
  startupOpen: 'blank' | 'last-workspace' | 'specific-workspace';
  autoSave: boolean;
  autoUpdate: boolean;
  recentFileCount: number;
  closeBehavior: 'exit' | 'minimize';
  lastViewMode: ViewMode;
}

export interface AppearanceSettings {
  themeMode: 'system' | 'light' | 'dark';
  themeColor: string;
  density: 'comfortable' | 'standard' | 'compact';
  font: string;
  showSidebar: boolean;
  showTabs: boolean;
  transparency: boolean;
}

export interface EditorSettingsV2 {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  autoWrap: boolean;
  showLineNumbers: boolean;
  highlightCurrentLine: boolean;
  spellCheck: boolean;
  autoComplete: boolean;
  pasteImageAction: 'assets' | 'workspace-assets' | 'original';
}

export interface MarkdownSettings {
  dialect: 'commonmark' | 'gfm';
  frontMatter: boolean;
  tableEnhanced: boolean;
  callout: boolean;
  codeHighlight: boolean;
  toc: boolean;
}

export interface PreviewSettings {
  previewTheme: PreviewThemeId;
  codeTheme: PreviewCodeThemeId;
  syncScroll: boolean;
  imageMaxWidth: number;
  openExternalLink: boolean;
  htmlRender: 'disable' | 'safe' | 'all';
}

export interface FileSettings {
  defaultWorkspace: string;
  attachmentRule: 'document-assets' | 'workspace-assets';
  hidePatterns: string[];
  defaultTemplate: string;
  autoSaveInterval: number;
  deleteBehavior: 'direct' | 'trash';
}

export interface SecuritySettings {
  allowExternalContent: boolean;
  enableSandbox: boolean;
  confirmExternalLinks: boolean;
  redactSensitiveLogs: boolean;
}

export interface AdvancedSettings {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  developerMode: boolean;
  enableWorkspaceIndex: boolean;
}

// ===== Export Types =====

export type PdfExportEngine =
  | 'auto'
  | 'system_print'
  | 'system_chrome'
  | 'orcha_pdf_engine'
  | 'vivliostyle';

export interface PdfSystemChromeConfig {
  detectMode: 'auto' | 'custom';
  customPath?: string;
  lastDetectedPath?: string;
  lastDetectedVersion?: string;
}

export interface PdfPageConfig {
  format: 'A4' | 'A5' | 'Letter' | 'Legal' | 'custom';
  orientation: 'portrait' | 'landscape';
  margin: {
    top: string;
    right: string;
    bottom: string;
    left: string;
  };
  printBackground: boolean;
}

export interface PdfHeaderFooterConfig {
  enabled: boolean;
  showPageNumber: boolean;
  showDocumentTitle: boolean;
}

export interface PdfExportConfig {
  defaultEngine: PdfExportEngine;
  fallbackEngine: Exclude<PdfExportEngine, 'auto'>;
  systemChrome: PdfSystemChromeConfig;
  page: PdfPageConfig;
  headerFooter: PdfHeaderFooterConfig;
}

export interface ExportConfig {
  version: string;
  pdf: PdfExportConfig;
  general?: {
    defaultExportDir: string;
    overwriteExisting: boolean;
    openAfterExport: boolean;
  };
}

export interface PdfEngineStatus {
  engine: PdfExportEngine;
  available: boolean;
  label: string;
  reason?: string;
  version?: string;
  path?: string;
}

export interface ExportSettings {
  defaultExportDir: string;
  defaultPdfEngine: PdfExportEngine;
  systemChrome: PdfSystemChromeConfig;
  page: PdfPageConfig;
  headerFooter: PdfHeaderFooterConfig;
  overwriteExisting: boolean;
  openAfterExport: boolean;
}

export const defaultGeneralSettings: GeneralSettings = {
  language: 'zh-CN',
  startupOpen: 'blank',
  autoSave: true,
  autoUpdate: true,
  recentFileCount: 10,
  closeBehavior: 'minimize',
  lastViewMode: 'split',
};

export const defaultAppearanceSettings: AppearanceSettings = {
  themeMode: 'system',
  themeColor: '#0A84FF',
  density: 'standard',
  font: 'system-ui',
  showSidebar: true,
  showTabs: true,
  transparency: false,
};

export const defaultEditorSettingsV2: EditorSettingsV2 = {
  fontSize: 14,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  lineHeight: 1.6,
  tabSize: 2,
  autoWrap: true,
  showLineNumbers: true,
  highlightCurrentLine: true,
  spellCheck: false,
  autoComplete: true,
  pasteImageAction: 'assets',
};

export const defaultMarkdownSettings: MarkdownSettings = {
  dialect: 'gfm',
  frontMatter: true,
  tableEnhanced: true,
  callout: true,
  codeHighlight: true,
  toc: true,
};

export const defaultPreviewSettings: PreviewSettings = {
  previewTheme: 'default',
  codeTheme: 'github',
  syncScroll: true,
  imageMaxWidth: 800,
  openExternalLink: true,
  htmlRender: 'safe',
};

export const defaultFileSettings: FileSettings = {
  defaultWorkspace: '',
  attachmentRule: 'document-assets',
  hidePatterns: ['node_modules', '.git', '.orcha-writer'],
  defaultTemplate: '',
  autoSaveInterval: 30,
  deleteBehavior: 'trash',
};

export const defaultSecuritySettings: SecuritySettings = {
  allowExternalContent: false,
  enableSandbox: true,
  confirmExternalLinks: true,
  redactSensitiveLogs: true,
};

export const defaultAdvancedSettings: AdvancedSettings = {
  logLevel: 'info',
  developerMode: false,
  enableWorkspaceIndex: true,
};

export const defaultExportSettings: ExportSettings = {
  defaultExportDir: '',
  defaultPdfEngine: 'auto',
  systemChrome: {
    detectMode: 'auto',
    customPath: '',
    lastDetectedPath: '',
    lastDetectedVersion: '',
  },
  page: {
    format: 'A4',
    orientation: 'portrait',
    margin: {
      top: '20mm',
      right: '18mm',
      bottom: '20mm',
      left: '18mm',
    },
    printBackground: true,
  },
  headerFooter: {
    enabled: false,
    showPageNumber: true,
    showDocumentTitle: false,
  },
  overwriteExisting: true,
  openAfterExport: false,
};

// Default shortcuts
export const defaultShortcuts: ShortcutConfig[] = [
  { id: 'app.openSettings', name: '打开设置', category: 'system', keys: 'Meta+,', defaultKeys: 'Meta+,', enabled: true, source: 'core' },
  { id: 'file.save', name: '保存', category: 'file', keys: 'Meta+S', defaultKeys: 'Meta+S', enabled: true, source: 'core' },
  { id: 'file.new', name: '新建文件', category: 'file', keys: 'Meta+N', defaultKeys: 'Meta+N', enabled: true, source: 'core' },
  { id: 'file.open', name: '打开文件', category: 'file', keys: 'Meta+O', defaultKeys: 'Meta+O', enabled: true, source: 'core' },
  { id: 'file.openFolder', name: '打开文件夹', category: 'file', keys: 'Meta+Shift+O', defaultKeys: 'Meta+Shift+O', enabled: true, source: 'core' },
  { id: 'edit.find', name: '查找', category: 'edit', keys: 'Meta+F', defaultKeys: 'Meta+F', enabled: true, source: 'core' },
  { id: 'edit.replace', name: '替换', category: 'edit', keys: 'Meta+H', defaultKeys: 'Meta+H', enabled: true, source: 'core' },
  { id: 'view.togglePreview', name: '切换预览', category: 'view', keys: 'Meta+Shift+V', defaultKeys: 'Meta+Shift+V', enabled: true, source: 'core' },
  { id: 'export.pdf', name: '导出 PDF', category: 'export', keys: 'Meta+Shift+E', defaultKeys: 'Meta+Shift+E', enabled: true, source: 'core' },
  { id: 'app.commandPalette', name: '命令面板', category: 'system', keys: 'Meta+Shift+P', defaultKeys: 'Meta+Shift+P', enabled: true, source: 'core' },
];

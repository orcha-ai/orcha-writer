export const PREVIEW_THEMES = [
  { id: 'default', label: '默认', className: 'preview-theme-default' },
  { id: 'github', label: 'GitHub', className: 'preview-theme-github' },
  { id: 'vuepress', label: 'VuePress', className: 'preview-theme-vuepress' },
  { id: 'mk-cute', label: 'MK-Cute', className: 'preview-theme-mk-cute' },
  { id: 'smartblue', label: 'Smart Blue', className: 'preview-theme-smartblue' },
] as const;

export type PreviewThemeId = typeof PREVIEW_THEMES[number]['id'];

const themeById = new Map<string, typeof PREVIEW_THEMES[number]>(
  PREVIEW_THEMES.map(theme => [theme.id, theme])
);

export function normalizePreviewThemeId(value: unknown): PreviewThemeId {
  return typeof value === 'string' && themeById.has(value)
    ? value as PreviewThemeId
    : 'default';
}

export function getPreviewThemeClassName(value: unknown): string {
  return themeById.get(normalizePreviewThemeId(value))?.className ?? 'preview-theme-default';
}

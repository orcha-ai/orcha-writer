export const PREVIEW_CODE_THEMES = [
  { id: 'github', label: 'GitHub Light', className: 'code-theme-github' },
  { id: 'github-dark', label: 'GitHub Dark', className: 'code-theme-github-dark' },
  { id: 'atom-one-light', label: 'Atom One Light', className: 'code-theme-atom-one-light' },
  { id: 'atom-one-dark', label: 'Atom One Dark', className: 'code-theme-atom-one-dark' },
  { id: 'monokai', label: 'Monokai', className: 'code-theme-monokai' },
  { id: 'solarized-light', label: 'Solarized Light', className: 'code-theme-solarized-light' },
] as const;

export type PreviewCodeThemeId = typeof PREVIEW_CODE_THEMES[number]['id'];

const codeThemeById = new Map(PREVIEW_CODE_THEMES.map(theme => [theme.id, theme]));

export function normalizePreviewCodeThemeId(value: unknown): PreviewCodeThemeId {
  if (typeof value === 'string' && codeThemeById.has(value as PreviewCodeThemeId)) {
    return value as PreviewCodeThemeId;
  }
  return 'github';
}

export function getPreviewCodeThemeClassName(value: unknown): string {
  return codeThemeById.get(normalizePreviewCodeThemeId(value))?.className ?? 'code-theme-github';
}

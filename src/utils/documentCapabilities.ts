import type { TabFile, ViewMode } from '../types';
import { isMarkdownFileName } from './savePaths';

type DocumentIdentity = Pick<TabFile, 'name' | 'path' | 'isDraft' | 'preview'>;

export function isMarkdownDocument(tab: DocumentIdentity | null | undefined): boolean {
  if (!tab || tab.preview) return false;
  return isMarkdownFileName(tab.name) || (!tab.isDraft && isMarkdownFileName(tab.path));
}

export function isMarkdownViewMode(mode: ViewMode): boolean {
  return mode === 'block' || mode === 'preview' || mode === 'split';
}

export function effectiveViewModeForDocument(tab: DocumentIdentity | null | undefined, mode: ViewMode): ViewMode {
  return tab && !isMarkdownDocument(tab) && isMarkdownViewMode(mode) ? 'edit' : mode;
}

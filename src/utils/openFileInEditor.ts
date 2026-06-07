import type { Dispatch } from 'react';
import type { AppAction } from '../AppContext';
import type { FileNode, RecentFile } from '../types';
import { readTextFile } from './fs';
import { getPreviewFileKind, isMarkdownFileName, isOpenableTextFileName } from './savePaths';

interface OpenFileOptions {
  unsupportedFileContent?: (extension: string) => string;
}

type OpenableFile = Pick<FileNode, 'name' | 'path'>;

export function initialContentForFile(fileName: string): string {
  return isMarkdownFileName(fileName) ? `# ${fileName.replace(/\.\w+$/, '')}\n\n` : '';
}

function fileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

export async function openFileInEditor(
  dispatch: Dispatch<AppAction>,
  file: OpenableFile,
  options: OpenFileOptions = {},
): Promise<void> {
  const id = file.path;
  const previewKind = getPreviewFileKind(file.name);

  if (previewKind) {
    dispatch({
      type: 'OPEN_TAB',
      payload: { id, name: file.name, path: file.path, content: '', preview: { kind: previewKind } },
    });
    dispatch({ type: 'ADD_RECENT_FILE', payload: { path: file.path, name: file.name, lastOpened: Date.now() } });
    return;
  }

  if (!isOpenableTextFileName(file.name)) {
    dispatch({
      type: 'OPEN_TAB',
      payload: {
        id,
        name: file.name,
        path: file.path,
        content: options.unsupportedFileContent?.(fileExtension(file.name)) ?? initialContentForFile(file.name),
      },
    });
    return;
  }

  try {
    const content = await readTextFile(file.path);
    dispatch({ type: 'OPEN_TAB', payload: { id, name: file.name, path: file.path, content } });
    dispatch({ type: 'ADD_RECENT_FILE', payload: { path: file.path, name: file.name, lastOpened: Date.now() } });
  } catch {
    dispatch({ type: 'OPEN_TAB', payload: { id, name: file.name, path: file.path, content: initialContentForFile(file.name) } });
  }
}

export function openRecentFileInEditor(
  dispatch: Dispatch<AppAction>,
  file: RecentFile,
  options: OpenFileOptions = {},
): Promise<void> {
  return openFileInEditor(dispatch, { path: file.path, name: file.name }, options);
}

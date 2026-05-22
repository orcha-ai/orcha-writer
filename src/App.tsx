import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import Editor from './components/Editor';
import Preview from './components/Preview';
import FilePreview from './components/FilePreview';
import Outline from './components/Outline';
import StatusBar from './components/StatusBar';
import SearchPanel from './components/SearchPanel';
import CommandPalette from './components/CommandPalette';
import GlobalContextMenu from './components/GlobalContextMenu';
import TerminalPanel from './components/TerminalPanel';
import { AIChatPanel, createCodeMirrorEditorBridge } from './modules/ai-chat';
import { BlockEditor } from './modules/block-editor';
import { useApp } from './AppContext';
import { writeTextFile } from './utils/fs';
import { effectiveViewModeForDocument } from './utils/documentCapabilities';
import { dirname } from './utils/markdownImages';
import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from './store';
import { translateText } from './i18n';
import './App.css';
import './styles/preview-themes.css';
import './styles/code-themes.css';

function formatAIDocumentTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('');
}

function scrollDocumentSurfacesToTop(): void {
  document
    .querySelectorAll<HTMLElement>('.cm-scroller, .preview-panel, .block-document-scroll')
    .forEach((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
}

export default function WorkspaceContent() {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const language = useSettingsStore(s => s.general.language);
  const outlinePosition = useSettingsStore(s => s.appearance.outlinePosition);
  const t = useCallback((value: string) => translateText(language, value), [language]);
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  const activeTabId = activeTab?.id;
  const activeFilePreview = Boolean(activeTab?.preview);
  const effectiveViewMode = effectiveViewModeForDocument(activeTab, state.viewMode);
  const editorBridge = useMemo(() => createCodeMirrorEditorBridge(), []);

  const handleCreateMarkdownFile = useCallback(async (content: string) => {
    const fileName = `${t('AI生成文档')}-${formatAIDocumentTimestamp(new Date())}.md`;
    const activeDir = activeTab && !activeTab.isDraft && /[/\\]/.test(activeTab.path)
      ? dirname(activeTab.path)
      : '';

    if (activeDir) {
      const path = `${activeDir}/${fileName}`;
      await writeTextFile(path, content);
      dispatch({ type: 'OPEN_TAB', payload: { id: path, name: fileName, path, content } });
      return;
    }

    const id = `draft-ai-${Date.now()}`;
    dispatch({ type: 'OPEN_TAB', payload: { id, name: fileName, path: id, content, isDraft: true } });
  }, [activeTab, dispatch, t]);

  useEffect(() => {
    if (!activeTabId) return undefined;

    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      scrollDocumentSurfacesToTop();
      secondFrame = window.requestAnimationFrame(scrollDocumentSurfacesToTop);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [activeTabId]);

  return (
    <>
      <Toolbar />
      <div className="main-content">
        <Sidebar />
        <div className="editor-area">
          <TabBar />
          <div style={{ position: 'relative', flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
            <SearchPanel />
            <div className="editor-container">
              {activeFilePreview ? (
                <FilePreview />
              ) : (
                <>
                  <BlockEditor />
                  <Editor />
                  <div className={`resize-handle ${effectiveViewMode === 'split' ? '' : 'hidden'}`} />
                  <Preview />
                </>
              )}
            </div>
          </div>
        </div>
        {outlinePosition === 'right' && <Outline />}
        <AIChatPanel
          documentId={activeTab?.id || 'empty-document'}
          documentPath={activeTab?.isDraft ? undefined : activeTab?.path}
          documentTitle={activeTab?.name || t('未命名.md')}
          editorBridge={editorBridge}
          onOpenSettings={() => navigate('/settings/ai/models')}
          onOpenAgentManager={() => navigate('/settings/ai/agents')}
          onCreateMarkdownFile={handleCreateMarkdownFile}
        />
      </div>
      <TerminalPanel />
      <StatusBar />
      <CommandPalette />
      <GlobalContextMenu />
    </>
  );
}

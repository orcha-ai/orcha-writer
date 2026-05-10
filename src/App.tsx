import Toolbar from './components/Toolbar';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import Editor from './components/Editor';
import Preview from './components/Preview';
import Outline from './components/Outline';
import StatusBar from './components/StatusBar';
import SearchPanel from './components/SearchPanel';
import CommandPalette from './components/CommandPalette';
import './App.css';
import './styles/preview-themes.css';
import './styles/code-themes.css';

export default function WorkspaceContent() {
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
              <Editor />
              <div className="resize-handle" />
              <Preview />
            </div>
          </div>
        </div>
        <Outline />
      </div>
      <StatusBar />
      <CommandPalette />
    </>
  );
}

import { createBrowserRouter, Navigate } from 'react-router-dom';
import { MainLayout } from './layouts/MainLayout';
import { SettingsLayout } from './layouts/SettingsLayout';
import WorkspacePage from '../pages/workspace/WorkspacePage';
import GeneralPage from '../pages/settings/general/GeneralPage';
import AppearancePage from '../pages/settings/appearance/AppearancePage';
import EditorPage from '../pages/settings/editor/EditorPage';
import MarkdownPage from '../pages/settings/markdown/MarkdownPage';
import FilesPage from '../pages/settings/files/FilesPage';
import ExportPage from '../pages/settings/export/ExportPage';
import ShortcutsPage from '../pages/settings/shortcuts/ShortcutsPage';
import PreviewPage from '../pages/settings/preview/PreviewPage';
import SecurityPage from '../pages/settings/security/SecurityPage';
import AdvancedPage from '../pages/settings/advanced/AdvancedPage';
import AboutPage from '../pages/settings/about/AboutPage';
import AiModelConfigPage from '../pages/settings/ai/AiModelConfigPage';
import AgentConfigPage from '../pages/settings/ai/AgentConfigPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/workspace" replace />,
      },
      {
        path: 'workspace',
        element: <WorkspacePage />,
      },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          {
            index: true,
            element: <Navigate to="/settings/general" replace />,
          },
          { path: 'general', element: <GeneralPage /> },
          { path: 'appearance', element: <AppearancePage /> },
          { path: 'editor', element: <EditorPage /> },
          { path: 'markdown', element: <MarkdownPage /> },
          { path: 'preview', element: <PreviewPage /> },
          { path: 'files', element: <FilesPage /> },
          { path: 'export', element: <ExportPage /> },
          { path: 'plugins/*', element: <Navigate to="/settings/general" replace /> },
          { path: 'ai', element: <Navigate to="/settings/ai/models" replace /> },
          { path: 'ai/models', element: <AiModelConfigPage /> },
          { path: 'ai/agents', element: <AgentConfigPage /> },
          { path: 'shortcuts', element: <ShortcutsPage /> },
          { path: 'security', element: <SecurityPage /> },
          { path: 'advanced', element: <AdvancedPage /> },
          { path: 'about', element: <AboutPage /> },
        ],
      },
    ],
  },
]);

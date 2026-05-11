import { useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  SettingOutlined,
  LayoutOutlined,
  EditOutlined,
  FontSizeOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  ExportOutlined,
  KeyOutlined,
  SafetyOutlined,
  ExperimentOutlined,
  InfoCircleOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useSettingsStore } from '../../store';
import { getLocaleText } from '../../i18n';

const { Title } = Typography;

const settingsMenuConfig = [
  { key: '/settings/general', icon: <SettingOutlined />, labelKey: 'general' },
  { key: '/settings/appearance', icon: <LayoutOutlined />, labelKey: 'appearance' },
  { key: '/settings/editor', icon: <EditOutlined />, labelKey: 'editor' },
  { key: '/settings/markdown', icon: <FontSizeOutlined />, labelKey: 'markdown' },
  { key: '/settings/preview', icon: <EyeOutlined />, labelKey: 'preview' },
  { key: '/settings/files', icon: <FolderOpenOutlined />, labelKey: 'files' },
  { key: '/settings/export', icon: <ExportOutlined />, labelKey: 'export' },
  { key: '/settings/ai/models', icon: <RobotOutlined />, labelKey: 'models' },
  { key: '/settings/ai/agents', icon: <RobotOutlined />, labelKey: 'agents' },
  { key: '/settings/shortcuts', icon: <KeyOutlined />, labelKey: 'shortcuts' },
  { key: '/settings/security', icon: <SafetyOutlined />, labelKey: 'security' },
  { key: '/settings/advanced', icon: <ExperimentOutlined />, labelKey: 'advanced' },
  { key: '/settings/about', icon: <InfoCircleOutlined />, labelKey: 'about' },
] as const;

type SettingsMenuLabelKey = typeof settingsMenuConfig[number]['labelKey'];

const pageTitleKeyMap: Record<string, SettingsMenuLabelKey> = {
  general: 'general',
  appearance: 'appearance',
  editor: 'editor',
  markdown: 'markdown',
  preview: 'preview',
  files: 'files',
  export: 'export',
  models: 'models',
  agents: 'agents',
  shortcuts: 'shortcuts',
  security: 'security',
  advanced: 'advanced',
  about: 'about',
};

export function SettingsLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const language = useSettingsStore(s => s.general.language);
  const text = getLocaleText(language);

  const settingsMenuItems = useMemo(() => (
    settingsMenuConfig.map(item => ({
      key: item.key,
      icon: item.icon,
      label: text.settings.menu[item.labelKey],
    }))
  ), [text]);

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (settingsMenuConfig.some((item) => item.key === path)) return path;
    return '/settings/general';
  }, [location.pathname]);

  const pageTitle = useMemo(() => {
    const segments = location.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || 'general';
    const titleKey = pageTitleKeyMap[lastSegment];
    return titleKey ? text.settings.menu[titleKey] : text.settings.menu.settings;
  }, [location.pathname, text]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === ',') { e.preventDefault(); navigate('/settings/general'); return; }
      if (e.key === 'Escape') {
        navigate('/workspace');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const headerHeight = 56;

  return (
    <div className="settings-shell">
      {/* Sidebar */}
      <div className="settings-sidebar">
        {/* Header */}
        <div
          className="settings-sidebar-header"
          style={{
            height: headerHeight,
          }}
        >
          <div
            className="settings-return"
            onClick={() => navigate('/workspace')}
          >
            <ArrowLeftOutlined style={{ fontSize: 12 }} />
            {text.settings.menu.backToWorkspace}
          </div>
        </div>

        {/* Menu - scrollable area */}
        <div className="settings-menu-scroll">
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={settingsMenuItems}
            onClick={({ key }) => navigate(key)}
            style={{
              border: 'none',
              padding: '8px 0',
            }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="settings-main">
        <div
          className="settings-content-header"
          style={{
            height: headerHeight,
          }}
        >
          <Title level={4} className="settings-page-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            {pageTitle}
          </Title>
        </div>

        <div className="settings-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

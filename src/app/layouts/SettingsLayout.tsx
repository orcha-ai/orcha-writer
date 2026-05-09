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
} from '@ant-design/icons';

const { Title } = Typography;

const settingsMenuItems = [
  { key: '/settings/general', icon: <SettingOutlined />, label: '通用' },
  { key: '/settings/appearance', icon: <LayoutOutlined />, label: '外观' },
  { key: '/settings/editor', icon: <EditOutlined />, label: '编辑器' },
  { key: '/settings/markdown', icon: <FontSizeOutlined />, label: 'Markdown' },
  { key: '/settings/preview', icon: <EyeOutlined />, label: '预览' },
  { key: '/settings/files', icon: <FolderOpenOutlined />, label: '文件与工作区' },
  { key: '/settings/export', icon: <ExportOutlined />, label: '导出' },
  { key: '/settings/shortcuts', icon: <KeyOutlined />, label: '快捷键' },
  { key: '/settings/security', icon: <SafetyOutlined />, label: '安全与隐私' },
  { key: '/settings/advanced', icon: <ExperimentOutlined />, label: '高级' },
  { key: '/settings/about', icon: <InfoCircleOutlined />, label: '关于' },
];

const pageTitleMap: Record<string, string> = {
  general: '通用',
  appearance: '外观',
  editor: '编辑器',
  markdown: 'Markdown',
  preview: '预览',
  files: '文件与工作区',
  export: '导出',
  shortcuts: '快捷键',
  security: '安全与隐私',
  advanced: '高级',
  about: '关于',
};

export function SettingsLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    if (settingsMenuItems.some((item) => item.key === path)) return path;
    return '/settings/general';
  }, [location.pathname]);

  const pageTitle = useMemo(() => {
    const segments = location.pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || 'general';
    return pageTitleMap[lastSegment] || '设置';
  }, [location.pathname]);

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
            返回工作区
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

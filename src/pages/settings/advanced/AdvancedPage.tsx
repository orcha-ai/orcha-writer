import { Card, Button, Space, Typography, message } from 'antd';
import { FolderOpenOutlined, ClearOutlined, RestOutlined } from '@ant-design/icons';
import { open as openPath } from '@tauri-apps/plugin-shell';
import { useSettingsStore } from '../../../store';
import { getConfigDir, getCacheDir, getLogsDir } from '../../../config/paths';

const { Text, Paragraph } = Typography;

export default function AdvancedPage() {
  const { resetAll } = useSettingsStore();

  const handleOpenPath = async (path: string) => {
    try {
      await openPath(path);
    } catch {
      message.warning('当前环境无法打开目录');
    }
  };

  const handleClearCache = () => {
    localStorage.removeItem('orcha-drafts');
    message.success('缓存已清理');
  };

  const handleResetSettings = async () => {
    await resetAll();
    message.success('设置已重置为默认值');
  };

  return (
    <div>
      <Card title="目录路径" style={{ marginBottom: 16 }}>
        <Paragraph>
          <Text strong>配置目录：</Text>
          <Text code>{getConfigDir()}</Text>
          <Button type="link" icon={<FolderOpenOutlined />} size="small" onClick={() => handleOpenPath(getConfigDir())}>打开</Button>
        </Paragraph>
        <Paragraph>
          <Text strong>缓存目录：</Text>
          <Text code>{getCacheDir()}</Text>
          <Button type="link" icon={<FolderOpenOutlined />} size="small" onClick={() => handleOpenPath(getCacheDir())}>打开</Button>
        </Paragraph>
        <Paragraph>
          <Text strong>日志目录：</Text>
          <Text code>{getLogsDir()}</Text>
          <Button type="link" icon={<FolderOpenOutlined />} size="small" onClick={() => handleOpenPath(getLogsDir())}>打开</Button>
        </Paragraph>
      </Card>

      <Card title="操作" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button icon={<ClearOutlined />} onClick={handleClearCache}>
            清理缓存
          </Button>
          <Button icon={<RestOutlined />} danger onClick={handleResetSettings}>
            重置所有设置
          </Button>
        </Space>
      </Card>
    </div>
  );
}

import { Card, Button, Space, Typography, message } from 'antd';
import { FolderOpenOutlined, RestOutlined } from '@ant-design/icons';
import { open as openPath } from '@tauri-apps/plugin-shell';
import { useSettingsStore } from '../../../store';
import { getConfigDir, getCacheDir, getLogsDir } from '../../../config/paths';
import { translateText } from '../../../i18n';

const { Text, Paragraph } = Typography;

export default function AdvancedPage() {
  const { resetAll } = useSettingsStore();
  const language = useSettingsStore(s => s.general.language);
  const t = (value: string) => translateText(language, value);

  const handleOpenPath = async (path: string) => {
    try {
      await openPath(path);
    } catch {
      message.warning(t('当前环境无法打开目录'));
    }
  };

  const handleResetSettings = async () => {
    await resetAll();
    message.success(t('基础设置已重置为默认值'));
  };

  return (
    <div>
      <Card title={t('目录路径')} style={{ marginBottom: 16 }}>
        <Paragraph>
          <Text strong>{t('配置目录：')}</Text>
          <Text code>{getConfigDir()}</Text>
          <Button type="link" icon={<FolderOpenOutlined />} size="small" onClick={() => handleOpenPath(getConfigDir())}>{t('打开')}</Button>
        </Paragraph>
        <Paragraph>
          <Text strong>{t('缓存目录：')}</Text>
          <Text code>{getCacheDir()}</Text>
          <Button type="link" icon={<FolderOpenOutlined />} size="small" onClick={() => handleOpenPath(getCacheDir())}>{t('打开')}</Button>
        </Paragraph>
        <Paragraph>
          <Text strong>{t('日志目录：')}</Text>
          <Text code>{getLogsDir()}</Text>
          <Button type="link" icon={<FolderOpenOutlined />} size="small" onClick={() => handleOpenPath(getLogsDir())}>{t('打开')}</Button>
        </Paragraph>
      </Card>

      <Card title={t('操作')} style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button icon={<RestOutlined />} danger onClick={handleResetSettings}>
            {t('重置基础设置')}
          </Button>
        </Space>
      </Card>
    </div>
  );
}

import { Card, Space, Typography, Button, Modal, message } from 'antd';
import { GithubOutlined, BugOutlined, SyncOutlined } from '@ant-design/icons';
import { open as openPath } from '@tauri-apps/plugin-shell';
import { useState } from 'react';
import aboutLogo from '../../../assets/brand/orcha-writer-about-logo.png';
import { checkForUpdates, installAvailableUpdate, relaunchApplication } from '../../../utils/update';

const { Paragraph } = Typography;

export default function AboutPage() {
  const [checking, setChecking] = useState(false);

  const handleCheckUpdates = async () => {
    setChecking(true);
    try {
      const result = await checkForUpdates();
      if (!result.available) {
        message.success(`当前已是最新版本（${result.currentVersion}）`);
        return;
      }

      Modal.confirm({
        title: `发现新版本 ${result.latestVersion}`,
        content: `当前版本：${result.currentVersion}`,
        okText: '下载并安装',
        cancelText: '稍后',
        onOk: async () => {
          const hide = message.loading('正在下载并安装更新...', 0);
          try {
            const installResult = await installAvailableUpdate();
            hide();
            if (installResult.status === 'installed') {
              Modal.confirm({
                title: `新版本 ${installResult.latestVersion} 已安装`,
                content: '重启应用后即可使用新版本。',
                okText: '立即重启',
                cancelText: '稍后',
                onOk: () => relaunchApplication(),
              });
              return;
            }
            if (installResult.status === 'manual') {
              message.warning(installResult.message || '自动安装暂不可用，已打开发布页');
              await openPath(installResult.releaseUrl);
              return;
            }
            message.success(`当前已是最新版本（${installResult.currentVersion}）`);
          } catch (error) {
            hide();
            message.warning(error instanceof Error ? error.message : '下载安装更新失败');
          }
        },
      });
    } catch (error) {
      message.warning(error instanceof Error ? error.message : '检查更新失败');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div>
      {/* App Info */}
      <Card style={{ textAlign: 'center', marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            width: 'min(420px, 100%)',
            margin: '0 auto 16px',
            padding: '18px 24px',
            borderRadius: 8,
            border: '1px solid var(--border-secondary)',
            background: '#fff',
            justifyContent: 'center',
          }}
        >
          <img
            src={aboutLogo}
            alt="Orcha 写作"
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </div>

        <Space style={{ marginTop: 16 }}>
          <Button icon={<SyncOutlined />} type="primary" loading={checking} onClick={handleCheckUpdates}>
            检查更新
          </Button>
          <Button icon={<GithubOutlined />} href="https://github.com/orcha-ai/orcha-writer" target="_blank">
            GitHub
          </Button>
          <Button icon={<BugOutlined />} href="https://github.com/orcha-ai/orcha-writer/issues" target="_blank">
            问题反馈
          </Button>
        </Space>
      </Card>

      {/* License */}
      <Card title="开源协议">
        <Paragraph>
          本项目采用 MIT 开源协议。
        </Paragraph>
        <Paragraph>
          第三方依赖许可证信息请参阅项目依赖列表。
        </Paragraph>
        <Paragraph>
          版权与贡献：Orcha AI 团队出品
        </Paragraph>
      </Card>
    </div>
  );
}

import { Card, Space, Typography, Button } from 'antd';
import { GithubOutlined, BugOutlined, SyncOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import aboutLogo from '../../../assets/brand/orcha-writer-about-logo.png';
import { getCurrentVersion } from '../../../utils/update';
import { runUpdateCheckFlow } from '../../../utils/updateUi';

const { Paragraph, Text } = Typography;

export default function AboutPage() {
  const [checking, setChecking] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(__APP_VERSION__);

  useEffect(() => {
    let mounted = true;
    getCurrentVersion()
      .then((version) => {
        if (mounted) setCurrentVersion(version);
      })
      .catch(() => {
        if (mounted) setCurrentVersion(__APP_VERSION__);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleCheckUpdates = async () => {
    setChecking(true);
    try {
      await runUpdateCheckFlow();
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
        <Text type="secondary">版本 {currentVersion}</Text>

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

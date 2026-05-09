import { useState, useEffect } from 'react';
import { Card, Row, Col, Tag, Button, Input, Select, Space, Typography, Empty, Spin, message } from 'antd';
import { SearchOutlined, DownloadOutlined, CheckOutlined } from '@ant-design/icons';
import { usePluginStore } from '../../../store';
import type { PluginManifest } from '../../../types';

const { Text } = Typography;

const categoryMap: Record<string, string> = {
  export: '导出',
  markdown: 'Markdown',
  theme: '主题',
  sync: '同步',
  ai: 'AI',
  devtool: '开发者工具',
};

export default function PluginCenterPage() {
  const { registry, installed, loading, fetchRegistry, installPlugin } = usePluginStore();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');

  useEffect(() => {
    fetchRegistry().catch(() => {
      // Registry fetch may fail (offline, no network), that's OK
    });
  }, [fetchRegistry]);

  const installedIds = new Set(installed.map((p) => p.id));

  const filtered = registry.filter((plugin) => {
    const matchSearch = !search || plugin.name.toLowerCase().includes(search.toLowerCase()) || plugin.description.toLowerCase().includes(search.toLowerCase());
    const matchCategory = category === 'all' || plugin.category === category;
    return matchSearch && matchCategory;
  });

  const handleInstall = async (plugin: PluginManifest) => {
    try {
      await installPlugin(plugin);
      message.success(`已安装 ${plugin.displayName || plugin.name}`);
    } catch {
      message.error('安装失败');
    }
  };

  if (loading && registry.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Spin size="large" />
        <p className="settings-muted" style={{ marginTop: 16 }}>加载插件源...</p>
      </div>
    );
  }

  if (registry.length === 0) {
    return (
      <Empty
        description="暂无可用插件"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      >
        <Text type="secondary">请检查插件源配置，或稍后重试</Text>
      </Empty>
    );
  }

  return (
    <div>
      {/* Search & Filter */}
      <Space style={{ marginBottom: 24 }} size="middle">
        <Input
          placeholder="搜索插件"
          prefix={<SearchOutlined />}
          style={{ width: 300 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Select
          value={category}
          onChange={setCategory}
          style={{ width: 140 }}
          options={[
            { value: 'all', label: '全部分类' },
            ...Object.entries(categoryMap).map(([key, label]) => ({ value: key, label })),
          ]}
        />
      </Space>

      {/* Plugin Grid */}
      <Row gutter={[16, 16]}>
        {filtered.map((plugin) => (
          <Col span={8} key={plugin.id}>
            <Card
              hoverable
              size="small"
              title={plugin.displayName || plugin.name}
              extra={
                installedIds.has(plugin.id) ? (
                  <Tag icon={<CheckOutlined />} color="success">已安装</Tag>
                ) : (
                  <Button
                    size="small"
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={() => handleInstall(plugin)}
                  >
                    安装
                  </Button>
                )
              }
            >
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 8px' }}>
                {plugin.description}
              </p>
              <Space size={4}>
                {plugin.tags?.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
                <Tag color="blue">{categoryMap[plugin.category] || plugin.category}</Tag>
                {plugin.license && <Tag>{plugin.license}</Tag>}
              </Space>
              <div className="settings-muted" style={{ marginTop: 8 }}>
                v{plugin.version} · {plugin.author}
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}

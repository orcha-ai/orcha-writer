import { List, Tag, Button, Space, Popconfirm, Typography } from 'antd';
import { DeleteOutlined, PoweroffOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { usePluginStore } from '../../../store';

const { Text } = Typography;

export default function InstalledPluginsPage() {
  const { installed, uninstallPlugin, togglePlugin } = usePluginStore();

  if (installed.length === 0) {
    return (
      <div>
        <Text type="secondary">暂无已安装插件，请前往「插件中心」安装</Text>
      </div>
    );
  }

  return (
    <List
      dataSource={installed}
      renderItem={(plugin) => (
        <List.Item
          actions={[
            plugin.enabled ? (
              <Button size="small" icon={<PoweroffOutlined />} type="text" onClick={() => togglePlugin(plugin.id)}>
                禁用
              </Button>
            ) : (
              <Button size="small" icon={<ThunderboltOutlined />} type="primary" onClick={() => togglePlugin(plugin.id)}>
                启用
              </Button>
            ),
            <Popconfirm title="确认卸载" onConfirm={() => uninstallPlugin(plugin.id)}>
              <Button size="small" danger icon={<DeleteOutlined />}>
                卸载
              </Button>
            </Popconfirm>,
          ]}
        >
          <List.Item.Meta
            title={
              <Space>
                {plugin.manifest.displayName || plugin.manifest.name}
                <Tag>v{plugin.version}</Tag>
                {!plugin.enabled && <Tag color="default">已禁用</Tag>}
              </Space>
            }
            description={
              <Space direction="vertical" size={0}>
                <Text type="secondary">{plugin.manifest.description}</Text>
                <Space size={4}>
                  {plugin.manifest.tags?.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                  <Tag color="blue">{plugin.manifest.category}</Tag>
                </Space>
              </Space>
            }
          />
        </List.Item>
      )}
    />
  );
}

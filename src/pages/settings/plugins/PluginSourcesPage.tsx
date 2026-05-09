import { useEffect, useState } from 'react';
import { Form, Input, List, Modal, Select, Switch, Tag, Button, Popconfirm, message, Space } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { usePluginStore } from '../../../store';
import type { PluginSource } from '../../../types';

type SourceFormValues = Omit<PluginSource, 'id' | 'lastSyncAt' | 'official'>;

export default function PluginSourcesPage() {
  const { sources, addSource, updateSource, removeSource, syncSource, toggleSource } = usePluginStore();
  const [form] = Form.useForm<SourceFormValues>();
  const [editing, setEditing] = useState<PluginSource | null>(null);
  const [open, setOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        name: editing.name,
        type: editing.type,
        url: editing.url,
        enabled: editing.enabled,
      });
    } else {
      form.setFieldsValue({
        name: '',
        type: 'custom-registry',
        url: '',
        enabled: true,
      });
    }
  }, [editing, form, open]);

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      await syncSource(id);
      message.success('同步成功');
    } catch (error) {
      message.error((error as Error).message || '同步失败');
    } finally {
      setSyncingId(null);
    }
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editing) {
      updateSource(editing.id, values);
      message.success('插件源已更新');
    } else {
      addSource(values);
      message.success('插件源已添加');
    }
    setOpen(false);
  };

  return (
    <div>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        style={{ marginBottom: 16 }}
        onClick={() => {
          setEditing(null);
          setOpen(true);
        }}
      >
        添加插件源
      </Button>

      <List
        dataSource={sources}
        renderItem={(source) => (
          <List.Item
            extra={
              <Space size={8} wrap>
                <Tag color={source.official ? 'gold' : 'default'}>
                  {source.official ? '官方' : source.type}
                </Tag>
                <Switch
                  size="small"
                  checked={source.enabled}
                  onChange={() => toggleSource(source.id)}
                  checkedChildren="启用"
                  unCheckedChildren="停用"
                />
                {source.lastSyncAt && (
                  <span className="settings-muted">最后同步: {new Date(source.lastSyncAt).toLocaleString()}</span>
                )}
                <Button
                  size="small"
                  icon={<SyncOutlined />}
                  loading={syncingId === source.id}
                  onClick={() => handleSync(source.id)}
                >
                  同步
                </Button>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(source);
                    setOpen(true);
                  }}
                >
                  编辑
                </Button>
                {!source.official && (
                  <Popconfirm title="确认删除插件源？" onConfirm={() => removeSource(source.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            }
          >
            <List.Item.Meta
              title={
                <Space>
                  {source.name}
                  {!source.enabled && <Tag color="default">已停用</Tag>}
                </Space>
              }
              description={source.url}
            />
          </List.Item>
        )}
      />

      <Modal
        title={editing ? '编辑插件源' : '添加插件源'}
        open={open}
        onOk={handleSubmit}
        onCancel={() => setOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入插件源名称' }]}>
            <Input placeholder="我的插件源" />
          </Form.Item>
          <Form.Item label="类型" name="type" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="official-registry">官方注册表</Select.Option>
              <Select.Option value="github-registry">GitHub 注册表</Select.Option>
              <Select.Option value="custom-registry">自定义注册表</Select.Option>
              <Select.Option value="enterprise-registry">企业注册表</Select.Option>
              <Select.Option value="local">本地目录</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="地址" name="url" rules={[{ required: true, message: '请输入插件源地址' }]}>
            <Input placeholder="https://example.com/registry.json" />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Form, Input, List, Modal, Select, Switch, Tag, Button, Popconfirm, message, Space } from 'antd';
import { PlusOutlined, SyncOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { usePluginStore, useSettingsStore } from '../../../store';
import type { PluginSource } from '../../../types';
import { translateText } from '../../../i18n';

type SourceFormValues = Omit<PluginSource, 'id' | 'lastSyncAt' | 'official'>;

export default function PluginSourcesPage() {
  const { sources, addSource, updateSource, removeSource, syncSource, toggleSource } = usePluginStore();
  const language = useSettingsStore(s => s.general.language);
  const [form] = Form.useForm<SourceFormValues>();
  const [editing, setEditing] = useState<PluginSource | null>(null);
  const [open, setOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);
  const sourceTypeLabels: Record<string, string> = {
    'official-registry': t('官方注册表'),
    'github-registry': t('GitHub 注册表'),
    'custom-registry': t('自定义注册表'),
    'enterprise-registry': t('企业注册表'),
    local: t('本地目录'),
  };

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
      message.success(t('同步成功'));
    } catch (error) {
      message.error((error as Error).message || t('同步失败'));
    } finally {
      setSyncingId(null);
    }
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editing) {
      updateSource(editing.id, values);
      message.success(t('插件源已更新'));
    } else {
      addSource(values);
      message.success(t('插件源已添加'));
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
        {t('添加插件源')}
      </Button>

      <List
        dataSource={sources}
        renderItem={(source) => (
          <List.Item
            extra={
              <Space size={8} wrap>
                <Tag color={source.official ? 'gold' : 'default'}>
                  {source.official ? t('官方') : sourceTypeLabels[source.type] || source.type}
                </Tag>
                <Switch
                  size="small"
                  checked={source.enabled}
                  onChange={() => toggleSource(source.id)}
                  checkedChildren={t('启用')}
                  unCheckedChildren={t('停用')}
                />
                {source.lastSyncAt && (
                  <span className="settings-muted">{t('最后同步: {time}', { time: new Date(source.lastSyncAt).toLocaleString(language) })}</span>
                )}
                <Button
                  size="small"
                  icon={<SyncOutlined />}
                  loading={syncingId === source.id}
                  onClick={() => handleSync(source.id)}
                >
                  {t('同步')}
                </Button>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(source);
                    setOpen(true);
                  }}
                >
                  {t('编辑')}
                </Button>
                {!source.official && (
                  <Popconfirm title={t('确认删除插件源？')} onConfirm={() => removeSource(source.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />}>
                      {t('删除')}
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            }
          >
            <List.Item.Meta
              title={
                <Space>
                  {source.official ? t('官方插件源') : source.name}
                  {!source.enabled && <Tag color="default">{t('已停用')}</Tag>}
                </Space>
              }
              description={source.url}
            />
          </List.Item>
        )}
      />

      <Modal
        title={editing ? t('编辑插件源') : t('添加插件源')}
        open={open}
        onOk={handleSubmit}
        onCancel={() => setOpen(false)}
        okText={t('保存')}
        cancelText={t('取消')}
      >
        <Form form={form} layout="vertical">
          <Form.Item label={t('名称')} name="name" rules={[{ required: true, message: t('请输入插件源名称') }]}>
            <Input placeholder={t('我的插件源')} />
          </Form.Item>
          <Form.Item label={t('类型')} name="type" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="official-registry">{t('官方注册表')}</Select.Option>
              <Select.Option value="github-registry">{t('GitHub 注册表')}</Select.Option>
              <Select.Option value="custom-registry">{t('自定义注册表')}</Select.Option>
              <Select.Option value="enterprise-registry">{t('企业注册表')}</Select.Option>
              <Select.Option value="local">{t('本地目录')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label={t('地址')} name="url" rules={[{ required: true, message: t('请输入插件源地址') }]}>
            <Input placeholder="https://example.com/registry.json" />
          </Form.Item>
          <Form.Item label={t('启用')} name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

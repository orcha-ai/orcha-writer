import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, List, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ExperimentOutlined } from '@ant-design/icons';
import { useAiStore } from '../../../store';
import type { AiModelConfig, AiProviderConfig } from '../../../types';

const { Text } = Typography;

type ProviderFormValues = Omit<AiProviderConfig, 'id'>;
type ModelFormValues = Omit<AiModelConfig, 'id'>;

export default function AiModelConfigPage() {
  const {
    providers,
    models,
    addProvider,
    updateProvider,
    removeProvider,
    toggleProvider,
    addModel,
    updateModel,
    removeModel,
    toggleModel,
  } = useAiStore();
  const [providerForm] = Form.useForm<ProviderFormValues>();
  const [modelForm] = Form.useForm<ModelFormValues>();
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AiProviderConfig | null>(null);
  const [editingModel, setEditingModel] = useState<AiModelConfig | null>(null);

  useEffect(() => {
    if (!providerModalOpen) return;
    providerForm.setFieldsValue(editingProvider || {
      name: '',
      type: 'openai-compatible',
      baseUrl: '',
      credentialRef: '',
      enabled: true,
    });
  }, [editingProvider, providerForm, providerModalOpen]);

  useEffect(() => {
    if (!modelModalOpen) return;
    modelForm.setFieldsValue(editingModel || {
      name: '',
      providerId: providers[0]?.id || '',
      model: '',
      temperature: 0.7,
      topP: 1,
      maxTokens: 4096,
      thinkingEnabled: false,
      enabled: true,
    });
  }, [editingModel, modelForm, modelModalOpen, providers]);

  const handleProviderSubmit = async () => {
    const values = await providerForm.validateFields();
    if (editingProvider) {
      updateProvider(editingProvider.id, values);
      message.success('供应商已更新');
    } else {
      addProvider(values);
      message.success('供应商已添加');
    }
    setProviderModalOpen(false);
  };

  const handleModelSubmit = async () => {
    const values = await modelForm.validateFields();
    if (editingModel) {
      updateModel(editingModel.id, values);
      message.success('模型配置已更新');
    } else {
      addModel(values);
      message.success('模型配置已添加');
    }
    setModelModalOpen(false);
  };

  const handleTestProvider = (provider: AiProviderConfig) => {
    if (!provider.baseUrl.trim()) {
      message.warning('请先配置 API 地址');
      return;
    }
    message.success(`${provider.name} 参数完整，可用于后续连接测试`);
  };

  const providerColumns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 140 },
    { title: '类型', dataIndex: 'type', key: 'type', width: 160, render: (type: string) => <Tag>{type}</Tag> },
    { title: 'API 地址', dataIndex: 'baseUrl', key: 'baseUrl', ellipsis: true, width: 320 },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      render: (_: boolean, record: AiProviderConfig) => (
        <Switch size="small" checked={record.enabled} onChange={() => toggleProvider(record.id)} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      fixed: 'right' as const,
      render: (_: unknown, record: AiProviderConfig) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            type="text"
            onClick={() => {
              setEditingProvider(record);
              setProviderModalOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm title="确认删除？相关模型和智能体也会移除。" onConfirm={() => removeProvider(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} type="text">删除</Button>
          </Popconfirm>
          <Button size="small" icon={<ExperimentOutlined />} type="text" onClick={() => handleTestProvider(record)}>
            测试
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="模型供应商"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingProvider(null);
              setProviderModalOpen(true);
            }}
          >
            添加供应商
          </Button>
        }
      >
        <Table
          columns={providerColumns}
          dataSource={providers}
          rowKey="id"
          pagination={false}
          size="small"
          scroll={{ x: 860 }}
        />
      </Card>

      <Card
        title="模型配置"
        style={{ marginTop: 16 }}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={providers.length === 0}
            onClick={() => {
              setEditingModel(null);
              setModelModalOpen(true);
            }}
          >
            添加模型
          </Button>
        }
      >
        {models.length === 0 ? (
          <Text type="secondary">暂无模型配置，请先添加供应商</Text>
        ) : (
          <List
            dataSource={models}
            renderItem={(model) => (
              <List.Item
                actions={[
                  <Switch size="small" checked={model.enabled} onChange={() => toggleModel(model.id)} />,
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    type="text"
                    onClick={() => {
                      setEditingModel(model);
                      setModelModalOpen(true);
                    }}
                  >
                    编辑
                  </Button>,
                  <Popconfirm title="确认删除模型配置？" onConfirm={() => removeModel(model.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} type="text">删除</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      {model.name}
                      <Tag>{model.model}</Tag>
                      {!model.enabled && <Tag color="default">已禁用</Tag>}
                    </Space>
                  }
                  description={`供应商: ${providers.find((p) => p.id === model.providerId)?.name || model.providerId}`}
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Modal
        title={editingProvider ? '编辑供应商' : '添加供应商'}
        open={providerModalOpen}
        onOk={handleProviderSubmit}
        onCancel={() => setProviderModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={providerForm} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入供应商名称' }]}>
            <Input placeholder="OpenAI" />
          </Form.Item>
          <Form.Item label="类型" name="type" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="openai-compatible">OpenAI Compatible</Select.Option>
              <Select.Option value="anthropic">Anthropic</Select.Option>
              <Select.Option value="gemini">Gemini</Select.Option>
              <Select.Option value="ollama">Ollama</Select.Option>
              <Select.Option value="custom">Custom</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="API 地址" name="baseUrl" rules={[{ required: true, message: '请输入 API 地址' }]}>
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item label="凭据引用" name="credentialRef">
            <Input placeholder="如 secret:openai-api-key" />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingModel ? '编辑模型配置' : '添加模型配置'}
        open={modelModalOpen}
        onOk={handleModelSubmit}
        onCancel={() => setModelModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={modelForm} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入配置名称' }]}>
            <Input placeholder="GPT 写作助手" />
          </Form.Item>
          <Form.Item label="供应商" name="providerId" rules={[{ required: true, message: '请选择供应商' }]}>
            <Select>
              {providers.map((provider) => (
                <Select.Option key={provider.id} value={provider.id}>
                  {provider.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="模型 ID" name="model" rules={[{ required: true, message: '请输入模型 ID' }]}>
            <Input placeholder="gpt-5.2" />
          </Form.Item>
          <Form.Item label="Temperature" name="temperature">
            <InputNumber min={0} max={2} step={0.1} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item label="Top P" name="topP">
            <InputNumber min={0} max={1} step={0.05} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item label="最大 Tokens" name="maxTokens">
            <InputNumber min={256} max={200000} step={256} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item label="思考模式" name="thinkingEnabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

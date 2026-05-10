import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, List, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ExperimentOutlined } from '@ant-design/icons';
import { useAiStore } from '../../../store';
import type { AiModelConfig, AiProviderConfig } from '../../../types';

const { Text } = Typography;

type ProviderFormValues = Omit<AiProviderConfig, 'id'>;
type ModelFormValues = Omit<AiModelConfig, 'id'>;

const PROVIDER_TYPE_LABELS: Record<AiProviderConfig['type'], string> = {
  'openai-compatible': 'OpenAI Compatible',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  ollama: 'Ollama',
  custom: 'Custom',
};

const PROVIDER_ENDPOINT_HINTS: Record<AiProviderConfig['type'], { placeholder: string; extra: string }> = {
  'openai-compatible': {
    placeholder: 'https://api.openai.com/v1/chat/completions',
    extra: '填写完整 Chat Completions 请求地址，程序不会再自动拼接路径。',
  },
  anthropic: {
    placeholder: 'https://api.anthropic.com/v1/messages',
    extra: '填写完整 Messages 请求地址，请在凭据引用里配置 Anthropic API Key。',
  },
  gemini: {
    placeholder: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    extra: '填写完整 generateContent 请求地址；API Key 可填凭据引用，也可自行放在 URL 查询参数里。',
  },
  ollama: {
    placeholder: 'http://localhost:11434/api/chat',
    extra: '填写完整 Ollama Chat 请求地址，本地 Ollama 通常不需要凭据。',
  },
  custom: {
    placeholder: 'https://example.com/api/chat',
    extra: '填写完整自定义请求地址；Custom 会按 OpenAI 风格发送，并尽量解析常见返回字段。',
  },
};

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
  const thinkingSupported = Form.useWatch('thinkingSupported', modelForm);
  const providerType = Form.useWatch('type', providerForm) || editingProvider?.type || 'openai-compatible';
  const endpointHint = PROVIDER_ENDPOINT_HINTS[providerType];

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
    const modelValues = editingModel
      ? {
          ...editingModel,
          thinkingSupported: editingModel.thinkingSupported ?? Boolean(editingModel.thinkingEnabled),
        }
      : {
          name: '',
          providerId: providers[0]?.id || '',
          model: '',
          temperature: 0.7,
          topP: 1,
          maxTokens: 4096,
          thinkingSupported: false,
          thinkingEnabled: false,
          thinkingBudget: undefined,
          enabled: true,
        };
    modelForm.setFieldsValue(modelValues);
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
    const modelValues = {
      ...values,
      thinkingEnabled: values.thinkingSupported ? Boolean(values.thinkingEnabled) : false,
      thinkingBudget: values.thinkingSupported ? values.thinkingBudget : undefined,
    };
    if (editingModel) {
      updateModel(editingModel.id, modelValues);
      message.success('模型配置已更新');
    } else {
      addModel(modelValues);
      message.success('模型配置已添加');
    }
    setModelModalOpen(false);
  };

  const handleTestProvider = (provider: AiProviderConfig) => {
    if (!provider.baseUrl.trim()) {
      message.warning('请先配置请求地址');
      return;
    }
    message.success(`${provider.name} 参数完整，可用于后续连接测试`);
  };

  const providerColumns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 140 },
    { title: '类型', dataIndex: 'type', key: 'type', width: 160, render: (type: AiProviderConfig['type']) => <Tag>{PROVIDER_TYPE_LABELS[type] || type}</Tag> },
    { title: '请求地址', dataIndex: 'baseUrl', key: 'baseUrl', ellipsis: true, width: 320 },
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
                      {model.thinkingSupported && (
                        <Tag color={model.thinkingEnabled ? 'blue' : 'default'}>
                          {model.thinkingEnabled ? '默认深度思考' : '支持深度思考'}
                        </Tag>
                      )}
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
              {Object.entries(PROVIDER_TYPE_LABELS).map(([value, label]) => (
                <Select.Option key={value} value={value}>{label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="请求地址"
            name="baseUrl"
            rules={[{ required: true, message: '请输入请求地址' }]}
            extra={endpointHint.extra}
          >
            <Input placeholder={endpointHint.placeholder} />
          </Form.Item>
          <Form.Item
            label="凭据引用"
            name="credentialRef"
            extra="支持 env:环境变量名 或临时填入 API Key；Ollama / Custom 可留空。"
          >
            <Input placeholder="如 env:DASHSCOPE_API_KEY，或临时填入 API Key" />
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
          <Form.Item label="支持深度思考" name="thinkingSupported" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            label="默认开启深度思考"
            name="thinkingEnabled"
            valuePropName="checked"
            tooltip="打开后，输入框里的深度思考开关会随该模型默认开启。"
          >
            <Switch disabled={!thinkingSupported} />
          </Form.Item>
          <Form.Item
            label="思考预算 Tokens"
            name="thinkingBudget"
            tooltip="可选。留空表示使用模型默认思考预算。DashScope 兼容接口会发送 thinking_budget。"
          >
            <InputNumber
              min={256}
              max={200000}
              step={256}
              style={{ width: 160 }}
              disabled={!thinkingSupported}
              placeholder="模型默认"
            />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

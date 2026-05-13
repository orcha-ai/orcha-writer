import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button, Card, Drawer, Form, Input, InputNumber, List, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ExperimentOutlined } from '@ant-design/icons';
import { useAiStore, useSettingsStore } from '../../../store';
import type { AiModelConfig, AiProviderConfig } from '../../../types';
import { translateText } from '../../../i18n';

const { Text } = Typography;

type ProviderFormValues = Omit<AiProviderConfig, 'id'>;
type ModelFormValues = Omit<AiModelConfig, 'id'>;

interface NativeAIChatResponse {
  content: string;
  model?: string;
}

const PROVIDER_TYPE_LABELS: Record<AiProviderConfig['type'], string> = {
  'openai-compatible': 'OpenAI Compatible',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  ollama: 'Ollama',
  custom: 'Custom',
};

const PROVIDER_ENDPOINT_HINTS: Record<AiProviderConfig['type'], { placeholder: string; extra: string }> = {
  'openai-compatible': {
    placeholder: 'https://api.openai.com/v1',
    extra: '填写 OpenAI 兼容接口基础地址即可，程序会统一补 /chat/completions；如果已包含该路径则不会重复拼接。',
  },
  anthropic: {
    placeholder: 'https://api.anthropic.com/v1/messages',
    extra: '按服务商要求填写请求地址，程序会按原样请求；请在凭据引用里配置 Anthropic API Key。',
  },
  gemini: {
    placeholder: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    extra: '按服务商要求填写请求地址，程序会按原样请求；API Key 可填凭据引用，也可自行放在 URL 查询参数里。',
  },
  ollama: {
    placeholder: 'http://localhost:11434/api/chat',
    extra: '按服务商要求填写请求地址，程序会按原样请求；本地 Ollama 通常不需要凭据。',
  },
  custom: {
    placeholder: 'https://example.com/api/chat',
    extra: '按服务端要求填写请求地址，程序会按原样请求；Custom 会按 OpenAI 风格发送，并尽量解析常见返回字段。',
  },
};

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function requiresCredential(providerType: AiProviderConfig['type']): boolean {
  return providerType === 'openai-compatible' || providerType === 'anthropic';
}

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
  const language = useSettingsStore(s => s.general.language);
  const [providerForm] = Form.useForm<ProviderFormValues>();
  const [modelForm] = Form.useForm<ModelFormValues>();
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AiProviderConfig | null>(null);
  const [editingModel, setEditingModel] = useState<AiModelConfig | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const thinkingSupported = Form.useWatch('thinkingSupported', modelForm);
  const providerType = Form.useWatch('type', providerForm) || editingProvider?.type || 'openai-compatible';
  const endpointHint = PROVIDER_ENDPOINT_HINTS[providerType];
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);

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
    try {
      if (editingProvider) {
        await updateProvider(editingProvider.id, values);
        message.success(t('供应商已更新'));
      } else {
        await addProvider(values);
        message.success(t('供应商已添加'));
      }
      setProviderModalOpen(false);
    } catch (error) {
      message.error(t('保存失败：{error}', { error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const handleModelSubmit = async () => {
    const values = await modelForm.validateFields();
    const modelValues = {
      ...values,
      thinkingEnabled: values.thinkingSupported ? Boolean(values.thinkingEnabled) : false,
      thinkingBudget: values.thinkingSupported ? values.thinkingBudget : undefined,
    };
    try {
      if (editingModel) {
        await updateModel(editingModel.id, modelValues);
        message.success(t('模型配置已更新'));
      } else {
        await addModel(modelValues);
        message.success(t('模型配置已添加'));
      }
      setModelModalOpen(false);
    } catch (error) {
      message.error(t('保存失败：{error}', { error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const testModelConnection = async (provider: AiProviderConfig, model: AiModelConfig) => {
    const response = await invoke<NativeAIChatResponse>('ai_send_chat', {
      request: {
        providerType: provider.type,
        apiUrl: provider.baseUrl,
        credentialRef: provider.credentialRef?.trim() || undefined,
        model: model.model,
        messages: [
          { role: 'system', content: translateText(language, '你是 Orcha Writer 的模型连接测试。只回复 OK。') },
          { role: 'user', content: translateText(language, '回复 OK') },
        ],
        temperature: 0,
        topP: 1,
        maxTokens: 32,
        enableThinking: false,
      },
    });
    return response;
  };

  const validateProviderForTest = (provider: AiProviderConfig): boolean => {
    if (!provider.baseUrl.trim()) {
      message.warning(t('请先配置请求地址'));
      return false;
    }
    if (!isTauriRuntime()) {
      message.warning(t('当前不是 Tauri 运行环境，无法发起真实连接测试'));
      return false;
    }
    if (requiresCredential(provider.type) && !provider.credentialRef?.trim()) {
      message.warning(t('模型凭据未配置，请先填写凭据引用或 API Key'));
      return false;
    }
    return true;
  };

  const handleTestProvider = async (provider: AiProviderConfig) => {
    if (!validateProviderForTest(provider)) return;

    const model = models.find((item) => item.providerId === provider.id && item.enabled) ||
      models.find((item) => item.providerId === provider.id);
    if (!model) {
      message.warning(t('请先为该供应商添加模型配置，再执行真实连接测试'));
      return;
    }

    setTestingProviderId(provider.id);
    try {
      const response = await testModelConnection(provider, model);
      message.success(t('{name} 真实连接成功，使用模型：{model}', { name: provider.name, model: response.model || model.model }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleTestModel = async (model: AiModelConfig) => {
    const provider = providers.find((item) => item.id === model.providerId);
    if (!provider) {
      message.warning(t('模型对应的供应商不存在，请重新选择供应商'));
      return;
    }
    if (!validateProviderForTest(provider)) return;

    setTestingModelId(model.id);
    try {
      const response = await testModelConnection(provider, model);
      message.success(t('{name} 真实连接成功，模型：{model}', { name: model.name, model: response.model || model.model }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTestingModelId(null);
    }
  };

  const providerColumns = [
    { title: t('名称'), dataIndex: 'name', key: 'name', width: 140 },
    { title: t('类型'), dataIndex: 'type', key: 'type', width: 160, render: (type: AiProviderConfig['type']) => <Tag>{PROVIDER_TYPE_LABELS[type] || type}</Tag> },
    { title: t('请求地址'), dataIndex: 'baseUrl', key: 'baseUrl', ellipsis: true, width: 320 },
    {
      title: t('状态'),
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      render: (_: boolean, record: AiProviderConfig) => (
        <Switch size="small" checked={record.enabled} onChange={() => toggleProvider(record.id)} />
      ),
    },
    {
      title: t('操作'),
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
            {t('编辑')}
          </Button>
          <Popconfirm title={t('确认删除？相关模型和智能体也会移除。')} onConfirm={() => removeProvider(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} type="text">{t('删除')}</Button>
          </Popconfirm>
          <Button
            size="small"
            icon={<ExperimentOutlined />}
            type="text"
            loading={testingProviderId === record.id}
            disabled={Boolean(testingProviderId && testingProviderId !== record.id)}
            onClick={() => handleTestProvider(record)}
          >
            {t('测试')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={t('模型供应商')}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingProvider(null);
              setProviderModalOpen(true);
            }}
          >
            {t('添加供应商')}
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
        title={t('模型配置')}
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
            {t('添加模型')}
          </Button>
        }
      >
        {models.length === 0 ? (
          <Text type="secondary">{t('暂无模型配置，请先添加供应商')}</Text>
        ) : (
          <List
            dataSource={models}
            renderItem={(model) => (
              <List.Item
                actions={[
                  <Switch size="small" checked={model.enabled} onChange={() => toggleModel(model.id)} />,
                  <Button
                    size="small"
                    icon={<ExperimentOutlined />}
                    type="text"
                    loading={testingModelId === model.id}
                    disabled={Boolean(testingProviderId || (testingModelId && testingModelId !== model.id))}
                    onClick={() => handleTestModel(model)}
                  >
                    {t('测试')}
                  </Button>,
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    type="text"
                    onClick={() => {
                      setEditingModel(model);
                      setModelModalOpen(true);
                    }}
                  >
                    {t('编辑')}
                  </Button>,
                  <Popconfirm title={t('确认删除模型配置？')} onConfirm={() => removeModel(model.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} type="text">{t('删除')}</Button>
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
                          {model.thinkingEnabled ? t('默认深度思考') : t('支持深度思考')}
                        </Tag>
                      )}
                      {!model.enabled && <Tag color="default">{t('已禁用')}</Tag>}
                    </Space>
                  }
                  description={t('供应商: {provider}', { provider: providers.find((p) => p.id === model.providerId)?.name || model.providerId })}
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Modal
        title={editingProvider ? t('编辑供应商') : t('添加供应商')}
        open={providerModalOpen}
        onOk={handleProviderSubmit}
        onCancel={() => setProviderModalOpen(false)}
        okText={t('保存')}
        cancelText={t('取消')}
      >
        <Form form={providerForm} layout="vertical">
          <Form.Item label={t('名称')} name="name" rules={[{ required: true, message: t('请输入供应商名称') }]}>
            <Input placeholder="OpenAI" />
          </Form.Item>
          <Form.Item label={t('类型')} name="type" rules={[{ required: true }]}>
            <Select>
              {Object.entries(PROVIDER_TYPE_LABELS).map(([value, label]) => (
                <Select.Option key={value} value={value}>{label}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label={t('请求地址')}
            name="baseUrl"
            rules={[{ required: true, message: t('请输入请求地址') }]}
            extra={
              <Text type="secondary">{t(endpointHint.extra)}</Text>
            }
          >
            <Input placeholder={endpointHint.placeholder} />
          </Form.Item>
          <Form.Item
            label={t('凭据引用')}
            name="credentialRef"
            extra={t('支持 env:环境变量名 或临时填入 API Key；Ollama / Custom 可留空。')}
          >
            <Input placeholder={t('如 env:DASHSCOPE_API_KEY，或临时填入 API Key')} />
          </Form.Item>
          <Form.Item label={t('启用')} name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={editingModel ? t('编辑模型配置') : t('添加模型配置')}
        open={modelModalOpen}
        onClose={() => setModelModalOpen(false)}
        width={520}
        extra={
          <Space>
            <Button onClick={() => setModelModalOpen(false)}>{t('取消')}</Button>
            <Button type="primary" onClick={handleModelSubmit}>{t('保存')}</Button>
          </Space>
        }
      >
        <Form form={modelForm} layout="vertical">
          <Form.Item label={t('名称')} name="name" rules={[{ required: true, message: t('请输入配置名称') }]}>
            <Input placeholder={t('GPT 写作助手')} />
          </Form.Item>
          <Form.Item label={t('供应商')} name="providerId" rules={[{ required: true, message: t('请选择供应商') }]}>
            <Select>
              {providers.map((provider) => (
                <Select.Option key={provider.id} value={provider.id}>
                  {provider.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label={t('模型 ID')} name="model" rules={[{ required: true, message: t('请输入模型 ID') }]}>
            <Input placeholder="gpt-5.2" />
          </Form.Item>
          <Form.Item label="Temperature" name="temperature">
            <InputNumber min={0} max={2} step={0.1} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item label="Top P" name="topP">
            <InputNumber min={0} max={1} step={0.05} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item label={t('最大 Tokens')} name="maxTokens">
            <InputNumber min={256} max={200000} step={256} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item label={t('支持深度思考')} name="thinkingSupported" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            label={t('默认开启深度思考')}
            name="thinkingEnabled"
            valuePropName="checked"
            tooltip={t('打开后，输入框里的深度思考开关会随该模型默认开启。')}
          >
            <Switch disabled={!thinkingSupported} />
          </Form.Item>
          <Form.Item
            label={t('思考预算 Tokens')}
            name="thinkingBudget"
            tooltip={t('可选。留空表示使用模型默认思考预算。DashScope 兼容接口会发送 thinking_budget。')}
          >
            <InputNumber
              min={256}
              max={200000}
              step={256}
              style={{ width: 160 }}
              disabled={!thinkingSupported}
              placeholder={t('模型默认')}
            />
          </Form.Item>
          <Form.Item label={t('启用')} name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}

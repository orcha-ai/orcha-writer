import { useEffect, useMemo, useState } from 'react';
import { Card, List, Button, Space, Switch, Popconfirm, Tag, Typography, Drawer, Form, Input, Select, Checkbox, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useAiStore, useSettingsStore } from '../../../store';
import type { AgentCapability, AgentConfig, AiModelConfig, AiProviderConfig } from '../../../types';
import { translateText } from '../../../i18n';

const { Text } = Typography;

const CAPABILITIES: AgentCapability[] = [
  { code: 'rewrite', name: '改写润色', enabled: true },
  { code: 'summarize', name: '摘要提炼', enabled: true },
  { code: 'translate', name: '翻译', enabled: true },
  { code: 'outline', name: '大纲生成', enabled: true },
  { code: 'markdown_format', name: 'Markdown 格式', enabled: true },
];

type AgentFormValues = Omit<AgentConfig, 'id' | 'capabilities' | 'modelConfigId'> & {
  providerId?: string;
  modelConfigId?: string;
  capabilityCodes: string[];
};

function providerTypeLabel(type: AiProviderConfig['type']): string {
  const labels: Record<AiProviderConfig['type'], string> = {
    'openai-compatible': 'OpenAI Compatible',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
    ollama: 'Ollama',
    custom: 'Custom',
  };
  return labels[type] || type;
}

function modelDisplayName(model: AiModelConfig): string {
  return model.name === model.model ? model.model : `${model.name} (${model.model})`;
}

function toFormValues(agent: AgentConfig | null, fallbackModelId: string, models: AiModelConfig[], providers: AiProviderConfig[]): AgentFormValues {
  const selectedModelId = agent?.modelConfigId || fallbackModelId || undefined;
  const selectedModel = selectedModelId ? models.find((model) => model.id === selectedModelId) : undefined;
  const fallbackProviderId = selectedModel?.providerId || providers[0]?.id || undefined;

  return {
    name: agent?.name || '',
    icon: agent?.icon || '',
    description: agent?.description || '',
    providerId: fallbackProviderId,
    modelConfigId: selectedModelId,
    systemPrompt: agent?.systemPrompt || '',
    enabled: agent?.enabled ?? true,
    accessScope: agent?.accessScope || 'current-document',
    capabilityCodes: agent?.capabilities.filter((item) => item.enabled).map((item) => item.code) || ['rewrite', 'summarize'],
  };
}

export default function AgentConfigPage() {
  const { agents, providers, models, addAgent, updateAgent, toggleAgent, removeAgent } = useAiStore();
  const language = useSettingsStore(s => s.general.language);
  const [form] = Form.useForm<AgentFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AgentConfig | null>(null);
  const providerId = Form.useWatch('providerId', form);
  const t = (value: string, params?: Record<string, string | number>) => translateText(language, value, params);

  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers]);
  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);
  const modelsForSelectedProvider = useMemo(
    () => models.filter((model) => model.providerId === providerId),
    [models, providerId],
  );

  useEffect(() => {
    if (!open) return;
    const fallbackModel = models.find((model) => model.enabled) || models[0];
    form.setFieldsValue(toFormValues(editing, fallbackModel?.id || '', models, providers));
  }, [editing, form, models, open, providers]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    const capabilities = CAPABILITIES.map((capability) => ({
      ...capability,
      enabled: values.capabilityCodes.includes(capability.code),
    }));
    const payload = {
      name: values.name,
      icon: values.icon,
      description: values.description,
      modelConfigId: values.modelConfigId || '',
      systemPrompt: values.systemPrompt,
      enabled: values.enabled,
      accessScope: values.accessScope,
      capabilities,
    };

    try {
      if (editing) {
        await updateAgent(editing.id, payload);
        message.success(t('智能体已更新'));
      } else {
        await addAgent(payload);
        message.success(t('智能体已创建'));
      }
      setOpen(false);
    } catch (error) {
      message.error(t('保存失败：{error}', { error: error instanceof Error ? error.message : String(error) }));
    }
  };

  const handleProviderChange = (nextProviderId: string) => {
    const nextModel = models.find((model) => model.providerId === nextProviderId && model.enabled) ||
      models.find((model) => model.providerId === nextProviderId);
    form.setFieldValue('modelConfigId', nextModel?.id);
  };

  return (
    <div>
      <Card
        title={t('智能体列表')}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            {t('新建智能体')}
          </Button>
        }
      >
        {agents.length === 0 ? (
          <Text type="secondary">{t('暂无智能体配置')}</Text>
        ) : (
          <List
            dataSource={agents}
            renderItem={(agent) => (
              <List.Item
                actions={[
                  <Switch size="small" checked={agent.enabled} onChange={() => toggleAgent(agent.id)} />,
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    type="text"
                    onClick={() => {
                      setEditing(agent);
                      setOpen(true);
                    }}
                  >
                    {t('编辑')}
                  </Button>,
                  <Popconfirm title={t('确认删除？')} onConfirm={() => removeAgent(agent.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} type="text">{t('删除')}</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      {agent.icon}
                      {t(agent.name)}
                      <Tag>{agent.accessScope}</Tag>
                      {agent.modelConfigId && (() => {
                        const model = modelById.get(agent.modelConfigId);
                        const provider = model ? providerById.get(model.providerId) : undefined;
                        return (
                          <Tag>
                            {model ? `${provider?.name || t('厂商已删除')} / ${modelDisplayName(model)}` : t('模型已删除')}
                          </Tag>
                        );
                      })()}
                      {!agent.enabled && <Tag color="default">{t('已禁用')}</Tag>}
                    </Space>
                  }
                  description={agent.description ? t(agent.description) : `${t(agent.systemPrompt.substring(0, 100))}...`}
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Drawer
        title={editing ? t('编辑智能体') : t('新建智能体')}
        open={open}
        onClose={() => setOpen(false)}
        width={560}
        extra={
          <Space>
            <Button onClick={() => setOpen(false)}>{t('取消')}</Button>
            <Button type="primary" onClick={handleSubmit}>{t('保存')}</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item label={t('名称')} name="name" rules={[{ required: true, message: t('请输入智能体名称') }]}>
            <Input placeholder={t('写作助手')} />
          </Form.Item>
          <Form.Item label={t('图标')} name="icon">
            <Input placeholder={t('如 W / AI / ✦')} />
          </Form.Item>
          <Form.Item label={t('描述')} name="description">
            <Input placeholder={t('用于说明该智能体的主要用途')} />
          </Form.Item>
          <Form.Item
            label={t('大模型厂商')}
            name="providerId"
            rules={[{ required: true, message: t('请选择大模型厂商') }]}
            extra={t('先选择厂商，再从该厂商下选择具体模型配置。')}
          >
            <Select
              showSearch
              disabled={providers.length === 0}
              placeholder={providers.length === 0 ? t('暂无大模型厂商，请先到 AI 模型页添加供应商') : t('请选择大模型厂商')}
              optionFilterProp="label"
              onChange={handleProviderChange}
            >
              {providers.map((provider) => (
                <Select.Option key={provider.id} value={provider.id} label={`${provider.name} ${providerTypeLabel(provider.type)}`}>
                  <Space>
                    <span>{provider.name}</span>
                    <Tag>{providerTypeLabel(provider.type)}</Tag>
                    {!provider.enabled && <Tag color="default">{t('已禁用')}</Tag>}
                  </Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label={t('模型')}
            name="modelConfigId"
            rules={[{ required: true, message: t('请选择模型') }]}
          >
            <Select
              showSearch
              disabled={!providerId || modelsForSelectedProvider.length === 0}
              placeholder={
                !providerId
                  ? t('请先选择大模型厂商')
                  : modelsForSelectedProvider.length === 0
                    ? t('该厂商暂无模型配置')
                    : t('请选择模型')
              }
              optionFilterProp="label"
            >
              {modelsForSelectedProvider.map((model) => (
                <Select.Option key={model.id} value={model.id} label={`${model.name} ${model.model}`}>
                  <Space>
                    <span>{modelDisplayName(model)}</span>
                    {model.thinkingSupported && <Tag color="blue">{t('深度思考')}</Tag>}
                    {!model.enabled && <Tag color="default">{t('已禁用')}</Tag>}
                  </Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label={t('访问范围')} name="accessScope">
            <Select>
              <Select.Option value="selection">{t('当前选区')}</Select.Option>
              <Select.Option value="current-document">{t('当前文档')}</Select.Option>
              <Select.Option value="workspace">{t('整个工作区')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label={t('系统提示词')} name="systemPrompt" rules={[{ required: true, message: t('请输入系统提示词') }]}>
            <Input.TextArea rows={6} placeholder={t('定义智能体的角色、语气和行为边界')} />
          </Form.Item>
          <Form.Item label={t('能力')} name="capabilityCodes">
            <Checkbox.Group
              options={CAPABILITIES.map((capability) => ({
                label: t(capability.name),
                value: capability.code,
              }))}
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

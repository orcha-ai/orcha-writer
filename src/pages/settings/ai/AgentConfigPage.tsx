import { useEffect, useState } from 'react';
import { Card, List, Button, Space, Switch, Popconfirm, Tag, Typography, Modal, Form, Input, Select, Checkbox, message, Empty } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useAiStore } from '../../../store';
import type { AgentCapability, AgentConfig } from '../../../types';

const { Text } = Typography;

const CAPABILITIES: AgentCapability[] = [
  { code: 'rewrite', name: '改写润色', enabled: true },
  { code: 'summarize', name: '摘要提炼', enabled: true },
  { code: 'translate', name: '翻译', enabled: true },
  { code: 'outline', name: '大纲生成', enabled: true },
];

type AgentFormValues = Omit<AgentConfig, 'id' | 'capabilities'> & {
  capabilityCodes: string[];
};

function toFormValues(agent: AgentConfig | null, fallbackModelId: string): AgentFormValues {
  return {
    name: agent?.name || '',
    icon: agent?.icon || '',
    description: agent?.description || '',
    modelConfigId: agent?.modelConfigId || fallbackModelId,
    systemPrompt: agent?.systemPrompt || '',
    enabled: agent?.enabled ?? true,
    accessScope: agent?.accessScope || 'current-document',
    capabilityCodes: agent?.capabilities.filter((item) => item.enabled).map((item) => item.code) || ['rewrite', 'summarize'],
  };
}

export default function AgentConfigPage() {
  const { agents, models, addAgent, updateAgent, toggleAgent, removeAgent } = useAiStore();
  const [form] = Form.useForm<AgentFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AgentConfig | null>(null);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(toFormValues(editing, models[0]?.id || ''));
  }, [editing, form, models, open]);

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
      modelConfigId: values.modelConfigId,
      systemPrompt: values.systemPrompt,
      enabled: values.enabled,
      accessScope: values.accessScope,
      capabilities,
    };

    if (editing) {
      updateAgent(editing.id, payload);
      message.success('智能体已更新');
    } else {
      addAgent(payload);
      message.success('智能体已创建');
    }
    setOpen(false);
  };

  return (
    <div>
      <Card
        title="智能体列表"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={models.length === 0}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            新建智能体
          </Button>
        }
      >
        {models.length === 0 ? (
          <Empty description="请先在 AI 模型配置中添加模型" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : agents.length === 0 ? (
          <Text type="secondary">暂无智能体配置</Text>
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
                    编辑
                  </Button>,
                  <Popconfirm title="确认删除？" onConfirm={() => removeAgent(agent.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} type="text">删除</Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      {agent.icon}
                      {agent.name}
                      <Tag>{agent.accessScope}</Tag>
                      {!agent.enabled && <Tag color="default">已禁用</Tag>}
                    </Space>
                  }
                  description={agent.description || `${agent.systemPrompt.substring(0, 100)}...`}
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Modal
        title={editing ? '编辑智能体' : '新建智能体'}
        open={open}
        onOk={handleSubmit}
        onCancel={() => setOpen(false)}
        okText="保存"
        cancelText="取消"
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入智能体名称' }]}>
            <Input placeholder="写作助手" />
          </Form.Item>
          <Form.Item label="图标" name="icon">
            <Input placeholder="如 W / AI / ✦" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input placeholder="用于说明该智能体的主要用途" />
          </Form.Item>
          <Form.Item label="模型配置" name="modelConfigId" rules={[{ required: true, message: '请选择模型配置' }]}>
            <Select>
              {models.map((model) => (
                <Select.Option key={model.id} value={model.id}>
                  {model.name} ({model.model})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="访问范围" name="accessScope">
            <Select>
              <Select.Option value="selection">当前选区</Select.Option>
              <Select.Option value="current-document">当前文档</Select.Option>
              <Select.Option value="workspace">整个工作区</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="系统提示词" name="systemPrompt" rules={[{ required: true, message: '请输入系统提示词' }]}>
            <Input.TextArea rows={6} placeholder="定义智能体的角色、语气和行为边界" />
          </Form.Item>
          <Form.Item label="能力" name="capabilityCodes">
            <Checkbox.Group
              options={CAPABILITIES.map((capability) => ({
                label: capability.name,
                value: capability.code,
              }))}
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

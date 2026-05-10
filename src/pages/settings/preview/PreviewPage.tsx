import { Card, Form, Switch, InputNumber, Select, Button, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../../store';
import type { PreviewSettings } from '../../../types';
import { PREVIEW_THEMES, normalizePreviewThemeId } from '../../../previewThemes';
import { useEffect } from 'react';

export default function PreviewPage() {
  const { preview, updatePreview, saveAll } = useSettingsStore();
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue(preview);
  }, [form, preview]);

  const handleSave = async () => {
    const values = await form.validateFields() as Partial<PreviewSettings>;
    updatePreview({ ...values, previewTheme: normalizePreviewThemeId(values.previewTheme) });
    await saveAll();
    message.success('设置已保存');
  };

  return (
    <div>
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 4 }}
        wrapperCol={{ span: 12 }}
        initialValues={preview}
      >
        {/* Theme */}
        <Card title="预览主题" style={{ marginBottom: 16 }}>
          <Form.Item label="预览主题" name="previewTheme">
            <Select
              style={{ width: 200 }}
              options={PREVIEW_THEMES.map(theme => ({ value: theme.id, label: theme.label }))}
            />
          </Form.Item>

        </Card>

        {/* Behavior */}
        <Card title="预览行为" style={{ marginBottom: 16 }}>
          <Form.Item label="滚动同步" name="syncScroll" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="图片最大宽度" name="imageMaxWidth">
            <InputNumber min={200} max={1600} style={{ width: 140 }} suffix="px" />
          </Form.Item>

          <Form.Item label="外链打开方式" name="openExternalLink" valuePropName="checked">
            <Switch checkedChildren="新窗口" unCheckedChildren="当前页" />
          </Form.Item>

          <Form.Item label="HTML 渲染" name="htmlRender">
            <Select style={{ width: 200 }}>
              <Select.Option value="disable">禁用</Select.Option>
              <Select.Option value="safe">安全模式（过滤脚本）</Select.Option>
              <Select.Option value="all">允许全部</Select.Option>
            </Select>
          </Form.Item>
        </Card>
      </Form>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
          保存设置
        </Button>
      </div>
    </div>
  );
}

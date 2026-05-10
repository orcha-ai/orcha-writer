import { Card, Form, InputNumber, Select, Switch, Input, Button, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../../store';
import type { EditorSettingsV2 } from '../../../types';
import { useEffect } from 'react';

export default function EditorPage() {
  const { editor, updateEditor, saveAll } = useSettingsStore();
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue(editor);
  }, [editor, form]);

  const handleSave = async () => {
    const values = await form.validateFields() as Partial<EditorSettingsV2>;
    updateEditor(values);
    await saveAll();
    message.success('设置已保存');
  };

  return (
    <div>
      <Card>
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          initialValues={editor}
        >
          <Form.Item label="字体大小" name="fontSize">
            <InputNumber min={10} max={32} style={{ width: 120 }} suffix="px" />
          </Form.Item>

          <Form.Item label="字体" name="fontFamily">
            <Input style={{ width: 300 }} placeholder="system-ui, -apple-system, sans-serif" />
          </Form.Item>

          <Form.Item label="行高" name="lineHeight">
            <InputNumber min={1} max={3} step={0.1} style={{ width: 120 }} />
          </Form.Item>

          <Form.Item label="Tab 宽度" name="tabSize">
            <InputNumber min={2} max={8} style={{ width: 120 }} />
          </Form.Item>

          <Form.Item label="自动换行" name="autoWrap" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="显示行号" name="showLineNumbers" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="当前行高亮" name="highlightCurrentLine" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="拼写检查" name="spellCheck" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="自动补全" name="autoComplete" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="粘贴图片" name="pasteImageAction">
            <Select style={{ width: 240 }}>
              <Select.Option value="assets">保存到文档 .orcha-writer/resources</Select.Option>
              <Select.Option value="workspace-assets">保存到工作区 .orcha-writer/resources</Select.Option>
              <Select.Option value="original">插入为 Data URL</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Card>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
          保存设置
        </Button>
      </div>
    </div>
  );
}

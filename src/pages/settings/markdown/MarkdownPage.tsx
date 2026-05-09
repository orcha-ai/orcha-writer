import { Card, Form, Switch, Radio, Button, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../../store';
import type { MarkdownSettings } from '../../../types';
import { useEffect } from 'react';

export default function MarkdownPage() {
  const { markdown, updateMarkdown, saveAll } = useSettingsStore();
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue(markdown);
  }, [markdown, form]);

  const handleSave = async () => {
    const values = await form.validateFields() as Partial<MarkdownSettings>;
    updateMarkdown(values);
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
          initialValues={markdown}
        >
          <Form.Item label="Markdown 方言" name="dialect">
            <Radio.Group>
              <Radio.Button value="commonmark">CommonMark</Radio.Button>
              <Radio.Button value="gfm">GitHub Flavored Markdown</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item label="Front Matter" name="frontMatter" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="表格增强" name="tableEnhanced" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="Callout 块" name="callout" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="代码高亮" name="codeHighlight" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="目录生成" name="toc" valuePropName="checked">
            <Switch />
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

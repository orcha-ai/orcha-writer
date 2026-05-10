import { Card, Form, Select, Switch, InputNumber, Button, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../../store';
import type { GeneralSettings } from '../../../types';
import { useEffect } from 'react';

export default function GeneralPage() {
  const { general, updateGeneral, saveAll } = useSettingsStore();
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue(general);
  }, [form, general]);

  const handleSave = async () => {
    const values = await form.validateFields() as Partial<GeneralSettings>;
    updateGeneral(values);
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
          initialValues={general}
        >
          <Form.Item label="启动时打开" name="startupOpen">
            <Select style={{ width: 240 }}>
              <Select.Option value="blank">空白页</Select.Option>
              <Select.Option value="last-workspace">最近工作区</Select.Option>
              <Select.Option value="specific-workspace">指定工作区</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="自动保存"
            name="autoSave"
            valuePropName="checked"
            tooltip="定期保存已打开文件；未命名草稿会保存到本地草稿缓存"
          >
            <Switch />
          </Form.Item>

          <Form.Item
            label="自动检查更新"
            name="autoUpdate"
            valuePropName="checked"
            tooltip="启动时自动检查并尝试下载安装；更新安装后提示重启，自动通道不可用时回退到发布页"
          >
            <Switch />
          </Form.Item>

          <Form.Item label="最近文件数量" name="recentFileCount">
            <InputNumber min={1} max={50} style={{ width: 120 }} />
          </Form.Item>

          <Form.Item label="关闭窗口行为" name="closeBehavior">
            <Select style={{ width: 200 }}>
              <Select.Option value="exit">退出应用</Select.Option>
              <Select.Option value="minimize">最小化窗口</Select.Option>
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

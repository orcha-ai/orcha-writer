import { Card, Form, Select, Switch, InputNumber, Button, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../../store';
import type { GeneralSettings } from '../../../types';
import { useEffect } from 'react';
import { APP_LANGUAGES, getLocaleText } from '../../../i18n';

export default function GeneralPage() {
  const { general, updateGeneral, saveAll } = useSettingsStore();
  const [form] = Form.useForm();
  const text = getLocaleText(general.language);

  useEffect(() => {
    form.setFieldsValue(general);
  }, [form, general]);

  const handleSave = async () => {
    const values = await form.validateFields() as Partial<GeneralSettings>;
    updateGeneral(values);
    await saveAll();
    message.success(text.common.saved);
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
          <Form.Item label={text.settings.general.language} name="language">
            <Select style={{ width: 200 }}>
              {APP_LANGUAGES.map((language) => (
                <Select.Option key={language.value} value={language.value}>
                  {language.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item label={text.settings.general.startupOpen} name="startupOpen">
            <Select style={{ width: 240 }}>
              <Select.Option value="last-workspace">{text.settings.general.startupLastWorkspace}</Select.Option>
              <Select.Option value="blank">{text.settings.general.startupBlank}</Select.Option>
              <Select.Option value="specific-workspace">{text.settings.general.startupSpecificWorkspace}</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            label={text.settings.general.autoUpdate}
            name="autoUpdate"
            valuePropName="checked"
            tooltip={text.settings.general.autoUpdateTooltip}
          >
            <Switch />
          </Form.Item>

          <Form.Item label={text.settings.general.recentFileCount} name="recentFileCount">
            <InputNumber min={1} max={50} style={{ width: 120 }} />
          </Form.Item>
        </Form>
      </Card>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
          {text.common.saveSettings}
        </Button>
      </div>
    </div>
  );
}

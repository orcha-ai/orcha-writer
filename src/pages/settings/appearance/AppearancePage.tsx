import { Card, Form, Select, Switch, ColorPicker, Radio, Button, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../../store';
import type { AppearanceSettings } from '../../../types';
import { useEffect } from 'react';
import { translateText } from '../../../i18n';

function normalizeThemeColor(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'toHexString' in value && typeof value.toHexString === 'function') {
    return (value as { toHexString: () => string }).toHexString();
  }
  return undefined;
}

export default function AppearancePage() {
  const { appearance, updateAppearance, saveAll } = useSettingsStore();
  const language = useSettingsStore(s => s.general.language);
  const [form] = Form.useForm();
  const t = (value: string) => translateText(language, value);

  useEffect(() => {
    form.setFieldsValue(appearance);
  }, [appearance, form]);

  const handleSave = async () => {
    const values = await form.validateFields() as Partial<AppearanceSettings>;
    updateAppearance({
      ...values,
      themeColor: normalizeThemeColor(values.themeColor) || appearance.themeColor,
    });
    await saveAll();
    message.success(t('设置已保存'));
  };

  const handleValuesChange = (changedValues: Partial<AppearanceSettings>) => {
    const next = { ...changedValues };
    if ('themeColor' in changedValues) {
      next.themeColor = normalizeThemeColor(changedValues.themeColor) || appearance.themeColor;
    }
    updateAppearance(next);
  };

  return (
    <div>
      <Card>
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          initialValues={appearance}
          onValuesChange={handleValuesChange}
        >
          <Form.Item label={t('主题模式')} name="themeMode">
            <Radio.Group>
              <Radio.Button value="system">{t('跟随系统')}</Radio.Button>
              <Radio.Button value="light">{t('浅色')}</Radio.Button>
              <Radio.Button value="dark">{t('深色')}</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item label={t('主题色')} name="themeColor" getValueFromEvent={(color) => color.toHexString()}>
            <ColorPicker showText format="hex" />
          </Form.Item>

          <Form.Item label={t('界面密度')} name="density">
            <Select style={{ width: 160 }}>
              <Select.Option value="comfortable">{t('舒适')}</Select.Option>
              <Select.Option value="standard">{t('标准')}</Select.Option>
              <Select.Option value="compact">{t('紧凑')}</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label={t('字体')} name="font">
            <Select style={{ width: 240 }}>
              <Select.Option value="system-ui">{t('系统默认')}</Select.Option>
              <Select.Option value="-apple-system">Apple System</Select.Option>
              <Select.Option value="Inter">Inter</Select.Option>
              <Select.Option value="Noto Sans">Noto Sans</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label={t('显示侧边栏')} name="showSidebar" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label={t('显示大纲')} name="showOutline" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label={t('显示标签栏')} name="showTabs" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label={t('毛玻璃效果')} name="transparency" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Card>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
          {t('保存设置')}
        </Button>
      </div>
    </div>
  );
}

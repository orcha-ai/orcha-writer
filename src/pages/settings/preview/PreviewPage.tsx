import { Card, Form, Switch, InputNumber, Select, Button, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../../store';
import type { PreviewSettings } from '../../../types';
import { PREVIEW_THEMES, normalizePreviewThemeId } from '../../../previewThemes';
import { PREVIEW_CODE_THEMES, normalizePreviewCodeThemeId } from '../../../codeThemes';
import { useEffect } from 'react';
import { translateText } from '../../../i18n';

export default function PreviewPage() {
  const { preview, updatePreview, saveAll } = useSettingsStore();
  const language = useSettingsStore(s => s.general.language);
  const [form] = Form.useForm();
  const t = (value: string) => translateText(language, value);

  useEffect(() => {
    form.setFieldsValue(preview);
  }, [form, preview]);

  const handleSave = async () => {
    const values = await form.validateFields() as Partial<PreviewSettings>;
    updatePreview({
      ...values,
      previewTheme: normalizePreviewThemeId(values.previewTheme),
      codeTheme: normalizePreviewCodeThemeId(values.codeTheme),
    });
    await saveAll();
    message.success(t('设置已保存'));
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
        <Card title={t('预览主题')} style={{ marginBottom: 16 }}>
          <Form.Item label={t('预览主题')} name="previewTheme">
            <Select
              style={{ width: 200 }}
              options={PREVIEW_THEMES.map(theme => ({ value: theme.id, label: t(theme.label) }))}
            />
          </Form.Item>

          <Form.Item label={t('代码主题')} name="codeTheme">
            <Select
              style={{ width: 220 }}
              options={PREVIEW_CODE_THEMES.map(theme => ({ value: theme.id, label: theme.label }))}
            />
          </Form.Item>

        </Card>

        {/* Behavior */}
        <Card title={t('预览行为')} style={{ marginBottom: 16 }}>
          <Form.Item label={t('预览字体大小')} name="fontSize">
            <InputNumber min={10} max={32} style={{ width: 120 }} suffix="px" />
          </Form.Item>

          <Form.Item label={t('滚动同步')} name="syncScroll" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label={t('图片最大宽度')} name="imageMaxWidth">
            <InputNumber min={200} max={1600} style={{ width: 140 }} suffix="px" />
          </Form.Item>

          <Form.Item label={t('外链打开方式')} name="openExternalLink" valuePropName="checked">
            <Switch checkedChildren={t('新窗口')} unCheckedChildren={t('当前页')} />
          </Form.Item>

          <Form.Item label={t('HTML 渲染')} name="htmlRender">
            <Select style={{ width: 200 }}>
              <Select.Option value="disable">{t('禁用')}</Select.Option>
              <Select.Option value="safe">{t('安全模式（过滤脚本）')}</Select.Option>
              <Select.Option value="all">{t('允许全部')}</Select.Option>
            </Select>
          </Form.Item>
        </Card>
      </Form>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
          {t('保存设置')}
        </Button>
      </div>
    </div>
  );
}

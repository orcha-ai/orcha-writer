import { Card, Form, Switch, Button, message, Tag, Alert, Typography } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import { useSettingsStore } from '../../../store';
import type { SecuritySettings } from '../../../types';
import { translateText } from '../../../i18n';

export default function SecurityPage() {
  const { security, updateSecurity, saveAll } = useSettingsStore();
  const language = useSettingsStore(s => s.general.language);
  const [form] = Form.useForm<SecuritySettings>();
  const t = (value: string) => translateText(language, value);

  useEffect(() => {
    form.setFieldsValue(security);
  }, [form, security]);

  const handleSave = async () => {
    const values = await form.validateFields();
    updateSecurity(values);
    await saveAll();
    message.success(t('设置已保存'));
  };

  return (
    <div>
      <Alert
        message={t('安全策略已接入预览渲染')}
        description={t('这些选项会影响 Markdown 中 HTML、远程资源与外链的处理方式。')}
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 5 }}
        wrapperCol={{ span: 12 }}
        initialValues={security}
      >
        <Card title={t('内容安全')} style={{ marginBottom: 16 }}>
          <Form.Item
            label={t('允许加载外部内容')}
            name="allowExternalContent"
            valuePropName="checked"
            tooltip={t('允许 Markdown 预览加载远程图片等外部资源')}
          >
            <Switch checkedChildren={t('允许')} unCheckedChildren={t('禁止')} />
          </Form.Item>

          <Form.Item
            label={t('启用安全沙箱')}
            name="enableSandbox"
            valuePropName="checked"
            tooltip={t('过滤危险 HTML、脚本与内联事件')}
          >
            <Switch checkedChildren={t('启用')} unCheckedChildren={t('禁用')} />
          </Form.Item>

          <Form.Item
            label={t('外链打开前确认')}
            name="confirmExternalLinks"
            valuePropName="checked"
            tooltip={t('点击 Markdown 预览中的外部链接时先弹出确认')}
          >
            <Switch checkedChildren={t('确认')} unCheckedChildren={t('直接打开')} />
          </Form.Item>

          <Form.Item label={t('脚本执行')} wrapperCol={{ offset: 5 }}>
            <Tag color="success">{t('默认禁用')}</Tag>
          </Form.Item>
        </Card>

        <Card title={t('数据与隐私')} style={{ marginBottom: 16 }}>
          <Form.Item label={t('配置存储位置')} wrapperCol={{ offset: 5 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              ~/.orcha-writer/config/
            </Typography.Text>
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

import { Card, Form, Input, Button, Space, List, message } from 'antd';
import { FolderOpenOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../../../store';
import type { FileSettings } from '../../../types';
import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { translateText } from '../../../i18n';

const CONTROL_WIDTH = 480;

export default function FilesPage() {
  const { files, updateFiles, saveAll } = useSettingsStore();
  const language = useSettingsStore(s => s.general.language);
  const [form] = Form.useForm();
  const [hidePatterns, setHidePatterns] = useState(files.hidePatterns || []);
  const t = (value: string) => translateText(language, value);

  useEffect(() => {
    form.setFieldsValue(files);
    setHidePatterns(files.hidePatterns || []);
  }, [files, form]);

  const addHidePattern = () => {
    const newPatterns = [...hidePatterns, ''];
    setHidePatterns(newPatterns);
  };

  const updateHidePattern = (index: number, value: string) => {
    const newPatterns = [...hidePatterns];
    newPatterns[index] = value;
    setHidePatterns(newPatterns);
  };

  const removeHidePattern = (index: number) => {
    const newPatterns = hidePatterns.filter((_, i) => i !== index);
    setHidePatterns(newPatterns);
  };

  const handleSave = async () => {
    const values = await form.validateFields() as Partial<FileSettings>;
    updateFiles({ ...values, hidePatterns: hidePatterns.map((item) => item.trim()).filter(Boolean) });
    await saveAll();
    message.success(t('设置已保存'));
  };

  const handleSelectWorkspace = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('选择默认工作区'),
      });
      if (!selected) return;
      form.setFieldValue('defaultWorkspace', Array.isArray(selected) ? selected[0] : selected);
    } catch {
      message.warning(t('当前环境无法打开目录选择器'));
    }
  };

  return (
    <div>
      <Card>
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ span: 4 }}
          wrapperCol={{ span: 12 }}
          initialValues={files}
        >
          <Form.Item label={t('默认工作区')}>
            <Space.Compact style={{ width: CONTROL_WIDTH, maxWidth: '100%' }}>
              <Form.Item name="defaultWorkspace" noStyle>
                <Input />
              </Form.Item>
              <Button icon={<FolderOpenOutlined />} onClick={handleSelectWorkspace}>
                {t('选择目录')}
              </Button>
            </Space.Compact>
          </Form.Item>

          <Form.Item label={t('隐藏目录规则')}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <List
                size="small"
                dataSource={hidePatterns}
                renderItem={(item, index) => (
                  <List.Item
                    actions={[
                      <Button type="text" size="small" danger onClick={() => removeHidePattern(index)}>
                        {t('删除')}
                      </Button>,
                    ]}
                  >
                    <Input
                      value={item}
                      onChange={(e) => updateHidePattern(index, e.target.value)}
                      style={{ width: 240 }}
                      placeholder={t('如 node_modules')}
                    />
                  </List.Item>
                )}
              />
              <Button type="dashed" icon={<PlusOutlined />} onClick={addHidePattern}>
                {t('添加隐藏规则')}
              </Button>
            </Space>
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

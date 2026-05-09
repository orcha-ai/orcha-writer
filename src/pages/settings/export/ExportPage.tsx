import { useEffect, useState } from 'react';
import {
  Card, Form, Select, Switch, Input, Button, Space, Alert, Tag, Typography, Divider, message,
} from 'antd';
import {
  FolderOpenOutlined,
  SaveOutlined,
  ReloadOutlined,
  ExperimentOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '../../../store';
import type { PdfExportEngine, PdfEngineStatus, ExportSettings } from '../../../types';

type VisiblePdfEngine = Extract<PdfExportEngine, 'auto' | 'system_print' | 'system_chrome'>;

const ENGINE_LABELS: Record<VisiblePdfEngine, string> = {
  auto: '自动选择，推荐',
  system_print: '系统打印，最轻量',
  system_chrome: '系统 Chrome，使用本机 Chrome / Edge',
};

const CONTROL_WIDTH = 420;
const SHORT_CONTROL_WIDTH = 160;
const VISIBLE_PDF_ENGINES: VisiblePdfEngine[] = ['auto', 'system_print', 'system_chrome'];

function normalizePdfEngine(engine: PdfExportEngine): VisiblePdfEngine {
  return VISIBLE_PDF_ENGINES.includes(engine as VisiblePdfEngine) ? engine as VisiblePdfEngine : 'auto';
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function fallbackStatuses(): PdfEngineStatus[] {
  return [
    { engine: 'system_print', available: true, label: '系统打印' },
    { engine: 'system_chrome', available: false, label: '系统 Chrome', reason: '未检测到 Chrome' },
  ];
}

export default function ExportPage() {
  const { export: exportSettings, updateExport, saveAll } = useSettingsStore();
  const [form] = Form.useForm<ExportSettings>();
  const [engineStatuses, setEngineStatuses] = useState<PdfEngineStatus[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [testing, setTesting] = useState(false);

  const currentEngine = normalizePdfEngine(Form.useWatch('defaultPdfEngine', form) ?? exportSettings.defaultPdfEngine);
  const detectMode = Form.useWatch(['systemChrome', 'detectMode'], form) ?? exportSettings.systemChrome.detectMode;
  const currentStatus = engineStatuses.find(
    (s) => s.engine === (currentEngine === 'auto' ? 'system_print' : currentEngine),
  );

  useEffect(() => {
    form.setFieldsValue({
      ...exportSettings,
      defaultPdfEngine: normalizePdfEngine(exportSettings.defaultPdfEngine),
    });
  }, [exportSettings, form]);

  useEffect(() => {
    void handleDetect();
    // Detect once on page entry; manual refresh is available from the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      let statuses = fallbackStatuses();
      if (isTauri()) {
        const detected = await invoke<Array<Partial<PdfEngineStatus> & { engine: string; available: boolean }>>('detect_pdf_engines');
        statuses = detected
          .map((item) => ({
            engine: item.engine as PdfExportEngine,
            available: item.available,
            label: item.label || ENGINE_LABELS[item.engine as VisiblePdfEngine] || item.engine,
            reason: item.reason,
            version: item.version,
            path: item.path,
          }))
          .filter((item) => item.engine !== 'orcha_pdf_engine' && item.engine !== 'vivliostyle');
      }

      setEngineStatuses(statuses);
      const chrome = statuses.find((item) => item.engine === 'system_chrome' && item.available);
      if (chrome?.path || chrome?.version) {
        const nextChrome = {
          ...form.getFieldValue('systemChrome'),
          lastDetectedPath: chrome.path || '',
          lastDetectedVersion: chrome.version || '',
        };
        form.setFieldValue('systemChrome', nextChrome);
        updateExport({ systemChrome: nextChrome });
      }
    } catch {
      setEngineStatuses(fallbackStatuses());
      message.warning('检测失败，已使用本地兜底状态');
    } finally {
      setDetecting(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const engine = normalizePdfEngine((form.getFieldValue('defaultPdfEngine') ?? 'auto') as PdfExportEngine);
      const status = engineStatuses.find((item) => item.engine === (engine === 'auto' ? 'system_print' : engine));
      if (status && !status.available) {
        message.warning(`当前引擎不可用：${status.reason || '未知原因'}`);
        return;
      }
      message.success(`引擎「${ENGINE_LABELS[engine]}」可用于当前配置`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    values.defaultPdfEngine = normalizePdfEngine(values.defaultPdfEngine);
    updateExport(values);
    await saveAll();
    message.success('设置已保存');
  };

  const handleSelectExportDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择默认导出目录',
      });
      if (!selected) return;
      form.setFieldValue('defaultExportDir', Array.isArray(selected) ? selected[0] : selected);
    } catch {
      message.warning('当前环境无法打开目录选择器');
    }
  };

  const isEngineDisabled = (engine: PdfExportEngine): boolean => {
    if (engine === 'auto' || engine === 'system_print') return false;
    if (engineStatuses.length === 0) return false;
    const status = engineStatuses.find((s) => s.engine === engine);
    return status ? !status.available : true;
  };

  return (
    <div>
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 4 }}
        wrapperCol={{ span: 16 }}
        initialValues={exportSettings}
      >
        <Card title="PDF 导出" style={{ marginBottom: 16 }}>
          <Divider orientation="horizontal" plain>
            <ThunderboltOutlined style={{ marginRight: 4 }} />
            PDF 导出引擎
          </Divider>

          <Form.Item
            label="默认引擎"
            name="defaultPdfEngine"
            tooltip="选择 PDF 导出时使用的引擎，推荐自动选择"
          >
            <Select style={{ width: CONTROL_WIDTH, maxWidth: '100%' }}>
              <Select.Option value="auto">自动选择，推荐</Select.Option>
              <Select.Option value="system_print">系统打印，最轻量</Select.Option>
              <Select.Option value="system_chrome" disabled={isEngineDisabled('system_chrome')}>
                系统 Chrome，使用本机 Chrome / Edge
                {isEngineDisabled('system_chrome') && '，未安装'}
              </Select.Option>
            </Select>
          </Form.Item>

          {currentEngine && currentEngine !== 'auto' && (
            <Form.Item label="当前引擎">
              <Space direction="vertical" size={2} style={{ maxWidth: '100%' }}>
                <Space>
                  <Typography.Text strong>{ENGINE_LABELS[currentEngine]}</Typography.Text>
                  {currentStatus ? (
                    currentStatus.available ? <Tag color="success">可用</Tag> : <Tag color="error">不可用</Tag>
                  ) : null}
                </Space>
                {currentStatus?.path && (
                  <Typography.Text type="secondary" style={{ display: 'block', maxWidth: '100%', fontSize: 12, wordBreak: 'break-all' }}>
                    路径：{currentStatus.path}
                  </Typography.Text>
                )}
                {currentStatus?.version && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    版本：{currentStatus.version}
                  </Typography.Text>
                )}
                {currentStatus && !currentStatus.available && currentStatus.reason && (
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    原因：{currentStatus.reason}
                  </Typography.Text>
                )}
              </Space>
            </Form.Item>
          )}

          {currentEngine === 'auto' && (
            <Form.Item label="自动选择策略">
              <Typography.Text type="secondary" style={{ display: 'block', maxWidth: '100%', fontSize: 12, wordBreak: 'break-word' }}>
                {'优先级：系统 Chrome -> 系统打印'}
              </Typography.Text>
            </Form.Item>
          )}

          {(currentEngine === 'system_chrome' || currentEngine === 'auto') && (
            <>
              <Divider orientation="horizontal" plain>系统 Chrome 配置</Divider>
              <Form.Item label="检测模式" name={['systemChrome', 'detectMode']}>
                <Select style={{ width: SHORT_CONTROL_WIDTH }}>
                  <Select.Option value="auto">自动检测</Select.Option>
                  <Select.Option value="custom">手动选择</Select.Option>
                </Select>
              </Form.Item>

              {detectMode === 'custom' && (
                <Form.Item label="Chrome 路径" name={['systemChrome', 'customPath']}>
                  <Input
                    style={{ width: CONTROL_WIDTH, maxWidth: '100%' }}
                    placeholder="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                  />
                </Form.Item>
              )}

              {(form.getFieldValue(['systemChrome', 'lastDetectedPath']) || exportSettings.systemChrome?.lastDetectedPath) && (
                <Form.Item label="上次检测">
                  <Space direction="vertical" size={2} style={{ maxWidth: '100%' }}>
                    <Typography.Text type="secondary" style={{ display: 'block', maxWidth: '100%', fontSize: 12, wordBreak: 'break-all' }}>
                      路径：{form.getFieldValue(['systemChrome', 'lastDetectedPath']) || exportSettings.systemChrome.lastDetectedPath}
                    </Typography.Text>
                    {(form.getFieldValue(['systemChrome', 'lastDetectedVersion']) || exportSettings.systemChrome.lastDetectedVersion) && (
                      <Typography.Text type="secondary" style={{ display: 'block', maxWidth: '100%', fontSize: 12, wordBreak: 'break-word' }}>
                        版本：{form.getFieldValue(['systemChrome', 'lastDetectedVersion']) || exportSettings.systemChrome.lastDetectedVersion}
                      </Typography.Text>
                    )}
                  </Space>
                </Form.Item>
              )}
            </>
          )}

          <Divider orientation="horizontal" plain>页面设置</Divider>

          <Form.Item label="页面尺寸" name={['page', 'format']}>
            <Select style={{ width: SHORT_CONTROL_WIDTH }}>
              <Select.Option value="A4">A4</Select.Option>
              <Select.Option value="A5">A5</Select.Option>
              <Select.Option value="Letter">Letter</Select.Option>
              <Select.Option value="Legal">Legal</Select.Option>
              <Select.Option value="custom">自定义</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="页面方向" name={['page', 'orientation']}>
            <Select style={{ width: SHORT_CONTROL_WIDTH }}>
              <Select.Option value="portrait">纵向</Select.Option>
              <Select.Option value="landscape">横向</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item label="上边距" name={['page', 'margin', 'top']}>
            <Input style={{ width: SHORT_CONTROL_WIDTH }} placeholder="20mm" />
          </Form.Item>

          <Form.Item label="下边距" name={['page', 'margin', 'bottom']}>
            <Input style={{ width: SHORT_CONTROL_WIDTH }} placeholder="20mm" />
          </Form.Item>

          <Form.Item label="左边距" name={['page', 'margin', 'left']}>
            <Input style={{ width: SHORT_CONTROL_WIDTH }} placeholder="18mm" />
          </Form.Item>

          <Form.Item label="右边距" name={['page', 'margin', 'right']}>
            <Input style={{ width: SHORT_CONTROL_WIDTH }} placeholder="18mm" />
          </Form.Item>

          <Form.Item label="打印背景" name={['page', 'printBackground']} valuePropName="checked">
            <Switch />
          </Form.Item>

          <Divider orientation="horizontal" plain>页眉页脚</Divider>

          <Form.Item label="启用页眉页脚" name={['headerFooter', 'enabled']} valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="显示页码" name={['headerFooter', 'showPageNumber']} valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="显示文档标题" name={['headerFooter', 'showDocumentTitle']} valuePropName="checked">
            <Switch />
          </Form.Item>

          <Divider />

          <Form.Item wrapperCol={{ offset: 4, span: 16 }}>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={handleDetect} loading={detecting}>
                重新检测
              </Button>
              <Button icon={<ExperimentOutlined />} onClick={handleTest} loading={testing} type="primary" ghost>
                测试导出
              </Button>
            </Space>
          </Form.Item>
        </Card>

        <Card title="导出设置">
          <Form.Item label="默认导出目录">
            <Space.Compact style={{ width: CONTROL_WIDTH, maxWidth: '100%' }}>
              <Form.Item name="defaultExportDir" noStyle>
                <Input />
              </Form.Item>
              <Button icon={<FolderOpenOutlined />} onClick={handleSelectExportDir}>
                选择目录
              </Button>
            </Space.Compact>
          </Form.Item>

          <Form.Item label="覆盖已有文件" name="overwriteExisting" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="导出后打开" name="openAfterExport" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Card>
      </Form>

      {currentEngine && currentEngine !== 'auto' && currentStatus && !currentStatus.available && (
        <Alert
          style={{ marginTop: 16 }}
          message={`当前配置的 PDF 导出引擎不可用：${currentStatus.reason || '未知'}`}
          description={
            <Space direction="vertical">
              {currentEngine === 'system_chrome' && (
                <span>请安装 Chrome / Edge，或在设置中切换为「系统打印」。</span>
              )}
            </Space>
          }
          type="warning"
          showIcon
        />
      )}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
          保存设置
        </Button>
      </div>
    </div>
  );
}

import { Button, ColorPicker, Input, InputNumber, Modal, Segmented, Switch, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import type { PdfHeaderFooterConfig } from '../types';
import {
  createPdfTemplateValues,
  defaultPdfFooterTemplate,
  defaultPdfHeaderTemplate,
  defaultPdfTemplateStyle,
  renderPdfTemplateText,
  type PdfTemplateAlignment,
  type PdfTemplateStyle,
  type PdfTemplateVariable,
} from '../utils/pdfExport';

export interface PdfTemplateDraft {
  headerTemplate: string;
  footerTemplate: string;
  headerStyle: PdfTemplateStyle;
  footerStyle: PdfTemplateStyle;
}

interface PdfExportDialogProps {
  open: boolean;
  documentName: string;
  headerFooter: PdfHeaderFooterConfig;
  isEnglish: boolean;
  exporting: boolean;
  onCancel: () => void;
  onExport: (draft: PdfTemplateDraft) => void;
  t: (value: string, params?: Record<string, string | number>) => string;
}

type TemplateField = 'header' | 'footer';

interface TemplateVariableOption {
  key: PdfTemplateVariable;
  label: string;
  token: string;
}

export default function PdfExportDialog({
  open,
  documentName,
  headerFooter,
  isEnglish,
  exporting,
  onCancel,
  onExport,
  t,
}: PdfExportDialogProps) {
  const headerRef = useRef<TextAreaRef>(null);
  const footerRef = useRef<TextAreaRef>(null);
  const [activeField, setActiveField] = useState<TemplateField>('footer');
  const [headerTemplate, setHeaderTemplate] = useState('');
  const [footerTemplate, setFooterTemplate] = useState('');
  const [headerStyle, setHeaderStyle] = useState<PdfTemplateStyle>(() => defaultPdfTemplateStyle());
  const [footerStyle, setFooterStyle] = useState<PdfTemplateStyle>(() => defaultPdfTemplateStyle());
  const locale = isEnglish ? 'en-US' : 'zh-CN';

  useEffect(() => {
    if (!open) return;
    setHeaderTemplate(defaultPdfHeaderTemplate(headerFooter));
    setFooterTemplate(defaultPdfFooterTemplate(headerFooter, isEnglish));
    setHeaderStyle(defaultPdfTemplateStyle());
    setFooterStyle(defaultPdfTemplateStyle());
    setActiveField('footer');
  }, [headerFooter, isEnglish, open]);

  const variables = useMemo<TemplateVariableOption[]>(() => [
    { key: 'title', label: t('标题'), token: '{{title}}' },
    { key: 'fileName', label: t('文件名'), token: '{{fileName}}' },
    { key: 'date', label: t('日期'), token: '{{date}}' },
    { key: 'time', label: t('时间'), token: '{{time}}' },
    { key: 'pageNumber', label: t('页码'), token: '{{pageNumber}}' },
    { key: 'totalPages', label: t('总页数'), token: '{{totalPages}}' },
  ], [t]);

  const previewValues = useMemo(
    () => createPdfTemplateValues(documentName, locale, '1', '12'),
    [documentName, locale],
  );
  const previewHeader = renderPdfTemplateText(headerTemplate, previewValues).trim();
  const previewFooter = renderPdfTemplateText(footerTemplate, previewValues).trim();
  const alignmentOptions = useMemo(() => [
    { label: <Tooltip title={t('左对齐')}><AlignLeft size={14} /></Tooltip>, value: 'left' },
    { label: <Tooltip title={t('居中')}><AlignCenter size={14} /></Tooltip>, value: 'center' },
    { label: <Tooltip title={t('右对齐')}><AlignRight size={14} /></Tooltip>, value: 'right' },
  ], [t]);

  const previewStyle = (style: PdfTemplateStyle, field: TemplateField) => ({
    color: style.color,
    fontSize: style.fontSize,
    textAlign: style.align,
    borderTop: style.divider && field === 'footer'
      ? '1px solid var(--border-secondary)'
      : undefined,
    borderBottom: style.divider && field === 'header'
      ? '1px solid var(--border-secondary)'
      : undefined,
  });

  const insertVariable = (token: string) => {
    const field = activeField || 'footer';
    const ref = field === 'header' ? headerRef : footerRef;
    const value = field === 'header' ? headerTemplate : footerTemplate;
    const textarea = ref.current?.resizableTextArea?.textArea;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;
    const nextCursor = start + token.length;

    if (field === 'header') {
      setHeaderTemplate(nextValue);
    } else {
      setFooterTemplate(nextValue);
    }

    window.requestAnimationFrame(() => {
      const nextTextarea = ref.current?.resizableTextArea?.textArea;
      ref.current?.focus();
      nextTextarea?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const renderStyleToolbar = (
    style: PdfTemplateStyle,
    onChange: (next: Partial<PdfTemplateStyle>) => void,
  ) => (
    <div className="pdf-template-style-toolbar">
      <label className="pdf-template-style-control pdf-template-style-control-size">
        <span>{t('字号')}</span>
        <InputNumber
          min={8}
          max={18}
          size="small"
          suffix="px"
          value={style.fontSize}
          onChange={(value) => onChange({ fontSize: typeof value === 'number' ? value : 10 })}
        />
      </label>
      <label className="pdf-template-style-control pdf-template-style-control-color">
        <span>{t('颜色')}</span>
        <ColorPicker
          value={style.color}
          size="small"
          showText
          format="hex"
          onChange={(_, hex) => onChange({ color: hex })}
        />
      </label>
      <label className="pdf-template-style-control pdf-template-style-control-align">
        <span>{t('对齐')}</span>
        <Segmented
          size="small"
          value={style.align}
          options={alignmentOptions}
          onChange={(value) => onChange({ align: value as PdfTemplateAlignment })}
        />
      </label>
      <label className="pdf-template-style-switch">
        <span>{t('分隔线')}</span>
        <span className="pdf-template-style-switch-control">
          <Switch size="small" checked={style.divider} onChange={(checked) => onChange({ divider: checked })} />
        </span>
      </label>
    </div>
  );

  const renderTemplateSection = (
    field: TemplateField,
    title: string,
    template: string,
    style: PdfTemplateStyle,
    textAreaRef: RefObject<TextAreaRef | null>,
    onTemplateChange: (value: string) => void,
    onStyleChange: (next: Partial<PdfTemplateStyle>) => void,
  ) => (
    <section className={`pdf-template-section${activeField === field ? ' active' : ''}`}>
      <div className="pdf-template-section-header">
        <span className="pdf-template-section-title">{title}</span>
        <span className="pdf-template-section-hint">{field === 'header' ? t('页面顶部') : t('页面底部')}</span>
      </div>
      <Input.TextArea
        ref={textAreaRef}
        value={template}
        rows={3}
        onFocus={() => setActiveField(field)}
        onChange={(event) => onTemplateChange(event.target.value)}
      />
      {renderStyleToolbar(style, onStyleChange)}
    </section>
  );

  return (
    <Modal
      title={t('导出 PDF')}
      open={open}
      width={860}
      centered
      zIndex={3600}
      destroyOnHidden
      okText={t('导出 PDF')}
      cancelText={t('取消')}
      confirmLoading={exporting}
      onCancel={onCancel}
      onOk={() => onExport({ headerTemplate, footerTemplate, headerStyle, footerStyle })}
    >
      <div className="pdf-export-dialog-body">
        <div className="pdf-template-editor">
          <Typography.Text type="secondary" className="pdf-template-document">
            {t('文档：{name}', { name: documentName })}
          </Typography.Text>

          {renderTemplateSection(
            'header',
            t('页眉'),
            headerTemplate,
            headerStyle,
            headerRef,
            setHeaderTemplate,
            (next) => setHeaderStyle((style) => ({ ...style, ...next })),
          )}

          {renderTemplateSection(
            'footer',
            t('页脚'),
            footerTemplate,
            footerStyle,
            footerRef,
            setFooterTemplate,
            (next) => setFooterStyle((style) => ({ ...style, ...next })),
          )}

          <div className="pdf-template-preview" aria-label={t('页面预览')}>
            <div className="pdf-template-preview-title">{t('页面预览')}</div>
            <div className="pdf-template-paper-preview">
              <div className="pdf-template-paper-header" style={previewStyle(headerStyle, 'header')}>
                {previewHeader || '\u00A0'}
              </div>
              <div className="pdf-template-paper-body">
                <span />
                <span />
                <span />
              </div>
              <div className="pdf-template-paper-footer" style={previewStyle(footerStyle, 'footer')}>
                {previewFooter || '\u00A0'}
              </div>
            </div>
          </div>
        </div>

        <aside className="pdf-template-variables" aria-label={t('支持变量')}>
          <div className="pdf-template-variables-title">{t('支持变量')}</div>
          {variables.map((variable) => (
            <Button
              key={variable.key}
              className="pdf-template-variable-button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertVariable(variable.token)}
            >
              <span className="pdf-template-variable-label">{variable.label}</span>
              <code>{variable.token}</code>
            </Button>
          ))}
        </aside>
      </div>
    </Modal>
  );
}

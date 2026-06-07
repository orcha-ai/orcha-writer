import { Button, Input, Modal, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import type { PdfHeaderFooterConfig } from '../types';
import {
  createPdfTemplateValues,
  defaultPdfFooterTemplate,
  defaultPdfHeaderTemplate,
  renderPdfTemplateText,
  type PdfTemplateVariable,
} from '../utils/pdfExport';

export interface PdfTemplateDraft {
  headerTemplate: string;
  footerTemplate: string;
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
  const locale = isEnglish ? 'en-US' : 'zh-CN';

  useEffect(() => {
    if (!open) return;
    setHeaderTemplate(defaultPdfHeaderTemplate(headerFooter));
    setFooterTemplate(defaultPdfFooterTemplate(headerFooter, isEnglish));
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

  return (
    <Modal
      title={t('导出 PDF')}
      open={open}
      width={780}
      zIndex={3600}
      destroyOnHidden
      okText={t('导出 PDF')}
      cancelText={t('取消')}
      confirmLoading={exporting}
      onCancel={onCancel}
      onOk={() => onExport({ headerTemplate, footerTemplate })}
    >
      <div className="pdf-export-dialog-body">
        <div className="pdf-template-editor">
          <Typography.Text type="secondary" className="pdf-template-document">
            {t('文档：{name}', { name: documentName })}
          </Typography.Text>

          <label className="pdf-template-field">
            <span className="pdf-template-label">{t('页眉模板')}</span>
            <Input.TextArea
              ref={headerRef}
              value={headerTemplate}
              rows={3}
              onFocus={() => setActiveField('header')}
              onChange={(event) => setHeaderTemplate(event.target.value)}
            />
          </label>

          <label className="pdf-template-field">
            <span className="pdf-template-label">{t('页脚模板')}</span>
            <Input.TextArea
              ref={footerRef}
              value={footerTemplate}
              rows={3}
              onFocus={() => setActiveField('footer')}
              onChange={(event) => setFooterTemplate(event.target.value)}
            />
          </label>

          <div className="pdf-template-preview" aria-label={t('页面预览')}>
            <div className="pdf-template-preview-title">{t('页面预览')}</div>
            <div className="pdf-template-preview-row">
              <span>{t('页眉')}</span>
              <strong>{previewHeader || t('无')}</strong>
            </div>
            <div className="pdf-template-preview-row">
              <span>{t('页脚')}</span>
              <strong>{previewFooter || t('无')}</strong>
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

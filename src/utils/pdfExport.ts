import type { PdfHeaderFooterConfig, PdfPageConfig } from '../types';

export type PdfTemplateVariable =
  | 'title'
  | 'fileName'
  | 'date'
  | 'time'
  | 'pageNumber'
  | 'totalPages';

export interface PdfTemplateValues {
  title: string;
  fileName: string;
  date: string;
  time: string;
  pageNumber: string;
  totalPages: string;
}

export interface BuildPdfDocumentHtmlOptions {
  htmlBody: string;
  documentName: string;
  page: PdfPageConfig;
  themeColor: string;
}

function normalizeThemeColor(color: string | undefined): string {
  const value = color?.trim();
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#0A84FF';
}

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || fileName;
}

function escapeHtml(content: string, encodeNonAscii = false): string {
  let escaped = '';
  for (const char of content) {
    switch (char) {
      case '&':
        escaped += '&amp;';
        break;
      case '<':
        escaped += '&lt;';
        break;
      case '>':
        escaped += '&gt;';
        break;
      case '"':
        escaped += '&quot;';
        break;
      case "'":
        escaped += '&#39;';
        break;
      default: {
        const codePoint = char.codePointAt(0) ?? 0;
        escaped += encodeNonAscii && codePoint > 0x7e ? `&#${codePoint};` : char;
      }
    }
  }
  return escaped;
}

export function createPdfTemplateValues(
  fileName: string,
  locale: string,
  pageNumber: string,
  totalPages = '',
): PdfTemplateValues {
  const now = new Date();
  return {
    title: stripFileExtension(fileName),
    fileName,
    date: now.toLocaleDateString(locale),
    time: now.toLocaleTimeString(locale),
    pageNumber,
    totalPages,
  };
}

export function defaultPdfHeaderTemplate(config: PdfHeaderFooterConfig): string {
  return config.enabled && config.showDocumentTitle ? '{{title}}' : '';
}

export function defaultPdfFooterTemplate(config: PdfHeaderFooterConfig, isEnglish: boolean): string {
  if (!config.enabled || !config.showPageNumber) return '';
  return isEnglish ? 'Page {{pageNumber}}' : '第 {{pageNumber}} 页';
}

export function renderPdfTemplateText(template: string, values: PdfTemplateValues): string {
  return template.replace(/\{\{\s*([a-zA-Z][\w]*)\s*\}\}/g, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
    return values[key as PdfTemplateVariable];
  });
}

export function renderPdfTemplateHtml(
  template: string,
  values: PdfTemplateValues,
  trustedHtmlValues: Partial<Record<PdfTemplateVariable, string>> = {},
): string {
  const variablePattern = /\{\{\s*([a-zA-Z][\w]*)\s*\}\}/g;
  let html = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = variablePattern.exec(template))) {
    html += escapeHtml(template.slice(lastIndex, match.index), true);
    const [token, key] = match;
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      html += escapeHtml(token, true);
      lastIndex = match.index + token.length;
      continue;
    }
    const variable = key as PdfTemplateVariable;
    if (Object.prototype.hasOwnProperty.call(trustedHtmlValues, variable)) {
      html += trustedHtmlValues[variable] ?? '';
    } else {
      html += escapeHtml(values[variable], true);
    }
    lastIndex = match.index + token.length;
  }

  html += escapeHtml(template.slice(lastIndex), true);
  return html;
}

export function buildPdfDocumentHtml({
  htmlBody,
  documentName,
  page,
  themeColor,
}: BuildPdfDocumentHtmlOptions): string {
  const accentColor = normalizeThemeColor(themeColor);

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(documentName)}</title><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { max-width: 700px; margin: 40px auto; padding: 0 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.7; color: #1a1a1a; }
        h1, h2 { border-bottom: 1px solid #e0e0e0; padding-bottom: 0.3em; margin: 1.5em 0 0.8em; page-break-after: avoid; }
        h1 { font-size: 1.8em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; } h4 { font-size: 1.1em; }
        code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 0.88em; font-family: SFMono-Regular, Consolas, monospace; }
        pre { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px 16px; overflow-x: auto; margin: 1em 0; page-break-inside: avoid; }
        pre code { background: none; padding: 0; }
        blockquote { border-left: 3px solid ${accentColor}; padding-left: 16px; color: #666; margin: 1em 0; }
        img { max-width: 100%; border-radius: 6px; margin: 1em 0; }
        table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        th, td { border: 1px solid #e0e0e0; padding: 8px 12px; }
        th { background: #f5f5f5; }
        a { color: ${accentColor}; }
        hr { border: none; border-top: 1px solid #e0e0e0; margin: 1.5em 0; }
        ul, ol { padding-left: 24px; }
        @media print {
          body { max-width: none; margin: 0; }
          ${page.printBackground ? '' : '* { background: transparent !important; }'}
        }
      </style></head><body>${htmlBody}</body></html>`;
}

export function buildChromePdfTemplate(
  template: string,
  documentName: string,
  locale: string,
): string {
  if (!template.trim()) return '';

  const values = createPdfTemplateValues(documentName, locale, '', '');
  const trustedHtmlValues: Partial<Record<PdfTemplateVariable, string>> = {
    pageNumber: '<span class="pageNumber"></span>',
    totalPages: '<span class="totalPages"></span>',
  };
  const content = renderPdfTemplateHtml(template, values, trustedHtmlValues);

  return `<div style="box-sizing:border-box;width:100%;padding:0 8mm;font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC','Noto Sans SC',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:10px;line-height:1.35;color:#666;white-space:pre-wrap;">${content}</div>`;
}

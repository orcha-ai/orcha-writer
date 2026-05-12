import { useMemo, useRef, useEffect } from 'react';
import { useApp } from '../AppContext';
import { useSettingsStore } from '../store';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import { open as openPath } from '@tauri-apps/plugin-shell';
import type Token from 'markdown-it/lib/token.mjs';
import type { MarkdownSettings, PreviewSettings, SecuritySettings } from '../types';
import { getPreviewThemeClassName } from '../previewThemes';
import { getPreviewCodeThemeClassName } from '../codeThemes';
import { pathExists } from '../utils/fs';
import { normalizeMarkdownImageSyntax, resolveMarkdownImageSource } from '../utils/markdownImages';
import { getLocaleText, normalizeAppLanguage } from '../i18n';

interface HeadingInfo {
  level: number;
  title: string;
  id: string;
}

interface MarkdownRenderEnv {
  headings: HeadingInfo[];
  slugCounts: Record<string, number>;
  bodyLineOffset: number;
}

interface MarkdownRendererOptions {
  langPrefix?: string;
  highlight?: ((content: string, language: string, attrs: string) => string) | null;
}

const CODE_LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Bash',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  go: 'Go',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  markdown: 'Markdown',
  md: 'Markdown',
  php: 'PHP',
  python: 'Python',
  py: 'Python',
  rust: 'Rust',
  rs: 'Rust',
  sh: 'Shell',
  shell: 'Shell',
  sql: 'SQL',
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
};

const CODE_LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Plain Text' },
  { value: 'shell', label: 'Shell' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'sql', label: 'SQL' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'markdown', label: 'Markdown' },
];

function escapeHtml(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractCodeLanguage(info: string): string {
  return info.trim().split(/\s+/)[0]?.replace(/[^\w#+.-]/g, '') || '';
}

function formatCodeLanguage(language: string): string {
  if (!language) return '纯文本';
  return CODE_LANGUAGE_LABELS[language.toLowerCase()] || language.toUpperCase();
}

function resolveHighlightLanguage(language: string): string {
  const normalized = language.toLowerCase();
  const aliases: Record<string, string> = {
    bash: 'bash',
    shell: 'bash',
    sh: 'bash',
    py: 'python',
    js: 'javascript',
    ts: 'typescript',
    md: 'markdown',
    rs: 'rust',
    yml: 'yaml',
  };
  return aliases[normalized] || normalized;
}

function renderHighlightedCode(content: string, language: string, codeHighlight: boolean): string {
  const highlightLanguage = resolveHighlightLanguage(language);
  if (codeHighlight && highlightLanguage && hljs.getLanguage(highlightLanguage)) {
    try {
      return hljs.highlight(content, { language: highlightLanguage, ignoreIllegals: true }).value;
    } catch {
      return escapeHtml(content);
    }
  }
  return escapeHtml(content);
}

function renderCodeLanguageOptions(language: string, plainTextLabel: string): string {
  const normalizedLanguage = language.toLowerCase();
  const hasLanguage = CODE_LANGUAGE_OPTIONS.some(option => option.value === normalizedLanguage);
  const options = hasLanguage || !normalizedLanguage
    ? CODE_LANGUAGE_OPTIONS
    : [...CODE_LANGUAGE_OPTIONS, { value: normalizedLanguage, label: formatCodeLanguage(normalizedLanguage) }];

  return options.map(option => {
    const label = option.value ? option.label : plainTextLabel;
    const selected = option.value === normalizedLanguage ? ' selected' : '';
    return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(label)}</option>`;
  }).join('');
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function slugify(content: string): string {
  const slug = content
    .trim()
    .toLowerCase()
    .replace(/[^\w一-鿿\s-]/g, '')
    .replace(/\s+/g, '-');
  return slug || 'heading';
}

function uniqueSlug(base: string, env: MarkdownRenderEnv): string {
  const count = env.slugCounts[base] ?? 0;
  env.slugCounts[base] = count + 1;
  return count === 0 ? base : `${base}-${count + 1}`;
}

function extractFrontMatter(content: string, enabled: boolean): { body: string; html: string; lineOffset: number } {
  if (!enabled) return { body: content, html: '', lineOffset: 0 };
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { body: content, html: '', lineOffset: 0 };

  const raw = match[1].trim();
  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.match(/^([^:#][^:]*):\s*(.*)$/))
    .filter((line): line is RegExpMatchArray => Boolean(line));

  const body = content.slice(match[0].length);
  const lineOffset = (match[0].match(/\r?\n/g) || []).length;
  if (rows.length === 0) {
    return {
      body,
      lineOffset,
      html: `<section class="md-frontmatter"><pre>${escapeHtml(raw)}</pre></section>`,
    };
  }

  const html = rows
    .map((row) => (
      `<div class="md-frontmatter-row"><dt>${escapeHtml(row[1].trim())}</dt><dd>${escapeHtml(row[2].trim())}</dd></div>`
    ))
    .join('');

  return { body, html: `<dl class="md-frontmatter">${html}</dl>`, lineOffset };
}

function renderToc(headings: HeadingInfo[]): string {
  const items = headings
    .filter((heading) => heading.level <= 3)
    .map((heading) => (
      `<li class="md-toc-level-${heading.level}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a></li>`
    ))
    .join('');

  if (!items) return '';
  return `<nav class="md-toc"><div class="md-toc-title">目录</div><ol>${items}</ol></nav>`;
}

function injectToc(html: string, markdown: MarkdownSettings, headings: HeadingInfo[]): string {
  if (!markdown.toc) return html;
  return html.replace(/<p>\s*\[toc\]\s*<\/p>/gi, renderToc(headings));
}

function addCalloutRule(md: MarkdownIt) {
  const titles: Record<string, string> = {
    note: 'Note',
    tip: 'Tip',
    important: 'Important',
    warning: 'Warning',
    caution: 'Caution',
  };

  md.block.ruler.before('blockquote', 'orcha_callout', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const firstLine = state.src.slice(start, max);
    const match = firstLine.match(/^>\s*\[!([A-Za-z]+)\]\s*(.*)$/);
    if (!match) return false;
    if (silent) return true;

    const type = match[1].toLowerCase();
    const title = match[2].trim() || titles[type] || match[1].toUpperCase();
    const contentLines: string[] = [];
    let nextLine = startLine + 1;

    while (nextLine < endLine) {
      const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      const line = state.src.slice(lineStart, lineMax);
      const quoteMatch = line.match(/^>\s?(.*)$/);
      if (!quoteMatch) break;
      contentLines.push(quoteMatch[1]);
      nextLine += 1;
    }

    const token = state.push('orcha_callout', '', 0);
    token.block = true;
    token.meta = { type, title };
    token.content = md.render(contentLines.join('\n'), state.env);
    state.line = nextLine;
    return true;
  });

  md.renderer.rules.orcha_callout = (tokens, idx) => {
    const { type, title } = tokens[idx].meta as { type: string; title: string };
    return `<aside class="md-callout md-callout-${escapeHtml(type)}"><div class="md-callout-title">${escapeHtml(title)}</div><div class="md-callout-body">${tokens[idx].content}</div></aside>`;
  };
}

// Sanitize: strip script tags and dangerous attributes
function sanitizeHtml(content: string, preview: PreviewSettings, security: SecuritySettings): string {
  if (preview.htmlRender === 'disable') return '';
  if (preview.htmlRender === 'all' && !security.enableSandbox) return content;
  if (/<script/i.test(content) || /javascript:/i.test(content) || /on\w+=/i.test(content)) {
    return '<!-- removed for security -->';
  }
  return content;
}

function applySecurity(html: string, security: SecuritySettings, language: string): string {
  const text = getLocaleText(language);
  let next = html;
  if (!security.allowExternalContent) {
    next = next.replace(
      /<img([^>]+?)src=["']https?:\/\/[^"']+["']([^>]*)>/gi,
      `<span class="blocked-external-content">${escapeHtml(text.preview.imageHidden)}</span>`,
    );
  }
  return next;
}

// Wrap search matches in <mark> tags within HTML text nodes
function highlightSearch(html: string, query: string): string {
  if (!query) return html;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'gi');
  return html.replace(/>([^<]+)</g, (_match: string, text: string) => {
    return '>' + text.replace(regex, (m: string) => `<mark class="search-highlight">${m}</mark>`) + '<';
  });
}

// Build markdown-it instance with heading IDs and safe HTML
function createMd(markdown: MarkdownSettings, preview: PreviewSettings, security: SecuritySettings, language: string, documentPath?: string) {
  const text = getLocaleText(language);
  const md = new MarkdownIt(markdown.dialect === 'commonmark' ? 'commonmark' : 'default', {
    html: preview.htmlRender !== 'disable',
    linkify: true,
    typographer: true,
    breaks: markdown.dialect === 'gfm',
    langPrefix: 'language-',
    highlight: markdown.codeHighlight
      ? (content, language) => {
        return renderHighlightedCode(content, language, true);
      }
      : undefined,
  });

  if (markdown.tableEnhanced) {
    md.enable('table', true);
  } else {
    md.disable('table', true);
  }

  if (markdown.callout) {
    addCalloutRule(md);
  }

  // Add IDs to headings for outline navigation
  md.renderer.rules.heading_open = (tokens: Token[], idx: number, options, env, self) => {
    const token = tokens[idx];
    const content = tokens[idx + 1]?.content || '';
    const renderEnv = env as MarkdownRenderEnv;
    const id = uniqueSlug(slugify(content), renderEnv);
    token.attrSet('id', id);
    renderEnv.headings.push({
      level: Number(token.tag.replace('h', '')),
      title: content,
      id,
    });
    return self.renderToken(tokens, idx, options);
  };

  // HTML sanitization
  md.renderer.rules.html_block = (tokens: Token[], idx: number) => sanitizeHtml(tokens[idx].content, preview, security);
  md.renderer.rules.html_inline = (tokens: Token[], idx: number) => sanitizeHtml(tokens[idx].content, preview, security);

  const renderCodeBlock = (token: Token, content: string, codeLanguage: string, options: MarkdownRendererOptions, env: MarkdownRenderEnv): string => {
    const normalizedLanguage = codeLanguage.toLowerCase();
    const languageClass = normalizedLanguage ? ` class="${escapeHtml(`${options.langPrefix || 'language-'}${normalizedLanguage}`)}"` : '';
    const lineStart = Array.isArray(token.map) ? token.map[0] + env.bodyLineOffset : -1;
    const highlighted = markdown.codeHighlight && options.highlight
      ? options.highlight(content, normalizedLanguage, '')
      : '';
    const codeHtml = highlighted || escapeHtml(content);
    const languageOptions = renderCodeLanguageOptions(normalizedLanguage, text.preview.plainText);
    const lineStartAttr = lineStart >= 0 ? ` data-line-start="${lineStart}"` : '';

    return [
      `<div class="md-code-block" data-code-kind="${token.type === 'fence' ? 'fence' : 'indented'}"${lineStartAttr}>`,
      '<div class="md-code-toolbar">',
      `<select class="md-code-language-select" aria-label="${escapeHtml(text.preview.codeLanguage)}" data-code-language="${escapeHtml(normalizedLanguage)}">${languageOptions}</select>`,
      `<button type="button" class="md-code-copy" aria-label="${escapeHtml(text.preview.copyCode)}">${escapeHtml(text.preview.copyCode)}</button>`,
      '</div>',
      `<pre class="md-code-pre"><code${languageClass}>${codeHtml}</code></pre>`,
      '</div>',
    ].join('');
  };

  md.renderer.rules.fence = (tokens: Token[], idx: number, options, env) => {
    const token = tokens[idx];
    return renderCodeBlock(token, token.content, extractCodeLanguage(token.info), options, env as MarkdownRenderEnv);
  };

  md.renderer.rules.code_block = (tokens: Token[], idx: number, options, env) => {
    return renderCodeBlock(tokens[idx], tokens[idx].content, '', options, env as MarkdownRenderEnv);
  };

  const renderImage = md.renderer.rules.image ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src');
    if (src) {
      const imageSource = resolveMarkdownImageSource(src, documentPath);
      token.attrSet('src', imageSource.src);
      token.attrSet('data-orcha-image', 'true');
      token.attrSet('data-orcha-original-src', imageSource.originalSrc);
      token.attrSet('data-orcha-resolved-src', imageSource.src);
      if (imageSource.filePath) token.attrSet('data-orcha-file-path', imageSource.filePath);
      if (imageSource.note) token.attrSet('data-orcha-note', imageSource.note);
    }
    token.attrSet('loading', 'lazy');
    return renderImage(tokens, idx, options, env, self);
  };

  return md;
}

function renderMarkdown(content: string, markdown: MarkdownSettings, preview: PreviewSettings, security: SecuritySettings, language: string, documentPath?: string): string {
  const frontMatter = extractFrontMatter(content, markdown.frontMatter);
  const env: MarkdownRenderEnv = { headings: [], slugCounts: {}, bodyLineOffset: frontMatter.lineOffset };
  const md = createMd(markdown, preview, security, language, documentPath);
  const raw = frontMatter.html + md.render(normalizeMarkdownImageSyntax(frontMatter.body), env);
  return injectToc(raw, markdown, env.headings);
}

function replaceFenceLanguage(content: string, lineStart: number, language: string): string {
  if (lineStart < 0) return content;
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const line = lines[lineStart];
  if (typeof line !== 'string') return content;
  const match = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
  if (!match) return content;

  const currentInfo = match[3].trim();
  const trailingInfo = currentInfo ? currentInfo.replace(/^\S+\s*/, '').trim() : '';
  const nextInfo = [language, trailingInfo].filter(Boolean).join(' ');
  lines[lineStart] = `${match[1]}${match[2]}${nextInfo}`;
  return lines.join(newline);
}

export default function Preview() {
  const { state, dispatch } = useApp();
  const general = useSettingsStore(s => s.general);
  const markdown = useSettingsStore(s => s.markdown);
  const preview = useSettingsStore(s => s.preview);
  const security = useSettingsStore(s => s.security);
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);
  const previewRef = useRef<HTMLDivElement>(null);
  const appLanguage = normalizeAppLanguage(general.language);
  const text = getLocaleText(appLanguage);
  const isHidden = state.viewMode === 'edit' || state.viewMode === 'block';

  const html = useMemo(() => {
    if (!activeTab || isHidden) return '';
    const raw = renderMarkdown(activeTab.content, markdown, preview, security, appLanguage, activeTab.path);
    return highlightSearch(applySecurity(raw, security, appLanguage), state.searchQuery);
  }, [activeTab, appLanguage, isHidden, markdown, preview, security, state.searchQuery]);

  // Highlight active match when searchMatchIndex changes
  useEffect(() => {
    if (isHidden) return;
    if (!previewRef.current || !state.searchQuery) return;
    const marks = previewRef.current.querySelectorAll('mark.search-highlight');
    if (marks.length === 0) return;
    marks.forEach(m => m.classList.remove('active'));
    const idx = ((state.searchMatchIndex % marks.length) + marks.length) % marks.length;
    marks[idx]?.classList.add('active');
    marks[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [isHidden, state.searchMatchIndex, state.searchQuery]);

  useEffect(() => {
    if (isHidden) return;
    const root = previewRef.current;
    if (!root) return;

    const buildImageLoadError = async (image: HTMLImageElement) => {
      const filePath = image.dataset.orchaFilePath || '';
      const exists = filePath
        ? await pathExists(filePath).then(value => value ? text.preview.existsYes : text.preview.existsNo).catch(error => text.preview.checkFailed(String(error)))
        : text.preview.localPathMissing;
      const details = [
        `${text.preview.fileExists}：${exists}`,
        `${text.preview.markdownPath}：${image.dataset.orchaOriginalSrc || image.getAttribute('src') || ''}`,
        `${text.preview.localPath}：${filePath || text.preview.noLocalPath}`,
        `${text.preview.resourceUrl}：${image.dataset.orchaResolvedSrc || image.currentSrc || image.src || ''}`,
        image.dataset.orchaNote ? `${text.preview.parseNote}：${image.dataset.orchaNote}` : '',
      ].filter(Boolean).join('\n');

      const box = document.createElement('span');
      box.className = 'md-image-load-error';
      box.setAttribute('role', 'note');

      const title = document.createElement('strong');
      title.textContent = text.preview.imageLoadFailed;

      const code = document.createElement('code');
      code.textContent = details;

      box.append(title, code);
      image.replaceWith(box);
    };

    const handleImageFailure = (image: HTMLImageElement | null) => {
      if (!image || image.dataset.orchaFailed === 'true') return;
      image.dataset.orchaFailed = 'true';
      void buildImageLoadError(image);
    };

    const handleImageError = (event: Event) => {
      handleImageFailure(event.currentTarget as HTMLImageElement | null);
    };

    const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-orcha-image="true"]'));
    images.forEach(image => {
      image.addEventListener('error', handleImageError, { once: true });
      if (image.complete && image.naturalWidth === 0) {
        handleImageFailure(image);
      }
    });

    const handleClick = (event: MouseEvent) => {
      const copyButton = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button.md-code-copy');
      if (copyButton) {
        event.preventDefault();
        const code = copyButton.closest('.md-code-block')?.querySelector('code')?.textContent || '';
        void copyTextToClipboard(code).then(() => {
            copyButton.classList.add('is-copied');
            copyButton.textContent = text.preview.copiedCode;
            window.setTimeout(() => {
              copyButton.classList.remove('is-copied');
              copyButton.textContent = text.preview.copyCode;
            }, 1200);
          }).catch(() => {
          copyButton.textContent = text.preview.copyFailed;
          window.setTimeout(() => {
            copyButton.textContent = text.preview.copyCode;
          }, 1200);
        });
        return;
      }

      const languageSelect = (event.target as HTMLElement | null)?.closest<HTMLSelectElement>('select.md-code-language-select');
      if (languageSelect) {
        event.stopPropagation();
        return;
      }

      const link = (event.target as HTMLElement | null)?.closest('a');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return;

      event.preventDefault();
      if (security.confirmExternalLinks && !window.confirm(text.preview.externalLinkConfirm(href))) {
        return;
      }

      if (preview.openExternalLink) {
        void openPath(href);
      } else {
        window.location.href = href;
      }
    };

    const handleChange = (event: Event) => {
      const select = (event.target as HTMLElement | null)?.closest<HTMLSelectElement>('select.md-code-language-select');
      if (!select) return;

      const codeBlock = select.closest<HTMLElement>('.md-code-block');
      const code = codeBlock?.querySelector<HTMLElement>('code');
      if (!codeBlock || !code) return;

      const nextLanguage = select.value;
      const codeText = code.textContent || '';
      code.className = nextLanguage ? `language-${nextLanguage}` : '';
      code.innerHTML = renderHighlightedCode(codeText, nextLanguage, markdown.codeHighlight);
      select.dataset.codeLanguage = nextLanguage;

      const lineStart = Number(codeBlock.dataset.lineStart);
      if (codeBlock.dataset.codeKind === 'fence' && activeTab && Number.isFinite(lineStart)) {
        const nextContent = replaceFenceLanguage(activeTab.content, lineStart, nextLanguage);
        if (nextContent !== activeTab.content) {
          dispatch({ type: 'UPDATE_TAB_CONTENT', payload: { id: activeTab.id, content: nextContent } });
        }
      }
    };

    root.addEventListener('click', handleClick);
    root.addEventListener('change', handleChange);
    return () => {
      root.removeEventListener('click', handleClick);
      root.removeEventListener('change', handleChange);
      images.forEach(image => image.removeEventListener('error', handleImageError));
    };
  }, [activeTab, dispatch, html, isHidden, markdown.codeHighlight, preview.openExternalLink, security.confirmExternalLinks, text]);

  const previewThemeClassName = getPreviewThemeClassName(preview.previewTheme);
  const codeThemeClassName = getPreviewCodeThemeClassName(preview.codeTheme);

  return (
    <div className={`preview-panel ${isHidden ? 'hidden' : ''}`}>
      {activeTab ? (
        <div
          ref={previewRef}
          className={`md-preview ${previewThemeClassName} ${codeThemeClassName}`}
          style={{ '--preview-image-max-width': `${preview.imageMaxWidth}px` } as React.CSSProperties}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="empty-state">
          <p>{text.preview.empty}</p>
        </div>
      )}
    </div>
  );
}

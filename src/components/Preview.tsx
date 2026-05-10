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

interface HeadingInfo {
  level: number;
  title: string;
  id: string;
}

interface MarkdownRenderEnv {
  headings: HeadingInfo[];
  slugCounts: Record<string, number>;
}

function escapeHtml(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function extractFrontMatter(content: string, enabled: boolean): { body: string; html: string } {
  if (!enabled) return { body: content, html: '' };
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { body: content, html: '' };

  const raw = match[1].trim();
  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.match(/^([^:#][^:]*):\s*(.*)$/))
    .filter((line): line is RegExpMatchArray => Boolean(line));

  const body = content.slice(match[0].length);
  if (rows.length === 0) {
    return {
      body,
      html: `<section class="md-frontmatter"><pre>${escapeHtml(raw)}</pre></section>`,
    };
  }

  const html = rows
    .map((row) => (
      `<div class="md-frontmatter-row"><dt>${escapeHtml(row[1].trim())}</dt><dd>${escapeHtml(row[2].trim())}</dd></div>`
    ))
    .join('');

  return { body, html: `<dl class="md-frontmatter">${html}</dl>` };
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

function applySecurity(html: string, security: SecuritySettings): string {
  let next = html;
  if (!security.allowExternalContent) {
    next = next.replace(
      /<img([^>]+?)src=["']https?:\/\/[^"']+["']([^>]*)>/gi,
      '<span class="blocked-external-content">外部图片已隐藏</span>',
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
function createMd(markdown: MarkdownSettings, preview: PreviewSettings, security: SecuritySettings, documentPath?: string) {
  const md = new MarkdownIt(markdown.dialect === 'commonmark' ? 'commonmark' : 'default', {
    html: preview.htmlRender !== 'disable',
    linkify: true,
    typographer: true,
    breaks: markdown.dialect === 'gfm',
    langPrefix: 'language-',
    highlight: markdown.codeHighlight
      ? (content, language) => {
        if (language && hljs.getLanguage(language)) {
          try {
            return hljs.highlight(content, { language, ignoreIllegals: true }).value;
          } catch {
            return escapeHtml(content);
          }
        }
        return escapeHtml(content);
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

function renderMarkdown(content: string, markdown: MarkdownSettings, preview: PreviewSettings, security: SecuritySettings, documentPath?: string): string {
  const frontMatter = extractFrontMatter(content, markdown.frontMatter);
  const env: MarkdownRenderEnv = { headings: [], slugCounts: {} };
  const md = createMd(markdown, preview, security, documentPath);
  const raw = frontMatter.html + md.render(normalizeMarkdownImageSyntax(frontMatter.body), env);
  return injectToc(raw, markdown, env.headings);
}

export default function Preview() {
  const { state } = useApp();
  const markdown = useSettingsStore(s => s.markdown);
  const preview = useSettingsStore(s => s.preview);
  const security = useSettingsStore(s => s.security);
  const activeTab = state.tabs.find(t => t.id === state.activeTabId);
  const previewRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    if (!activeTab) return '';
    const raw = renderMarkdown(activeTab.content, markdown, preview, security, activeTab.path);
    return highlightSearch(applySecurity(raw, security), state.searchQuery);
  }, [activeTab, markdown, preview, security, state.searchQuery]);

  // Highlight active match when searchMatchIndex changes
  useEffect(() => {
    if (!previewRef.current || !state.searchQuery) return;
    const marks = previewRef.current.querySelectorAll('mark.search-highlight');
    if (marks.length === 0) return;
    marks.forEach(m => m.classList.remove('active'));
    const idx = ((state.searchMatchIndex % marks.length) + marks.length) % marks.length;
    marks[idx]?.classList.add('active');
    marks[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [state.searchMatchIndex, state.searchQuery]);

  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;

    const buildImageLoadError = async (image: HTMLImageElement) => {
      const filePath = image.dataset.orchaFilePath || '';
      const exists = filePath
        ? await pathExists(filePath).then(value => value ? '是' : '否').catch(error => `检查失败：${String(error)}`)
        : '未解析到本地路径';
      const details = [
        `文件存在：${exists}`,
        `Markdown 路径：${image.dataset.orchaOriginalSrc || image.getAttribute('src') || ''}`,
        `本地路径：${filePath || '无'}`,
        `资源地址：${image.dataset.orchaResolvedSrc || image.currentSrc || image.src || ''}`,
        image.dataset.orchaNote ? `解析备注：${image.dataset.orchaNote}` : '',
      ].filter(Boolean).join('\n');

      const box = document.createElement('span');
      box.className = 'md-image-load-error';
      box.setAttribute('role', 'note');

      const title = document.createElement('strong');
      title.textContent = '图片加载失败';

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
      const link = (event.target as HTMLElement | null)?.closest('a');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return;

      event.preventDefault();
      if (security.confirmExternalLinks && !window.confirm(`打开外部链接？\n${href}`)) {
        return;
      }

      if (preview.openExternalLink) {
        void openPath(href);
      } else {
        window.location.href = href;
      }
    };

    root.addEventListener('click', handleClick);
    return () => {
      root.removeEventListener('click', handleClick);
      images.forEach(image => image.removeEventListener('error', handleImageError));
    };
  }, [preview.openExternalLink, security.confirmExternalLinks, html]);

  const isHidden = state.viewMode === 'edit';
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
          <p>打开或创建一个文件开始预览</p>
        </div>
      )}
    </div>
  );
}

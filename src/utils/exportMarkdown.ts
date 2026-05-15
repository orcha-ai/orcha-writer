import MarkdownIt from 'markdown-it';
import { readBinaryFile } from './fs';
import { normalizeMarkdownImageSyntax, resolveMarkdownImageSource } from './markdownImages';
import { isMermaidLanguage, nextMermaidRenderId, renderMermaidSvg, resolveMermaidTheme } from './mermaid';

interface PendingImage {
  marker: string;
  filePath: string;
}

interface PendingMermaidDiagram {
  marker: string;
  source: string;
}

function mimeTypeForPath(path: string): string {
  const ext = path.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'bmp':
      return 'image/bmp';
    case 'avif':
      return 'image/avif';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'png':
    default:
      return 'image/png';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function escapeHtml(content: string): string {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function renderMarkdownForExport(content: string, documentPath?: string): Promise<string> {
  const pendingImages: PendingImage[] = [];
  const pendingMermaidDiagrams: PendingMermaidDiagram[] = [];
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true });
  const renderImage = md.renderer.rules.image ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const renderFence = md.renderer.rules.fence ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const language = token.info.trim().split(/\s+/)[0]?.replace(/[^\w#+.-]/g, '') || '';
    if (!isMermaidLanguage(language)) {
      return renderFence(tokens, idx, options, env, self);
    }

    const marker = `__ORCHA_EXPORT_MERMAID_${pendingMermaidDiagrams.length}__`;
    pendingMermaidDiagrams.push({ marker, source: token.content });
    return `<div class="md-mermaid md-mermaid-export">${marker}</div>`;
  };

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src');

    if (src) {
      const imageSource = resolveMarkdownImageSource(src, documentPath);
      if (imageSource.filePath) {
        const marker = `__ORCHA_EXPORT_IMAGE_${pendingImages.length}__`;
        pendingImages.push({ marker, filePath: imageSource.filePath });
        token.attrSet('src', marker);
      } else {
        token.attrSet('src', imageSource.src);
      }
    }

    return renderImage(tokens, idx, options, env, self);
  };

  let html = md.render(normalizeMarkdownImageSyntax(content));

  await Promise.all(pendingImages.map(async ({ marker, filePath }) => {
    try {
      const bytes = await readBinaryFile(filePath);
      const dataUrl = `data:${mimeTypeForPath(filePath)};base64,${bytesToBase64(bytes)}`;
      html = html.replace(new RegExp(escapeRegExp(marker), 'g'), dataUrl);
    } catch {
      html = html.replace(new RegExp(escapeRegExp(marker), 'g'), '');
    }
  }));

  const mermaidTheme = resolveMermaidTheme();
  for (const { marker, source } of pendingMermaidDiagrams) {
    try {
      const { svg } = await renderMermaidSvg(source, nextMermaidRenderId('orcha-export-mermaid'), mermaidTheme);
      html = html.replace(
        new RegExp(escapeRegExp(marker), 'g'),
        `<div style="margin:1em 0;overflow-x:auto;text-align:center;">${svg}</div>`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      html = html.replace(
        new RegExp(escapeRegExp(marker), 'g'),
        `<pre><code>${escapeHtml(`Mermaid render failed:\n${message}\n\n${source}`)}</code></pre>`,
      );
    }
  }

  return html;
}

import MarkdownIt from 'markdown-it';
import { readBinaryFile } from './fs';
import { normalizeMarkdownImageSyntax, resolveMarkdownImageSource } from './markdownImages';

interface PendingImage {
  marker: string;
  filePath: string;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function renderMarkdownForExport(content: string, documentPath?: string): Promise<string> {
  const pendingImages: PendingImage[] = [];
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true });
  const renderImage = md.renderer.rules.image ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

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

  return html;
}

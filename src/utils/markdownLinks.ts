export type MarkdownLinkTarget =
  | { kind: 'anchor'; fragment: string }
  | { kind: 'file'; path: string; fragment: string }
  | { kind: 'external'; href: string }
  | { kind: 'invalid'; reason: 'missing-document-path' | 'invalid-path' };

const WINDOWS_PATH_RE = /^[a-z]:[\\/]/i;
const SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function documentFileUrl(path: string): URL | undefined {
  const normalized = path.replace(/\\/g, '/');
  if (!normalized.startsWith('/') && !WINDOWS_PATH_RE.test(normalized)) return undefined;
  const windowsPath = WINDOWS_PATH_RE.test(normalized);
  const encoded = normalized.split('/')
    .map((part, index) => windowsPath && index === 0 ? part : encodeURIComponent(part))
    .join('/');
  return new URL(windowsPath ? `file:///${encoded}` : `file://${encoded}`);
}

/** Resolve document links against the file on disk, never the application's route. */
export function resolveMarkdownLink(href: string, documentPath?: string): MarkdownLinkTarget {
  const value = href.trim();
  if (!value || value.startsWith('#')) {
    return { kind: 'anchor', fragment: decodeFragment(value.slice(1)) };
  }
  if (value.startsWith('//') || (SCHEME_RE.test(value) && !WINDOWS_PATH_RE.test(value) && !/^file:/i.test(value))) {
    return { kind: 'external', href: value };
  }

  try {
    const normalized = value.replace(/\\/g, '/');
    const base = documentPath ? documentFileUrl(documentPath) : undefined;
    let url: URL;
    if (/^file:/i.test(normalized)) {
      url = new URL(normalized);
    } else if (WINDOWS_PATH_RE.test(normalized)) {
      url = new URL(`file:///${normalized}`);
    } else if (normalized.startsWith('/')) {
      url = new URL(normalized, base ?? 'file:///');
    } else {
      if (!base) return { kind: 'invalid', reason: 'missing-document-path' };
      url = new URL(normalized, base);
    }

    let path = decodeURIComponent(url.pathname);
    if (url.hostname) path = `//${url.hostname}${path}`;
    else if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
    return { kind: 'file', path, fragment: decodeFragment(url.hash.slice(1)) };
  } catch {
    return { kind: 'invalid', reason: 'invalid-path' };
  }
}

export function scrollToMarkdownAnchor(root: HTMLElement, fragment: string): boolean {
  const target = fragment
    ? Array.from(root.querySelectorAll<HTMLElement>('[id], a[name]'))
      .find(element => element.id === fragment || element.getAttribute('name') === fragment)
    : root;
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

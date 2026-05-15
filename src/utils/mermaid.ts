const MERMAID_LANGUAGES = new Set(['mermaid', 'mmd']);

type MermaidApi = typeof import('mermaid').default;

let configuredTheme: 'default' | 'dark' | null = null;
let renderCounter = 0;
let mermaidApiPromise: Promise<MermaidApi> | null = null;

export function isMermaidLanguage(language: string): boolean {
  return MERMAID_LANGUAGES.has(language.trim().toLowerCase());
}

export function resolveMermaidTheme(themeMode?: 'light' | 'dark' | 'system'): 'default' | 'dark' {
  if (themeMode === 'dark') return 'dark';
  if (themeMode === 'light') return 'default';

  if (typeof document !== 'undefined') {
    const explicitTheme = document.documentElement.getAttribute('data-theme');
    if (explicitTheme === 'dark') return 'dark';
    if (explicitTheme === 'light') return 'default';
  }

  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }

  return 'default';
}

export function nextMermaidRenderId(prefix = 'orcha-mermaid'): string {
  renderCounter += 1;
  return `${prefix}-${Date.now()}-${renderCounter}`;
}

async function loadMermaid(): Promise<MermaidApi> {
  mermaidApiPromise ??= import('mermaid').then(module => module.default);
  return mermaidApiPromise;
}

async function configureMermaid(theme: 'default' | 'dark' = resolveMermaidTheme()): Promise<MermaidApi> {
  const mermaid = await loadMermaid();
  if (configuredTheme === theme) return mermaid;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
  });
  configuredTheme = theme;

  return mermaid;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Mermaid render timed out'));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function renderMermaidSvg(source: string, id: string, theme?: 'default' | 'dark', timeoutMs = 8000) {
  return withTimeout((async () => {
    const mermaid = await configureMermaid(theme);
    return mermaid.render(id, source);
  })(), timeoutMs);
}

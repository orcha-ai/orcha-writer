export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  available: boolean;
}

const CURRENT_VERSION = '0.1.0';
const LATEST_RELEASE_API = 'https://api.github.com/repos/orcha-ai/orcha-writer/releases/latest';

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a).split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const right = normalizeVersion(b).split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });

  if (!response.ok) {
    throw new Error(`检查更新失败：HTTP ${response.status}`);
  }

  const release = await response.json() as {
    tag_name?: string;
    name?: string;
    html_url?: string;
  };
  const latestVersion = release.tag_name || release.name || CURRENT_VERSION;
  const releaseUrl = release.html_url || 'https://github.com/orcha-ai/orcha-writer/releases';

  return {
    currentVersion: CURRENT_VERSION,
    latestVersion,
    releaseUrl,
    available: compareVersions(latestVersion, CURRENT_VERSION) > 0,
  };
}

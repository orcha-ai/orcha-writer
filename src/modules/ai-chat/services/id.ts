export function createAIId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

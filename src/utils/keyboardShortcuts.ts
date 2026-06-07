const shortcutModifiers = new Set(['Meta', 'Ctrl', 'Alt', 'Shift']);
const doubleShortcutPrefix = 'Double ';

export function normalizeShortcutKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'Control') return 'Ctrl';
  if (key === 'OS') return 'Meta';
  return key.length === 1 ? key.toUpperCase() : key;
}

export function isShortcutModifier(key: string): boolean {
  return shortcutModifiers.has(normalizeShortcutKey(key));
}

export function doubleShortcutKey(shortcut: string): string | null {
  const value = shortcut.trim();
  if (!value.startsWith(doubleShortcutPrefix)) return null;
  return value.slice(doubleShortcutPrefix.length).trim() || null;
}

export function isDoubleKeyShortcut(shortcut: string): boolean {
  return Boolean(doubleShortcutKey(shortcut));
}

export function isPlainKeyPress(event: KeyboardEvent | React.KeyboardEvent): boolean {
  const key = normalizeShortcutKey(event.key);
  return (!event.metaKey || key === 'Meta')
    && (!event.ctrlKey || key === 'Ctrl')
    && (!event.altKey || key === 'Alt')
    && (!event.shiftKey || key === 'Shift');
}

export function matchesDoubleShortcutKey(event: KeyboardEvent, shortcut: string): boolean {
  const key = doubleShortcutKey(shortcut);
  if (!key || event.repeat || !isPlainKeyPress(event)) return false;
  return normalizeShortcutKey(event.key) === normalizeShortcutKey(key);
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut || isDoubleKeyShortcut(shortcut)) return false;
  const parts = shortcut.split('+').map(part => part.trim()).filter(Boolean);
  const key = parts.find(part => !shortcutModifiers.has(part));
  if (!key) return false;

  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const wantsMeta = parts.includes('Meta');
  const wantsCtrl = parts.includes('Ctrl');
  const expectedMeta = isMac && wantsMeta;
  const expectedCtrl = wantsCtrl || (!isMac && wantsMeta);

  return event.metaKey === expectedMeta
    && event.ctrlKey === expectedCtrl
    && event.altKey === parts.includes('Alt')
    && event.shiftKey === parts.includes('Shift')
    && normalizeShortcutKey(event.key) === normalizeShortcutKey(key);
}

export function doubleShortcutValue(key: string): string {
  return `${doubleShortcutPrefix}${normalizeShortcutKey(key)}`;
}

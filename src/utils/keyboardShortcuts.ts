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

export function createDoubleKeyShortcutMatcher(shortcut: string) {
  const intervalMs = 300;
  const maxHoldMs = 200;
  let pressed: { code: string; at: number } | null = null;
  let lastTap: { code: string; at: number } | null = null;
  let composing = false;
  let compositionEndedAt = -Infinity;

  const reset = () => {
    pressed = null;
    lastTap = null;
  };

  const handleEvent = (event: Event): boolean => {
    if (event.type === 'compositionstart') {
      composing = true;
      reset();
      return false;
    }
    if (event.type === 'compositionend') {
      composing = false;
      compositionEndedAt = event.timeStamp;
      reset();
      return false;
    }
    if (event.type !== 'keydown' && event.type !== 'keyup') {
      if (event.type === 'blur' || event.type === 'visibilitychange') composing = false;
      reset();
      return false;
    }

    const keyEvent = event as KeyboardEvent;
    // IMEs may commit on Shift without marking the final keyup as composing.
    if (composing || keyEvent.isComposing || keyEvent.keyCode === 229
      || event.timeStamp - compositionEndedAt <= intervalMs
      || !matchesDoubleShortcutKey(keyEvent, shortcut)) {
      reset();
      return false;
    }

    const code = keyEvent.code || normalizeShortcutKey(keyEvent.key);
    if (event.type === 'keydown') {
      if (pressed) {
        reset();
        return false;
      }
      pressed = { code, at: event.timeStamp };
      return false;
    }

    if (!pressed || pressed.code !== code || event.timeStamp - pressed.at > maxHoldMs) {
      reset();
      return false;
    }
    pressed = null;
    if (lastTap?.code === code && event.timeStamp - lastTap.at <= intervalMs) {
      reset();
      return true;
    }
    lastTap = { code, at: event.timeStamp };
    return false;
  };

  return { handleEvent, reset };
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

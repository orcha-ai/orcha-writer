import assert from 'node:assert/strict';
import test from 'node:test';
import { createDoubleKeyShortcutMatcher } from '../src/utils/keyboardShortcuts.ts';

function key(type, timeStamp, overrides = {}) {
  return {
    type, timeStamp, key: 'Shift', code: 'ShiftLeft',
    shiftKey: type === 'keydown', ctrlKey: false, altKey: false, metaKey: false,
    repeat: false, isComposing: false, keyCode: 16,
    ...overrides,
  };
}

function tap(matcher, at, overrides = {}) {
  assert.equal(matcher.handleEvent(key('keydown', at, overrides)), false);
  return matcher.handleEvent(key('keyup', at + 40, overrides));
}

test('requires two complete taps and triggers only after the second release', () => {
  const matcher = createDoubleKeyShortcutMatcher('Double Shift');
  assert.equal(tap(matcher, 0), false);
  assert.equal(tap(matcher, 120), true);
  assert.equal(tap(matcher, 240), false);
});

test('typing and modifier combinations cancel the previous tap', () => {
  for (const overrides of [
    { key: 'a', code: 'KeyA', shiftKey: false },
    { key: 'A', code: 'KeyA', shiftKey: true },
    { ctrlKey: true },
  ]) {
    const matcher = createDoubleKeyShortcutMatcher('Double Shift');
    tap(matcher, 0);
    assert.equal(matcher.handleEvent(key('keydown', 60, overrides)), false);
    assert.equal(matcher.handleEvent(key('keyup', 80, overrides)), false);
    assert.equal(tap(matcher, 120), false);
    assert.equal(tap(matcher, 240), true);
  }
});

test('Shift used to type an uppercase letter is not a standalone tap', () => {
  const matcher = createDoubleKeyShortcutMatcher('Double Shift');
  matcher.handleEvent(key('keydown', 0));
  matcher.handleEvent(key('keydown', 20, { key: 'A', code: 'KeyA' }));
  matcher.handleEvent(key('keyup', 40, { key: 'A', code: 'KeyA', shiftKey: true }));
  assert.equal(matcher.handleEvent(key('keyup', 60)), false);
  assert.equal(tap(matcher, 120), false);
});

test('rejects long holds, repeated keydowns, missing releases, slow taps and different physical keys', () => {
  for (const events of [
    [key('keydown', 0), key('keyup', 220)],
    [key('keydown', 0), key('keydown', 20, { repeat: true }), key('keyup', 40)],
    [key('keydown', 0), key('keydown', 20), key('keyup', 40)],
    [key('keyup', 40)],
    [key('keydown', -400), key('keyup', -360)],
    [key('keydown', 0, { code: 'ShiftRight' }), key('keyup', 40, { code: 'ShiftRight' })],
  ]) {
    const matcher = createDoubleKeyShortcutMatcher('Double Shift');
    for (const event of events) assert.equal(matcher.handleEvent(event), false);
    assert.equal(tap(matcher, 260), false);
  }
});

test('composition and the Shift release used to commit it cannot trigger search', () => {
  const matcher = createDoubleKeyShortcutMatcher('Double Shift');
  tap(matcher, 0);
  matcher.handleEvent({ type: 'compositionstart', timeStamp: 60 });
  assert.equal(tap(matcher, 80), false);
  matcher.handleEvent({ type: 'compositionend', timeStamp: 140 });
  assert.equal(matcher.handleEvent(key('keyup', 150)), false);
  assert.equal(tap(matcher, 180), false);
  assert.equal(tap(matcher, 500), false);
  assert.equal(tap(matcher, 620), true);
});

test('IME keyboard flags cancel pending taps even without composition events', () => {
  for (const overrides of [{ isComposing: true }, { keyCode: 229 }]) {
    const matcher = createDoubleKeyShortcutMatcher('Double Shift');
    tap(matcher, 0);
    assert.equal(tap(matcher, 80, overrides), false);
    assert.equal(tap(matcher, 180), false);
  }
});

test('input, pointer and focus interruptions cancel pending taps', () => {
  for (const type of ['input', 'pointerdown', 'focusin', 'blur', 'visibilitychange']) {
    const matcher = createDoubleKeyShortcutMatcher('Double Shift');
    tap(matcher, 0);
    assert.equal(matcher.handleEvent({ type, timeStamp: 60 }), false);
    assert.equal(tap(matcher, 120), false);
  }
});

test('supports a customized double-key shortcut', () => {
  const matcher = createDoubleKeyShortcutMatcher('Double Alt');
  const overrides = { key: 'Alt', code: 'AltLeft', shiftKey: false };
  assert.equal(tap(matcher, 0, overrides), false);
  assert.equal(tap(matcher, 120, overrides), true);
});

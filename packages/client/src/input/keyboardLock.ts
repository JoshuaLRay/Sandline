/**
 * Fullscreen + Keyboard Lock (PLAN.md §8 R13): the browser-sanctioned way for
 * a page to reclaim a reserved shortcut like Ctrl+W, which no
 * `preventDefault` can touch (B-06). Chromium-only — `navigator.keyboard` has
 * no `lock` in Firefox or Safari, so every function here is a no-op there and
 * those browsers fall back to whatever `preventDefault` already covers.
 *
 * The API only works while the page itself is in fullscreen (`element.
 * requestFullscreen()`, not the browser's own F11), so entering fullscreen
 * and requesting the lock are the same gesture in practice; `armKeyboardLock`
 * wires the second to the browser's own `fullscreenchange` event so it stays
 * correct across exits (Esc held, F11, the browser's own UI) that this code
 * never sees directly.
 *
 * Tab, Alt and the OS key are deliberately left out of the lock
 * (`LOCKED_KEY_CODES`): a no-argument `lock()` captures Alt+Tab too, and
 * Alt+Tab (Cmd+Tab, Win+Tab) is how people get out of a fullscreen game.
 * With those unlocked the OS sees the whole chord and switches windows; the
 * page loses focus, fullscreen stays, and coming back resumes as before.
 */

interface KeyboardLockApi {
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
}

/**
 * Every `KeyboardEvent.code` the lock reclaims — the UI Events code set minus
 * Tab, Alt and Meta, so Alt+Tab, Cmd+Tab and Win+Tab stay the OS's.
 * Chromium locks by physical key, not by combination, and a locked key never
 * reaches the OS at all: with Alt locked the OS never learns Alt is down and
 * sees Alt+Tab as a bare Tab, so leaving Tab alone out is not enough — the
 * modifier has to go too. What that gives back to the OS is what every other
 * fullscreen game gives back (Alt+F4, the Windows key); the shortcuts the
 * lock exists for are Ctrl ones (B-06), and Ctrl stays locked. The game binds
 * nothing to Tab, Alt or Meta.
 */
export const LOCKED_KEY_CODES: readonly string[] = [
  // Writing system keys
  'Backquote', 'Backslash', 'BracketLeft', 'BracketRight', 'Comma', 'Equal',
  'IntlBackslash', 'IntlRo', 'IntlYen', 'Minus', 'Period', 'Quote', 'Semicolon', 'Slash',
  ...'0123456789'.split('').map((d) => `Digit${d}`),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `Key${l}`),
  // Functional keys
  'Backspace', 'CapsLock', 'ContextMenu', 'ControlLeft', 'ControlRight', 'Enter',
  'ShiftLeft', 'ShiftRight', 'Space',
  'Convert', 'KanaMode', 'Lang1', 'Lang2', 'NonConvert',
  // Control pad and arrows
  'Delete', 'End', 'Help', 'Home', 'Insert', 'PageDown', 'PageUp',
  'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
  // Numpad
  'NumLock', ...'0123456789'.split('').map((d) => `Numpad${d}`), 'NumpadAdd',
  'NumpadComma', 'NumpadDecimal', 'NumpadDivide', 'NumpadEnter', 'NumpadEqual',
  'NumpadMultiply', 'NumpadSubtract',
  // Function section
  'Escape', ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`), 'Fn', 'FnLock',
  'PrintScreen', 'ScrollLock', 'Pause',
  // Media and browser keys
  'BrowserBack', 'BrowserFavorites', 'BrowserForward', 'BrowserHome', 'BrowserRefresh',
  'BrowserSearch', 'BrowserStop', 'LaunchApp1', 'LaunchApp2', 'LaunchMail',
  'MediaPlayPause', 'MediaSelect', 'MediaStop', 'MediaTrackNext', 'MediaTrackPrevious',
  'AudioVolumeDown', 'AudioVolumeMute', 'AudioVolumeUp',
];

function keyboardLockApi(): KeyboardLockApi | undefined {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;
  return keyboard?.lock ? keyboard : undefined;
}

/** True if this browser can lock reserved keys at all (feature test, not fullscreen state). */
export function keyboardLockSupported(): boolean {
  return keyboardLockApi() !== undefined;
}

/**
 * Locks every reserved key but Tab, Alt and Meta (see `LOCKED_KEY_CODES`) while `element` is the fullscreen element, unlocks
 * on exit. Call once; the `fullscreenchange` listener lives for the page.
 * A no-op where the API doesn't exist.
 */
export function armKeyboardLock(element: Element): void {
  const keyboard = keyboardLockApi();
  if (!keyboard) return;
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === element) {
      // Refused locks (no user activation, an already-active lock) leave the
      // game playable under ordinary preventDefault rather than broken.
      keyboard.lock([...LOCKED_KEY_CODES]).catch(() => {});
    } else {
      keyboard.unlock();
    }
  });
}

/**
 * Requests fullscreen on `element` so `armKeyboardLock`'s listener picks it
 * up. Skipped entirely when the API isn't supported — fullscreen with no
 * lock behind it buys nothing but a jarring UI change for Ctrl+W's sake.
 */
export function requestFullscreenForKeyboardLock(element: Element): void {
  if (!keyboardLockSupported() || document.fullscreenElement) return;
  element.requestFullscreen?.().catch(() => {});
}

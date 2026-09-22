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
 */

interface KeyboardLockApi {
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
}

function keyboardLockApi(): KeyboardLockApi | undefined {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;
  return keyboard?.lock ? keyboard : undefined;
}

/** True if this browser can lock reserved keys at all (feature test, not fullscreen state). */
export function keyboardLockSupported(): boolean {
  return keyboardLockApi() !== undefined;
}

/**
 * Locks every reserved key while `element` is the fullscreen element, unlocks
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
      keyboard.lock().catch(() => {});
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

/**
 * PLAN.md §8 R13 / B-06 follow-up: Fullscreen + Keyboard Lock is the only way
 * to reclaim a browser-reserved shortcut like Ctrl+W. These tests exercise
 * the wiring against a fake `navigator`/`document` rather than a real
 * browser, since neither the Keyboard Lock nor Fullscreen APIs exist in Node.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCKED_KEY_CODES,
  armKeyboardLock,
  keyboardLockSupported,
  requestFullscreenForKeyboardLock,
} from './keyboardLock.ts';

type Listener = (event: unknown) => void;

function fakeDocument() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    fullscreenElement: null as unknown,
    addEventListener(type: string, cb: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    dispatch(type: string) {
      for (const cb of listeners.get(type) ?? []) cb({});
    },
  };
}

describe('keyboard lock (PLAN.md §8 R13)', () => {
  let doc: ReturnType<typeof fakeDocument>;

  // Node defines `navigator` as a getter-only global, so a plain assignment
  // throws; vitest's stubGlobal replaces it properly and unstubAllGlobals
  // restores it.
  function stubGlobals(keyboard: unknown) {
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', { keyboard });
  }

  beforeEach(() => {
    doc = fakeDocument();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('is unsupported when navigator.keyboard has no lock method', () => {
    stubGlobals(undefined);
    expect(keyboardLockSupported()).toBe(false);
  });

  it('locks on entering fullscreen on the target element, unlocks on exit', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const unlock = vi.fn();
    stubGlobals({ lock, unlock });
    expect(keyboardLockSupported()).toBe(true);

    const element = {} as Element;
    armKeyboardLock(element);

    doc.fullscreenElement = element;
    doc.dispatch('fullscreenchange');
    expect(lock).toHaveBeenCalledTimes(1);
    expect(unlock).not.toHaveBeenCalled();

    doc.fullscreenElement = null;
    doc.dispatch('fullscreenchange');
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('locks an explicit key list that leaves Tab, Alt and Meta out, so Alt+Tab reaches the OS', () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    stubGlobals({ lock, unlock: vi.fn() });

    const element = {} as Element;
    armKeyboardLock(element);
    doc.fullscreenElement = element;
    doc.dispatch('fullscreenchange');

    // No-argument lock() would capture every key, Alt+Tab included.
    const codes = lock.mock.calls[0]![0] as string[];
    expect(codes).toEqual([...LOCKED_KEY_CODES]);
    // A locked modifier never reaches the OS either, which then sees Alt+Tab
    // as a bare Tab — so the modifiers of every window-switch chord are out.
    for (const code of ['Tab', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']) {
      expect(codes).not.toContain(code);
    }
    // The shortcuts the lock exists for stay reclaimed.
    for (const code of ['KeyW', 'ControlLeft', 'ControlRight', 'Escape', 'F11']) {
      expect(codes).toContain(code);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('does not lock when fullscreen belongs to a different element', () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const unlock = vi.fn();
    stubGlobals({ lock, unlock });

    armKeyboardLock({} as Element);
    doc.fullscreenElement = {} as Element;
    doc.dispatch('fullscreenchange');
    expect(lock).not.toHaveBeenCalled();
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('requests fullscreen only when Keyboard Lock is supported and nothing is fullscreen yet', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const element = { requestFullscreen } as unknown as Element;

    stubGlobals(undefined);
    requestFullscreenForKeyboardLock(element);
    expect(requestFullscreen).not.toHaveBeenCalled();

    stubGlobals({ lock: vi.fn(), unlock: vi.fn() });
    requestFullscreenForKeyboardLock(element);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    doc.fullscreenElement = element;
    requestFullscreenForKeyboardLock(element);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });
});

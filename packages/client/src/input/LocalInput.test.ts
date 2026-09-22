/**
 * LocalInput's key handling: the stance toggles and what cancels them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalInput } from './LocalInput.ts';

type Listener = (event: unknown) => void;

function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, cb: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener(type: string, cb: Listener) {
      listeners.get(type)?.delete(cb);
    },
    dispatch(type: string, event: unknown = {}) {
      for (const cb of listeners.get(type) ?? []) cb(event);
    },
  };
}

describe('LocalInput', () => {
  let win: ReturnType<typeof fakeTarget>;
  let doc: ReturnType<typeof fakeTarget>;
  let restore: () => void;

  beforeEach(() => {
    win = fakeTarget();
    doc = fakeTarget();
    const g = globalThis as unknown as Record<string, unknown>;
    const previous = {
      addEventListener: g['addEventListener'],
      removeEventListener: g['removeEventListener'],
      document: g['document'],
      HTMLInputElement: g['HTMLInputElement'],
      HTMLTextAreaElement: g['HTMLTextAreaElement'],
      HTMLSelectElement: g['HTMLSelectElement'],
    };
    g['addEventListener'] = win.addEventListener.bind(win);
    g['removeEventListener'] = win.removeEventListener.bind(win);
    g['document'] = doc;
    // The test environment is Node, not a browser: isTextField's `instanceof`
    // checks need these classes to exist even though every dispatched event
    // here passes a null target.
    g['HTMLInputElement'] = class {};
    g['HTMLTextAreaElement'] = class {};
    g['HTMLSelectElement'] = class {};
    restore = () => {
      g['addEventListener'] = previous.addEventListener;
      g['removeEventListener'] = previous.removeEventListener;
      g['document'] = previous.document;
      g['HTMLInputElement'] = previous.HTMLInputElement;
      g['HTMLTextAreaElement'] = previous.HTMLTextAreaElement;
      g['HTMLSelectElement'] = previous.HTMLSelectElement;
    };
  });

  afterEach(() => restore());

  it('B-06: crouch is a toggle on C, not held-Ctrl', () => {
    const canvas = fakeTarget();
    const input = new LocalInput(canvas as unknown as HTMLElement);

    expect(input.crouching).toBe(false);
    win.dispatch('keydown', { code: 'ControlLeft', target: null });
    expect(input.crouching).toBe(false);

    win.dispatch('keydown', { code: 'KeyC', target: null });
    expect(input.crouching).toBe(true);
    // Auto-repeat while C is held down must not flip the toggle again.
    win.dispatch('keydown', { code: 'KeyC', target: null, repeat: true });
    expect(input.crouching).toBe(true);

    win.dispatch('keyup', { code: 'KeyC', target: null });
    expect(input.crouching).toBe(true);

    win.dispatch('keydown', { code: 'KeyC', target: null });
    expect(input.crouching).toBe(false);
  });

  it('prone is a toggle on Z, exclusive with the crouch toggle', () => {
    const canvas = fakeTarget();
    const input = new LocalInput(canvas as unknown as HTMLElement);
    const key = (code: string, extra: Record<string, unknown> = {}) =>
      win.dispatch('keydown', { code, target: null, ...extra });

    key('KeyZ');
    win.dispatch('keyup', { code: 'KeyZ', target: null });
    expect(input.proning).toBe(true);
    expect(input.sample().prone).toBe(true);
    key('KeyZ', { repeat: true });
    expect(input.proning).toBe(true);

    // C from prone goes to crouch, Z from crouch goes prone, Z again stands.
    key('KeyC');
    expect([input.proning, input.crouching]).toEqual([false, true]);
    key('KeyZ');
    expect([input.proning, input.crouching]).toEqual([true, false]);
    key('KeyZ');
    expect([input.proning, input.crouching]).toEqual([false, false]);
  });

  it('sprint cancels a toggled crouch or prone', () => {
    const canvas = fakeTarget();
    const input = new LocalInput(canvas as unknown as HTMLElement);

    win.dispatch('keydown', { code: 'KeyC', target: null });
    win.dispatch('keydown', { code: 'ShiftLeft', target: null });
    expect(input.crouching).toBe(false);
    expect(input.sample().sprint).toBe(true);
    win.dispatch('keyup', { code: 'ShiftLeft', target: null });

    win.dispatch('keydown', { code: 'KeyZ', target: null });
    win.dispatch('keydown', { code: 'ShiftRight', target: null });
    expect(input.proning).toBe(false);
  });

  it('jump stands up out of a toggled stance without also jumping', () => {
    const canvas = fakeTarget();
    const input = new LocalInput(canvas as unknown as HTMLElement);

    win.dispatch('keydown', { code: 'KeyZ', target: null });
    input.sample();
    // A tap entirely between two samples: stands, doesn't jump.
    win.dispatch('keydown', { code: 'Space', target: null, preventDefault() {} });
    win.dispatch('keyup', { code: 'Space', target: null });
    const stood = input.sample();
    expect([stood.prone, stood.crouch, stood.jump]).toEqual([false, false, false]);

    // Held through the stand-up: still no jump until Space is pressed again.
    win.dispatch('keydown', { code: 'KeyC', target: null });
    win.dispatch('keydown', { code: 'Space', target: null, preventDefault() {} });
    expect(input.sample().jump).toBe(false);
    expect(input.sample().jump).toBe(false);
    win.dispatch('keyup', { code: 'Space', target: null });

    // Standing, Space is an ordinary jump.
    win.dispatch('keydown', { code: 'Space', target: null, preventDefault() {} });
    expect(input.sample().jump).toBe(true);
  });

  it('held Ctrl crouches only while the page is fullscreen', () => {
    const canvas = fakeTarget();
    const root = {} as Element;
    const docWithFullscreen = doc as unknown as { fullscreenElement: unknown };
    const input = new LocalInput(canvas as unknown as HTMLElement, { fullscreenTarget: root });

    win.dispatch('keydown', { code: 'ControlLeft', target: null });
    expect(input.crouching).toBe(false);
    expect(input.sample().crouch).toBe(false);

    docWithFullscreen.fullscreenElement = root;
    expect(input.immersive).toBe(true);
    expect(input.crouching).toBe(true);
    expect(input.sample().crouch).toBe(true);

    win.dispatch('keyup', { code: 'ControlLeft', target: null });
    expect(input.crouching).toBe(false);

    // The C toggle still works on its own in fullscreen, and a Ctrl tap
    // doesn't cancel it.
    win.dispatch('keydown', { code: 'KeyC', target: null });
    win.dispatch('keydown', { code: 'ControlRight', target: null });
    win.dispatch('keyup', { code: 'ControlRight', target: null });
    expect(input.crouching).toBe(true);
  });
});

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

  it('one Escape press frees the mouse; F11 also leaves page fullscreen', () => {
    const canvas = fakeTarget();
    const root = {} as Element;
    const calls: string[] = [];
    const d = doc as unknown as Record<string, unknown>;
    d['fullscreenElement'] = root;
    d['exitPointerLock'] = () => calls.push('pointer');
    d['exitFullscreen'] = () => {
      calls.push('fullscreen');
      d['fullscreenElement'] = null;
      return Promise.resolve();
    };
    new LocalInput(canvas as unknown as HTMLElement, { fullscreenTarget: root });

    let prevented = false;
    const preventDefault = () => (prevented = true);
    win.dispatch('keydown', { code: 'Escape', target: null, preventDefault });
    expect(calls).toEqual(['pointer']);

    win.dispatch('keydown', { code: 'F11', target: null, preventDefault });
    expect(calls).toEqual(['pointer', 'fullscreen', 'pointer']);
    expect(prevented).toBe(true);

    // Not page-fullscreen: F11 stays the browser's own toggle.
    prevented = false;
    win.dispatch('keydown', { code: 'F11', target: null, preventDefault });
    expect(prevented).toBe(false);
    expect(calls).toEqual(['pointer', 'fullscreen', 'pointer', 'pointer']);
  });

  describe('the order wheel and the mark (T-3.29)', () => {
    /** An input with the pointer captured, as it is in play. */
    function captured() {
      const canvas = fakeTarget();
      const d = doc as unknown as Record<string, unknown>;
      d['pointerLockElement'] = canvas;
      const input = new LocalInput(canvas as unknown as HTMLElement);
      doc.dispatch('pointerlockchange');
      expect(input.locked).toBe(true);
      return input;
    }

    it("ignores the browser's bogus jump as the lock is taken, and turns for the moves after it", () => {
      const input = captured();
      const yaw = input.yaw;
      win.dispatch('mousemove', { movementX: 700, movementY: -300 });
      expect(input.yaw).toBe(yaw);
      expect(input.mouseGuard.dropped).toBe(1);
      win.dispatch('mousemove', { movementX: 60, movementY: 0 });
      expect(input.yaw).not.toBe(yaw);
    });

    it('a quick flick — Q down, the mouse right, Q up — between two ticks is latched, with its direction', () => {
      const input = captured();
      const yaw = input.yaw;
      win.dispatch('keydown', { code: 'KeyQ', target: null, preventDefault() {} });
      expect(input.orderWheel).not.toBeNull();
      win.dispatch('mousemove', { movementX: 60, movementY: 0 });
      win.dispatch('keyup', { code: 'KeyQ', target: null });
      // The wheel closed on the release, before any tick looked.
      expect(input.orderWheel).toBeNull();
      const release = input.consumeOrderRelease();
      expect(release).toEqual({ pointer: { dx: 60, dy: 0 }, address: { to: 'all' } });
      // Read once: the next tick sees nothing.
      expect(input.consumeOrderRelease()).toBeNull();
      // The wheel took the mouse: the view did not turn, so the aim point stayed put.
      expect(input.yaw).toBe(yaw);
      // Once it is closed the mouse turns the view again.
      win.dispatch('mousemove', { movementX: 60, movementY: 0 });
      expect(input.yaw).not.toBe(yaw);
    });

    it('number keys while it is open choose who hears it', () => {
      const input = captured();
      win.dispatch('keydown', { code: 'KeyQ', target: null, preventDefault() {} });
      win.dispatch('keydown', { code: 'Digit3', target: null, preventDefault() {} });
      expect(input.orderWheel?.address).toEqual({ to: 'slot', index: 2 });
      win.dispatch('keydown', { code: 'Digit8', target: null, preventDefault() {} });
      win.dispatch('mousemove', { movementX: 0, movementY: -50 });
      win.dispatch('keyup', { code: 'KeyQ', target: null });
      expect(input.consumeOrderRelease()?.address).toEqual({ to: 'fireteam', index: 1 });
      // Opened again, it starts from everyone and the centre.
      win.dispatch('keydown', { code: 'KeyQ', target: null, preventDefault() {} });
      expect(input.orderWheel).toEqual({ pointer: { dx: 0, dy: 0 }, address: { to: 'all' } });
    });

    it('losing the window closes it on nothing, and a stray Q up gives nothing', () => {
      const input = captured();
      win.dispatch('keydown', { code: 'KeyQ', target: null, preventDefault() {} });
      win.dispatch('mousemove', { movementX: 60, movementY: 0 });
      win.dispatch('blur');
      win.dispatch('keyup', { code: 'KeyQ', target: null });
      expect(input.orderWheel).toBeNull();
      expect(input.consumeOrderRelease()).toBeNull();
      win.dispatch('keyup', { code: 'KeyQ', target: null });
      expect(input.consumeOrderRelease()).toBeNull();
    });

    it('a tap of F is latched once', () => {
      const input = captured();
      win.dispatch('keydown', { code: 'KeyF', target: null, preventDefault() {} });
      win.dispatch('keyup', { code: 'KeyF', target: null });
      expect(input.consumeMarkPress()).toBe(true);
      expect(input.consumeMarkPress()).toBe(false);
      // Auto-repeat on a held F is not a second mark.
      win.dispatch('keydown', { code: 'KeyF', target: null, preventDefault() {} });
      win.dispatch('keydown', { code: 'KeyF', target: null, repeat: true, preventDefault() {} });
      expect(input.consumeMarkPress()).toBe(true);
      expect(input.consumeMarkPress()).toBe(false);
    });
  });
});

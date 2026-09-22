/**
 * B-02: recoil's view kick must stay out of the yaw the gait classifies
 * movement against. `yaw` (sent to the server, and used for the camera) is
 * allowed to carry the kick; `bodyYaw` must not.
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

describe('LocalInput yaw vs bodyYaw (B-02)', () => {
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

  it('keeps a recoil kick out of bodyYaw while it still reaches yaw', () => {
    const canvas = fakeTarget();
    const input = new LocalInput(canvas as unknown as HTMLElement);

    win.dispatch('mousemove', { movementX: -100, movementY: 0 });
    const yawBefore = input.yaw;
    const bodyYawBefore = input.bodyYaw;
    expect(yawBefore).toBe(bodyYawBefore);

    input.setViewOffset(37, 0);
    expect(input.yaw).not.toBe(yawBefore);
    expect(input.bodyYaw).toBe(bodyYawBefore);
  });

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
});

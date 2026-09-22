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
    };
    g['addEventListener'] = win.addEventListener.bind(win);
    g['removeEventListener'] = win.removeEventListener.bind(win);
    g['document'] = doc;
    restore = () => {
      g['addEventListener'] = previous.addEventListener;
      g['removeEventListener'] = previous.removeEventListener;
      g['document'] = previous.document;
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
});

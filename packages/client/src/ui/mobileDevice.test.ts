import { describe, expect, it } from 'vitest';
import { applyMobileClass, clampMobileCameraDistance, detectMobile, mobileCameraMax } from './mobileDevice.ts';

describe('detectMobile', () => {
  it('follows the pointer, not the window size', () => {
    expect(detectMobile('', true)).toBe(true);
    expect(detectMobile('', false)).toBe(false);
  });
  it('honours ?mobile on a fine pointer', () => {
    expect(detectMobile('?mobile', false)).toBe(true);
    expect(detectMobile('?other=1', false)).toBe(false);
  });
});

describe('applyMobileClass', () => {
  it('toggles the class', () => {
    const root = { classList: new Set<string>() } as unknown as HTMLElement;
    const list = root.classList as unknown as Set<string>;
    (root.classList as unknown as { toggle: (c: string, f: boolean) => void }).toggle = (c, f) => { if (f) list.add(c); else list.delete(c); };
    applyMobileClass(root, true);
    expect(list.has('mobile')).toBe(true);
    applyMobileClass(root, false);
    expect(list.has('mobile')).toBe(false);
  });
});

describe('mobile camera zoom', () => {
  it('allows 6x in portrait and 3x in landscape', () => {
    expect(mobileCameraMax(true)).toBe(18);
    expect(mobileCameraMax(false)).toBe(9);
  });
  it('clamps into the orientation limit, including after a rotation', () => {
    expect(clampMobileCameraDistance(15, true)).toBe(15);
    expect(clampMobileCameraDistance(15, false)).toBe(9);
    expect(clampMobileCameraDistance(1, true)).toBe(3);
  });
});

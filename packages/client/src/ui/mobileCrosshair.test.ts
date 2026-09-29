import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('mobile crosshair (U-039)', () => {
  it('is force-hidden under html.mobile, whatever state classes the HUD toggles', () => {
    const css = readFileSync(new URL('./qa.css', import.meta.url), 'utf8');
    expect(css).toMatch(/html\.mobile #crosshair\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  });
});

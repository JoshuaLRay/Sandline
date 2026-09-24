import { describe, expect, it } from 'vitest';
import { RESUME, parseResumeConfig } from './resume.ts';

describe('resume tuning (T-4.18)', () => {
  it('ships a grace time shorter than the room grace, so a kept room still has the seat', () => {
    expect(RESUME.graceSeconds).toBeGreaterThan(0);
    expect(RESUME.graceSeconds * 1000).toBeLessThan(120_000);
  });

  it('refuses a grace that is not a sane number, and a key it does not know', () => {
    expect(() => parseResumeConfig({ graceSeconds: -1 })).toThrow(/graceSeconds/);
    expect(() => parseResumeConfig({ graceSeconds: 'soon' })).toThrow(/graceSeconds/);
    expect(() => parseResumeConfig({ graceSeconds: 60, forever: true })).toThrow(/unknown key "forever"/);
    expect(parseResumeConfig({ $comment: 'x', graceSeconds: 0 }).graceSeconds).toBe(0);
  });
});

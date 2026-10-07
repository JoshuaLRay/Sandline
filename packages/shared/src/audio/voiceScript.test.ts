import { describe, expect, it } from 'vitest';
import { VOICES, passLines } from './voices.ts';
import { VOICE_RECORDING_LINES } from './voiceScript.ts';

describe('contribution script', () => {
  it('covers every rendered line and delivery exactly once with an actual prompt', () => {
    const expected = VOICES.sections.flatMap((section) => section.render.flatMap((style) => passLines(section, style).map((line) => `${line}-${style}`)));
    expect(VOICE_RECORDING_LINES.map((line) => line.id)).toEqual(expected);
    expect(new Set(expected).size).toBe(expected.length);
    for (const line of VOICE_RECORDING_LINES) {
      expect(line.text).not.toBe(line.line);
      expect(line.direction.length).toBeGreaterThan(0);
    }
    expect(VOICE_RECORDING_LINES.filter((line) => line.section === 'enemy').every((line) => line.style === 'shout')).toBe(true);
    expect(VOICE_RECORDING_LINES.find((line) => line.id === 'dying-sigh-hurt')!.direction).toContain('last breath');
  });
});

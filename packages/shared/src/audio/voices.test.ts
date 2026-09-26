/**
 * The voice pipeline's data (T-2.48): the committed file parses — six slots'
 * profiles, every line in the script once, the squelch recipes that exist —
 * and what is wrong is refused by name.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SLOTS, VOICES, parseVoices, passFile, passLines, voiceFile } from '../index.ts';
import RAW from '../data/audio/voices.json' with { type: 'json' };

const edit = (patch: Record<string, unknown>) => parseVoices({ ...RAW, ...patch });

describe('voice data (T-2.48)', () => {
  it('parses the committed file: a profile a slot, the script the voice script names, lines once each', () => {
    expect(VOICES.profiles).toHaveLength(MAX_SLOTS);
    expect(VOICES.sections.map((s) => s.id)).toEqual(['contact', 'firing', 'moving', 'reload', 'grenade', 'hit', 'revive', 'kills', 'orders', 'objective']);
    const lines = VOICES.sections.flatMap((s) => [...s.lines, ...s.hurt]);
    expect(new Set(lines).size).toBe(lines.length);
    const hit = VOICES.sections.find((s) => s.id === 'hit')!;
    expect(passLines(hit, 'hurt')).toEqual(['pain-grunt', 'pain-breath', 'pain-groan']);
    expect(passLines(hit, 'shout')).toEqual(hit.lines);
    expect(passFile('hit', 'hurt')).toBe('hit-hurt');
    expect(voiceFile('s2', 'frag-out', 'shout', 'radio', 1)).toBe('s2/frag-out.shout.radio.1.wav');
    expect(VOICES.profiles[1]!.speaker).toBeNull();
  });

  it('refuses what is wrong, each by name', () => {
    expect(() => edit({ volume: 1 })).toThrow("voices: unknown key 'volume'");
    expect(() => edit({ profiles: RAW.profiles.slice(0, 5) })).toThrow(`voices.profiles must list ${MAX_SLOTS} voices`);
    expect(() => edit({ profiles: [...RAW.profiles.slice(0, 5), { ...RAW.profiles[0], id: 's5', pitch: 24 }] })).toThrow('voices.profiles[5].pitch must be in [-12, 12]');
    expect(() => edit({ profiles: [...RAW.profiles.slice(0, 5), { ...RAW.profiles[0], id: 's5', eq: [{ kind: 'notch', hz: 100 }] }] })).toThrow('voices.profiles[5].eq[0].kind must be one of');
    expect(() => edit({ radio: { ...RAW.radio, squelchIn: 'nope' } })).toThrow("voices.radio.squelchIn: no sound 'nope' in sounds.json");
    expect(() => edit({ treatments: ['dry', 'underwater'] })).toThrow('voices.treatments[1] must be one of dry, radio, distant');
    const sections = (extra: Record<string, unknown>) => ({ script: { takesPerLine: 3, sections: { a: { lines: ['copy'], render: ['normal'] }, ...extra } } });
    expect(() => edit(sections({ b: { lines: ['copy'], render: ['normal'] } }))).toThrow("voices.script.sections.b: line 'copy' is in the script twice");
    expect(() => edit(sections({ b: { lines: ['roger'], render: ['hurt'] } }))).toThrow("voices.script.sections.b.render: 'hurt' needs hurt lines");
    expect(() => edit(sections({ b: { lines: ['Roger!'], render: ['normal'] } }))).toThrow('voices.script.sections.b.lines[0] must match');
  });
});

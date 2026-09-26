/**
 * The sound board's model (T-2.45): it lists every committed sound with each
 * variant's measured numbers, notes a variant with no render, and draws a
 * waveform's columns from a WAV's samples.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOUNDS, parseSounds } from '@sandline/shared';
import { type RendersManifest, type VoiceRendersManifest, soundBoardRows, voiceBoard, waveformColumns, wavSamples } from './soundBoardModel.ts';

const manifest = JSON.parse(readFileSync(new URL('../../public/audio/renders.json', import.meta.url), 'utf8')) as RendersManifest;

describe('the sound board (T-2.45)', () => {
  it('lists every committed sound, each variant with the numbers gen:audio measured', () => {
    const rows = soundBoardRows(SOUNDS, manifest);
    expect(rows.map((r) => r.id)).toEqual([...SOUNDS.sounds.keys()].sort());
    for (const row of rows) {
      expect(row.variants).toHaveLength(SOUNDS.sounds.get(row.id)!.variants);
      for (const v of row.variants) {
        expect(v.rendered).toBe(true);
        expect(v.numbers).toMatch(/^peak -?\d+\.\d dB · rms -?\d+\.\d dB · \d+\.\d{3} s · \d+\.\d KB$/);
      }
    }
  });

  it('lists the committed voice lines, or says nobody has recorded yet (T-2.48)', () => {
    const committed = JSON.parse(readFileSync(new URL('../../public/audio/voice/renders.json', import.meta.url), 'utf8')) as VoiceRendersManifest;
    const board = voiceBoard(committed);
    expect(board.rows).toHaveLength(Object.keys(committed.lines).length);
    if (board.rows.length === 0) expect(board.summary).toMatch(/nobody has recorded docs\/audio\/voice-script\.md/);
    const one: VoiceRendersManifest = {
      ...committed,
      speakers: [{ name: 'pat', passes: { 'orders-normal': 21 } }],
      lines: { 's0/copy.normal.radio': [{ file: 's0/copy.normal.radio.0.wav', bytes: 40960, lufs: -16.02, peakDb: -3.14, seconds: 0.82 }] },
      missing: ['s0/pain-grunt.hurt'],
    };
    expect(voiceBoard(one)).toEqual({
      summary: '1 lines from 1 speaker(s) (pat); 1 not recorded.',
      rows: [{ key: 's0/copy.normal.radio', variants: [{ variant: 0, file: 'voice/s0/copy.normal.radio.0.wav', numbers: '-16.0 LUFS · peak -3.1 dB · 0.82 s · 40.0 KB' }] }],
    });
    expect(voiceBoard(null).summary).toMatch(/run pnpm gen:voice/);
  });

  it('notes a sound with no render rather than hiding it', () => {
    const extra = parseSounds({ sounds: { hum: { class: 'world', seconds: 0.1, bounds: { peakDb: [-6, 0], rmsDb: [-60, 0], seconds: [0, 0.1] }, layers: [{ source: { kind: 'noise' }, envelope: { attack: 0, decay: 0.05 } }] } } });
    expect(soundBoardRows(extra, manifest)[0]!.variants[0]).toMatchObject({ rendered: false, file: 'hum.0.wav' });
    expect(soundBoardRows(extra, null)[0]!.variants[0]!.rendered).toBe(false);
  });

  it('reads a committed WAV and draws its waveform as columns', () => {
    const file = manifest.sounds['click']![0]!.file;
    const bytes = readFileSync(new URL(`../../public/audio/${file}`, import.meta.url));
    const samples = wavSamples(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(samples.length).toBe(Math.round(SOUNDS.sounds.get('click')!.seconds * SOUNDS.sampleRate));
    const cols = waveformColumns(samples, 100);
    expect(cols).toHaveLength(100);
    const peak = Math.max(...cols.map((c) => Math.max(Math.abs(c.min), Math.abs(c.max))));
    expect(20 * Math.log10(peak)).toBeCloseTo(manifest.sounds['click']![0]!.peakDb, 0);
    expect(wavSamples(new ArrayBuffer(10))).toHaveLength(0);
    expect(waveformColumns(new Float32Array(0), 10)).toEqual([]);
  });
});

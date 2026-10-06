import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VOICE_CONSENT_TEXT } from '@sandline/shared';
import { importVoiceSubmission } from './importSubmission.ts';

let root = '';
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ''; });
const ID = 'a'.repeat(32);
const TAKE = `take-${'b'.repeat(32)}`;
function fixture() {
  root = mkdtempSync(join(tmpdir(), 'sandline-import-'));
  const dir = join(root, ID);
  mkdirSync(dir);
  const clips = { 'hit-hurt': { file: 'hit-hurt.wav' }, [TAKE]: { file: `${TAKE}.webm`, line: 'roger-normal' } };
  const manifest = { id: ID, name: 'Mia', agreedAt: '2026-10-06', complete: true, consent: VOICE_CONSENT_TEXT, clips };
  const save = () => writeFileSync(join(dir, 'submission.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'hit-hurt.wav'), 'old section');
  writeFileSync(join(dir, `${TAKE}.webm`), 'individual take');
  save();
  return { dir, manifest, save, raw: join(root, 'raw') };
}
describe('owner voice import', () => {
  it('preserves old sections and separately named line takes with their exact consent', () => {
    const f = fixture();
    const { dest, clips } = importVoiceSubmission(root, ID, f.raw);
    expect(clips).toBe(2);
    expect(readFileSync(join(dest, 'hit-hurt.wav'), 'utf8')).toBe('old section');
    expect(readFileSync(join(dest, `roger-normal-${TAKE}.webm`), 'utf8')).toBe('individual take');
    expect(readFileSync(join(dest, 'CONSENT.md'), 'utf8')).toContain(VOICE_CONSENT_TEXT);
    expect(() => importVoiceSubmission(root, ID, f.raw)).toThrow('already exists');
  });
  it('validates consent, delivery, script identity and paths before creating an import', () => {
    const f = fixture();
    f.manifest.complete = false; f.save();
    expect(() => importVoiceSubmission(root, ID, f.raw)).toThrow('Completed submission');
    f.manifest.complete = true; f.manifest.consent = 'different'; f.save();
    expect(() => importVoiceSubmission(root, ID, f.raw)).toThrow('matching consent');
    f.manifest.consent = VOICE_CONSENT_TEXT;
    f.manifest.clips[TAKE]!.line = 'not-scripted'; f.save();
    expect(() => importVoiceSubmission(root, ID, f.raw)).toThrow('Invalid clip');
    f.manifest.clips[TAKE]!.line = 'roger-normal';
    f.manifest.clips[TAKE]!.file = '../outside.webm'; f.save();
    expect(() => importVoiceSubmission(root, ID, f.raw)).toThrow('Invalid clip');
    f.manifest.clips[TAKE]!.file = `${TAKE}.webm`; f.save();
    rmSync(join(f.dir, `${TAKE}.webm`)); symlinkSync(join(f.dir, 'hit-hurt.wav'), join(f.dir, `${TAKE}.webm`));
    expect(() => importVoiceSubmission(root, ID, f.raw)).toThrow('regular source');
    expect(existsSync(f.raw)).toBe(false);
  });
});

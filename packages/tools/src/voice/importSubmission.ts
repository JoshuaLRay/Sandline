/** Import is an explicit owner action; source recordings never enter gameplay automatically. */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VOICES, VOICE_CONSENT_TEXT, VOICE_RECORDING_LINES, passFile, passLines } from '@sandline/shared';

const LINES = new Set(VOICE_RECORDING_LINES.map((line) => line.id));
const PASSES = new Set(VOICES.sections.flatMap((section) => (['normal', 'shout', 'hurt'] as const)
  .filter((style) => passLines(section, style).length > 0).map((style) => passFile(section.id, style))));

export function importVoiceSubmission(source: string, id: string, rawDir = 'assets/voice/raw'): { dest: string; clips: number } {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid submission ID');
  const dir = join(source, id);
  const manifest = JSON.parse(readFileSync(join(dir, 'submission.json'), 'utf8')) as {
    id: string; name: string; agreedAt: string; consent: string; complete: boolean; clips: Record<string, { file: string; line?: string }>;
  };
  if (manifest.id !== id || !manifest.complete || manifest.consent !== VOICE_CONSENT_TEXT ||
    typeof manifest.name !== 'string' || typeof manifest.agreedAt !== 'string' || !manifest.clips || !Object.keys(manifest.clips).length) {
    throw new Error('Completed submission and matching consent required');
  }
  const files = Object.entries(manifest.clips).map(([key, clip]) => {
    const extension = /\.(webm|m4a|ogg|wav)$/.exec(clip.file)?.[0];
    if (!extension || clip.file !== `${key}${extension}` ||
      (clip.line ? !LINES.has(clip.line) || !/^take-[a-f0-9]{32}$/.test(key) : !PASSES.has(key))) throw new Error('Invalid clip manifest');
    const path = join(dir, clip.file);
    if (!lstatSync(path).isFile()) throw new Error('Clip must be a regular source file');
    return { path, name: clip.line ? `${clip.line}-${key}${extension}` : clip.file };
  });
  const name = manifest.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'speaker';
  const dest = join(rawDir, `${name}-${id.slice(0, 8)}`);
  if (existsSync(dest)) throw new Error(`${dest} already exists; inspect it before reimporting`);
  mkdirSync(dest, { recursive: true });
  for (const file of files) copyFileSync(file.path, join(dest, file.name));
  writeFileSync(join(dest, 'CONSENT.md'), `Recorded consent on ${manifest.agreedAt} by ${manifest.name}:\n${manifest.consent}\n`);
  return { dest, clips: files.length };
}

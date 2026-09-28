/** After owner review, import one completed private intake into the existing offline voice pipeline. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VOICE_CONSENT_TEXT } from '@sandline/shared';

const [source, id] = process.argv.slice(2);
if (!source || !id || !/^[a-f0-9]{32}$/.test(id)) {
  console.error('Usage: pnpm import:voice <private-intake-directory> <submission-id>');
  process.exit(1);
}
const dir = join(source, id);
const manifest = JSON.parse(readFileSync(join(dir, 'submission.json'), 'utf8')) as {
  id: string; name: string; agreedAt: string; consent: string; complete: boolean; clips: Record<string, { file: string }>;
};
if (manifest.id !== id || !manifest.complete || manifest.consent !== VOICE_CONSENT_TEXT || !Object.keys(manifest.clips).length) {
  throw new Error('Completed submission and matching consent required');
}
const name = manifest.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'speaker';
const dest = join('assets/voice/raw', `${name}-${id.slice(0, 8)}`);
if (existsSync(dest)) throw new Error(`${dest} already exists; inspect it before reimporting`);
mkdirSync(dest, { recursive: true });
for (const [pass, clip] of Object.entries(manifest.clips)) {
  if (!/^[a-z][a-z0-9-]*$/.test(pass) || !/^[a-z][a-z0-9-]*\.(webm|m4a|ogg|wav)$/.test(clip.file) || !clip.file.startsWith(`${pass}.`)) throw new Error('Invalid clip manifest');
  copyFileSync(join(dir, clip.file), join(dest, clip.file));
}
writeFileSync(join(dest, 'CONSENT.md'), `Recorded consent on ${manifest.agreedAt} by ${manifest.name}:\n${manifest.consent}\n`);
console.log(`${dest}: ${Object.keys(manifest.clips).length} sections imported. Review recordings, then run pnpm gen:voice.`);

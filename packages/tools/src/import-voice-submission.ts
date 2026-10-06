/** After owner review, import one completed private intake into the existing offline voice pipeline. */
import { importVoiceSubmission } from './voice/importSubmission.ts';

const [source, id] = process.argv.slice(2);
if (!source || !id || !/^[a-f0-9]{32}$/.test(id)) {
  console.error('Usage: pnpm import:voice <private-intake-directory> <submission-id>');
  process.exit(1);
}
const { dest, clips } = importVoiceSubmission(source, id);
console.log(`${dest}: ${clips} recordings imported. Review recordings, then run pnpm gen:voice.`);

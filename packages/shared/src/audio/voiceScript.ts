import { VOICES, passFile, passLines, type VoicesConfig, type VoiceStyle } from './voices.ts';

const WORDS: Record<string, string> = {
  contact: 'Contact!', 'contact-front': 'Contact front!', 'contact-left': 'Contact left!', 'contact-right': 'Contact right!',
  'enemy-spotted': 'Enemy spotted!', 'machine-gun': 'Machine gun!', 'covering-fire': 'Covering fire!', suppressing: 'Suppressing!',
  'heads-down': 'Keep their heads down!', moving: 'Moving!', 'moving-up': 'Moving up!', 'on-me': 'On me!',
  'go-go-go': 'Go, go, go!', 'taking-cover': 'Taking cover!', 'get-down': 'Get down!', reloading: 'Reloading!',
  'changing-mag': 'Changing mag!', 'cover-me-reloading': 'Cover me, reloading!', 'frag-out': 'Frag out!',
  grenade: 'Grenade!', 'grenade-get-back': 'Grenade — get back!', 'im-hit': "I'm hit!", 'man-down': 'Man down!',
  'im-down': "I'm down!", 'need-help': 'I need help here!', 'pain-grunt': 'A short grunt',
  'pain-breath': 'A sharp breath in', 'pain-groan': 'A groan', 'downed-cry': 'A cry',
  'dying-sigh': 'One long, fading breath out', 'got-you': "I've got you!", 'hang-on': 'Hang on!',
  'youre-up': "You're up!", 'enemy-down': 'Enemy down!', 'got-him': 'Got him!', 'target-down': 'Target down!',
  copy: 'Copy!', roger: 'Roger!', 'on-it': 'On it!', 'moving-to-position': 'Moving to position!',
  'holding-here': 'Holding here!', regrouping: 'Regrouping!', 'cant-get-there': "Negative, can't get there!",
  'compound-clear': 'Compound clear!', 'holding-objective': 'Holding the objective!', 'objective-secure': 'Objective secure!',
  'open-fire': 'Open fire!', 'there-they-are': 'There they are!', 'flank-them': 'Flank them!', 'push-forward': 'Push forward!',
};
const BODY_DIRECTIONS: Record<string, string> = {
  'pain-grunt': 'hurt; as a round hits', 'pain-breath': 'hurt', 'pain-groan': 'hurt',
  'downed-cry': 'hurt; when going down wounded', 'dying-sigh': 'dying; a last breath, not a hurt cry',
};

export interface VoiceRecordingLine {
  id: string; line: string; section: string; pass: string; style: VoiceStyle; text: string; direction: string;
}
/** A line's delivery is part of its identity: a shouted take cannot fill the normal slot. */
export function voiceRecordingLines(config: VoicesConfig = VOICES): VoiceRecordingLine[] {
  return config.sections.flatMap((section) => section.render.flatMap((style) => passLines(section, style).map((line) => ({
    id: `${line}-${style}`, line, section: section.id, pass: passFile(section.id, style), style,
    text: WORDS[line] ?? line,
    direction: BODY_DIRECTIONS[line] ?? (style === 'shout' ? 'shouted; urgent, without straining your voice' : 'normal; clear speaking voice'),
  }))));
}
export const VOICE_RECORDING_LINES = voiceRecordingLines();

/** Public metadata only. The server keeps credentials and storage paths private. */
export interface VoiceSavedClip {
  pass: string; bytes: number; type: string; line?: string; savedAt?: string;
}
export interface VoiceContributorSubmission {
  id: string; name: string; agreedAt: string; complete: boolean; clips: VoiceSavedClip[];
}

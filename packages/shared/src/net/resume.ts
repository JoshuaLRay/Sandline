/**
 * Reconnecting into your own slot (T-4.18): the tuning, from
 * `data/resume.json`. The session holds the claims; this is only how long
 * one lasts.
 */
import RAW_RESUME from '../data/resume.json' with { type: 'json' };

export interface ResumeConfig {
  /** Seconds a dropped player's slot waits for them before it is the bot's for good. */
  graceSeconds: number;
}

export class ResumeDataError extends Error {}

export function parseResumeConfig(raw: unknown): ResumeConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ResumeDataError('resume: expected an object');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (k !== '$comment' && k !== 'graceSeconds') throw new ResumeDataError(`resume: unknown key "${k}"`);
  }
  const grace = o['graceSeconds'];
  if (typeof grace !== 'number' || !Number.isFinite(grace) || grace < 0 || grace > 3600) {
    throw new ResumeDataError(`resume.graceSeconds must be a number in [0, 3600], got ${String(grace)}`);
  }
  return { graceSeconds: grace };
}

export const RESUME: ResumeConfig = Object.freeze(parseResumeConfig(RAW_RESUME));

/**
 * The squad's fireteams and formations (T-3.25), as data (`data/squad.json`).
 *
 * Six slots (ADR-001) split into two fireteams of three (§1.2), fixed: which
 * slots are which fireteam never changes, whoever sits in them. Each fireteam
 * has a formation — offsets from its lead, right and back in the lead's
 * direction of travel, one per follower rank. SHARED because the page will
 * show who is in which fireteam; the following itself is the server's
 * (`server/src/ai/friendly/formation.ts`).
 */
import RAW_SQUAD from '../data/squad.json' with { type: 'json' };
import { MAX_SLOTS } from '../net/Connection.ts';
import { ENEMIES } from './enemies.ts';

/** An offset from the lead: metres to its right, and behind it. */
export type FormationOffset = readonly [right: number, back: number];

export interface Fireteam {
  /** Slot indices, in order. */
  readonly slots: readonly number[];
  /** A key of `SquadConfig.formations`. */
  readonly formation: string;
}

/** T-3.26: how a friendly bot fights and revives. */
export interface SquadBotConfig {
  /** An enemies.json row whose perception and accuracy a bot uses (with its own slot's gun). */
  readonly archetype: string;
  /** A squadmate's capsule grown by this blocks a bot's shot, metres. */
  readonly friendlyMarginM: number;
  /** A downed squadmate within this is one a bot goes to revive, metres. */
  readonly reviveSeekM: number;
  /** Share of the revive range a bot closes to before it holds interact. */
  readonly reviveReachFraction: number;
  /**
   * T-5.06: when a bot under an order is under fire — suppression at or over
   * `suppression`, or hurt within `hurtSeconds` — and the cover it takes: an
   * attacking bot within `coverWithinM` of where it is, a holding one within
   * `holdCoverM` of its anchor, hidden from whoever shot at it within
   * `threatSeconds` and from its target.
   */
  readonly underFire: { readonly suppression: number; readonly hurtSeconds: number; readonly threatSeconds: number; readonly coverWithinM: number; readonly holdCoverM: number };
}

export interface SquadConfig {
  readonly fireteams: readonly Fireteam[];
  readonly formations: Readonly<Record<string, readonly FormationOffset[]>>;
  readonly stillMps: number;
  readonly closeUpScale: number;
  readonly catchUpM: number;
  readonly arriveM: number;
  readonly minFromLeadM: number;
  /** Share of the offsets to the side kept while the lead sprints. */
  readonly sprintSpreadScale: number;
  /** How far from its place a follower may be and still be in formation: this, plus `bandPerM` a metre of its offset. */
  readonly bandM: number;
  readonly bandPerM: number;
  readonly bot: SquadBotConfig;
}

/** Hand-written for the reason `weapons.ts` gives: zod would be a new runtime dep. */
class SquadDataError extends Error {}

function num(row: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = row[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SquadDataError(`squad.${key} must be a finite number, got ${String(v)}`);
  if (v < min || v > max) throw new SquadDataError(`squad.${key} must be in [${min}, ${max}], got ${v}`);
  return v;
}

export function parseSquadConfig(raw: unknown): SquadConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SquadDataError('squad: expected an object');
  const row = raw as Record<string, unknown>;
  const keys = ['$comment', 'fireteams', 'formations', 'stillMps', 'closeUpScale', 'catchUpM', 'arriveM', 'minFromLeadM', 'sprintSpreadScale', 'bandM', 'bandPerM', 'bot'];
  for (const k of Object.keys(row)) if (!keys.includes(k)) throw new SquadDataError(`squad: unknown key "${k}"`);

  const rawFormations = row['formations'];
  if (typeof rawFormations !== 'object' || rawFormations === null || Array.isArray(rawFormations)) throw new SquadDataError('squad.formations: expected an object');
  const formations: Record<string, FormationOffset[]> = {};
  for (const [name, offsets] of Object.entries(rawFormations)) {
    // Enough ranks for every other slot to follow one lead.
    if (!Array.isArray(offsets) || offsets.length < MAX_SLOTS - 1) throw new SquadDataError(`squad.formations.${name}: needs ${MAX_SLOTS - 1} offsets`);
    formations[name] = offsets.map((o, i) => {
      if (!Array.isArray(o) || o.length !== 2 || !o.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        throw new SquadDataError(`squad.formations.${name}[${i}]: expected [right, back]`);
      }
      // Never on the lead: a follower's place is somewhere else.
      if (Math.sqrt(o[0] * o[0] + o[1] * o[1]) < 1) throw new SquadDataError(`squad.formations.${name}[${i}]: within 1 m of the lead`);
      return [o[0], o[1]] as const;
    });
  }

  const rawTeams = row['fireteams'];
  if (!Array.isArray(rawTeams) || rawTeams.length === 0) throw new SquadDataError('squad.fireteams: expected a non-empty array');
  const seen = new Set<number>();
  const fireteams = rawTeams.map((t, i): Fireteam => {
    if (typeof t !== 'object' || t === null) throw new SquadDataError(`squad.fireteams[${i}]: expected an object`);
    const team = t as Record<string, unknown>;
    for (const k of Object.keys(team)) if (k !== 'slots' && k !== 'formation') throw new SquadDataError(`squad.fireteams[${i}]: unknown key "${k}"`);
    const slots = team['slots'];
    if (!Array.isArray(slots) || slots.length === 0) throw new SquadDataError(`squad.fireteams[${i}].slots: expected slot indices`);
    for (const s of slots) {
      if (!Number.isInteger(s) || s < 0 || s >= MAX_SLOTS) throw new SquadDataError(`squad.fireteams[${i}].slots: ${String(s)} is not a slot`);
      if (seen.has(s)) throw new SquadDataError(`squad.fireteams: slot ${s} is in two fireteams`);
      seen.add(s);
    }
    const formation = team['formation'];
    if (typeof formation !== 'string' || !formations[formation]) throw new SquadDataError(`squad.fireteams[${i}].formation: unknown formation "${String(formation)}"`);
    return { slots: [...(slots as number[])], formation };
  });
  if (seen.size !== MAX_SLOTS) throw new SquadDataError(`squad.fireteams: every one of the ${MAX_SLOTS} slots must be in a fireteam`);

  const rawBot = row['bot'];
  if (typeof rawBot !== 'object' || rawBot === null || Array.isArray(rawBot)) throw new SquadDataError('squad.bot: expected an object');
  const bot = rawBot as Record<string, unknown>;
  for (const k of Object.keys(bot)) {
    if (!['archetype', 'friendlyMarginM', 'reviveSeekM', 'reviveReachFraction', 'underFire'].includes(k)) throw new SquadDataError(`squad.bot: unknown key "${k}"`);
  }
  const archetype = bot['archetype'];
  if (typeof archetype !== 'string' || !ENEMIES[archetype]) throw new SquadDataError(`squad.bot.archetype: no enemies.json row "${String(archetype)}"`);
  const botNum = (key: string, min: number, max: number) => num(bot, key, min, max);
  const rawUnder = bot['underFire'];
  if (typeof rawUnder !== 'object' || rawUnder === null || Array.isArray(rawUnder)) throw new SquadDataError('squad.bot.underFire: expected an object');
  const under = rawUnder as Record<string, unknown>;
  const UNDER_KEYS = ['suppression', 'hurtSeconds', 'threatSeconds', 'coverWithinM', 'holdCoverM'];
  for (const k of Object.keys(under)) if (!UNDER_KEYS.includes(k)) throw new SquadDataError(`squad.bot.underFire: unknown key "${k}"`);
  const underFire = {
    suppression: num(under, 'suppression', 0, 1),
    hurtSeconds: num(under, 'hurtSeconds', 0, 30),
    threatSeconds: num(under, 'threatSeconds', 0, 60),
    coverWithinM: num(under, 'coverWithinM', 0, 50),
    holdCoverM: num(under, 'holdCoverM', 0, 50),
  };

  return {
    fireteams,
    formations,
    stillMps: num(row, 'stillMps', 0, 10),
    // Above zero: a formation closed up to nothing stands everyone on the lead.
    closeUpScale: num(row, 'closeUpScale', 0.1, 1),
    catchUpM: num(row, 'catchUpM', 0, 100),
    arriveM: num(row, 'arriveM', 0.05, 10),
    minFromLeadM: num(row, 'minFromLeadM', 0, 10),
    sprintSpreadScale: num(row, 'sprintSpreadScale', 0, 1),
    bandM: num(row, 'bandM', 0.1, 50),
    bandPerM: num(row, 'bandPerM', 0, 5),
    bot: {
      archetype,
      friendlyMarginM: botNum('friendlyMarginM', 0, 5),
      reviveSeekM: botNum('reviveSeekM', 0, 500),
      // Above zero and at most the whole range: it must be in reach to revive at all.
      reviveReachFraction: botNum('reviveReachFraction', 0.05, 1),
      underFire,
    },
  };
}

export const SQUAD: SquadConfig = parseSquadConfig(RAW_SQUAD);

/** How far from its place a follower whose offset is `offset` may be and still be in formation. */
export function formationBand(offset: FormationOffset, config: SquadConfig = SQUAD): number {
  return config.bandM + config.bandPerM * Math.sqrt(offset[0] * offset[0] + offset[1] * offset[1]);
}

/** The fireteam a slot is in, as an index into `fireteams`. */
export function fireteamOf(slotIndex: number, config: SquadConfig = SQUAD): number {
  const i = config.fireteams.findIndex((t) => t.slots.includes(slotIndex));
  if (i < 0) throw new RangeError(`slot ${slotIndex} is in no fireteam`);
  return i;
}

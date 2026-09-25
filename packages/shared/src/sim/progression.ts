import RAW from '../data/progression.json' with { type: 'json' };

export const XP_EVENTS = ['kill', 'revive', 'order', 'objective'] as const;
export type XpEvent = (typeof XP_EVENTS)[number];
/** Totals fit the protocol's unsigned varint. */
export const MAX_XP = 0xffffffff;
export interface ProgressionConfig {
  awards: Readonly<Record<XpEvent, number>>;
  ranks: readonly Readonly<{ name: string; xp: number }>[];
}
/** Private, recipient-specific mission credit; the total belongs to the slot. */
export interface SoldierProgress {
  slot: number;
  xp: number;
  rank: number;
  earned: number;
}

// Like the other data readers, validate without adding a runtime dependency.
export function parseProgression(raw: unknown): ProgressionConfig {
  const object = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('progression: expected object');
    if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error('progression: unknown key');
    return value as Record<string, unknown>;
  };
  const uint = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_XP) throw new Error('progression: invalid XP');
    return value;
  };
  const data = object(raw, ['awards', 'ranks']);
  const amounts = object(data.awards, XP_EVENTS);
  const awards = Object.fromEntries(XP_EVENTS.map((event) => [event, uint(amounts[event])])) as Record<XpEvent, number>;
  if (!Array.isArray(data.ranks) || data.ranks.length === 0 || data.ranks.length > 256) throw new Error('progression: expected ranks');
  const names = new Set<string>();
  let previous = -1;
  const ranks = data.ranks.map((value: unknown, index: number) => {
    const rank = object(value, ['name', 'xp']);
    const xp = uint(rank.xp);
    if (typeof rank.name !== 'string' || !rank.name.trim() || names.has(rank.name)) throw new Error('progression: invalid rank name');
    if ((index === 0 && xp !== 0) || xp <= previous) throw new Error('progression: ranks must increase from zero');
    previous = xp;
    names.add(rank.name);
    return Object.freeze({ name: rank.name, xp });
  });
  return Object.freeze({ awards: Object.freeze(awards), ranks: Object.freeze(ranks) });
}

export const PROGRESSION = parseProgression(RAW);
export function rankForXp(xp: number, config = PROGRESSION): number {
  let rank = 0;
  for (let i = 1; i < config.ranks.length; i++) {
    if (xp < config.ranks[i]!.xp) break;
    rank = i;
  }
  return rank;
}

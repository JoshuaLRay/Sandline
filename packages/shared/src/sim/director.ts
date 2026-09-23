/**
 * The director's tuning (T-3.33), `data/director.json`: how intensity is
 * estimated, the thresholds that hold or bring forward a wave, and the
 * budget by human count (ADR-001). The director itself is the server's
 * (`server/src/ai/director/director.ts`); this is its data, validated by
 * hand as the other data files are, unknown keys refused by name.
 */
import RAW_DIRECTOR from '../data/director.json' with { type: 'json' };

export interface BudgetRow {
  humans: number;
  /** Each wave's member counts are multiplied by this. */
  size: number;
  /** The encounter's alive cap is multiplied by this. */
  aliveCap: number;
}

export interface DirectorConfig {
  intensity: {
    windowSeconds: number;
    damageFull: number;
    contactFull: number;
    weights: { damage: number; contact: number; suppression: number };
  };
  holdAbove: number;
  forwardBelow: number;
  /** One row per human count, 1 to 6, in order. */
  budget: readonly BudgetRow[];
}

export class DirectorDataError extends Error {}

type Obj = Record<string, unknown>;

function obj(where: string, v: unknown, keys: readonly string[]): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new DirectorDataError(`${where}: expected an object`);
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k) && k !== '$comment') throw new DirectorDataError(`${where}: unknown key '${k}'`);
  for (const k of keys) if (!(k in o)) throw new DirectorDataError(`${where}: missing '${k}'`);
  return o;
}

function num(where: string, v: unknown, min: number, max: number, open = false): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (open && v === min)) {
    throw new DirectorDataError(`${where} must be a number in ${open ? '(' : '['}${min}, ${max}], got ${JSON.stringify(v)}`);
  }
  return v;
}

export function parseDirectorConfig(raw: unknown): DirectorConfig {
  const top = obj('director', raw, ['intensity', 'holdAbove', 'forwardBelow', 'budget']);
  const i = obj('director.intensity', top['intensity'], ['windowSeconds', 'damageFull', 'contactFull', 'weights']);
  const w = obj('director.intensity.weights', i['weights'], ['damage', 'contact', 'suppression']);
  const weights = {
    damage: num('director.intensity.weights.damage', w['damage'], 0, 1),
    contact: num('director.intensity.weights.contact', w['contact'], 0, 1),
    suppression: num('director.intensity.weights.suppression', w['suppression'], 0, 1),
  };
  const sum = weights.damage + weights.contact + weights.suppression;
  if (Math.abs(sum - 1) > 1e-9) throw new DirectorDataError(`director.intensity.weights must sum to 1, got ${sum}`);
  const holdAbove = num('director.holdAbove', top['holdAbove'], 0, 1);
  const forwardBelow = num('director.forwardBelow', top['forwardBelow'], 0, 1);
  if (forwardBelow >= holdAbove) throw new DirectorDataError(`director.forwardBelow (${forwardBelow}) must be below holdAbove (${holdAbove})`);
  if (!Array.isArray(top['budget'])) throw new DirectorDataError('director.budget: expected a list');
  const budget = top['budget'].map((r, k) => {
    const o = obj(`director.budget[${k}]`, r, ['humans', 'size', 'aliveCap']);
    if (o['humans'] !== k + 1) throw new DirectorDataError(`director.budget[${k}].humans must be ${k + 1}: one row per human count, 1 to 6, in order`);
    return { humans: k + 1, size: num(`director.budget[${k}].size`, o['size'], 0, 4, true), aliveCap: num(`director.budget[${k}].aliveCap`, o['aliveCap'], 0, 4, true) };
  });
  if (budget.length !== 6) throw new DirectorDataError(`director.budget must have a row for each of 1 to 6 humans, got ${budget.length}`);
  return {
    intensity: {
      windowSeconds: num('director.intensity.windowSeconds', i['windowSeconds'], 0, 600, true),
      damageFull: num('director.intensity.damageFull', i['damageFull'], 0, 10000, true),
      contactFull: num('director.intensity.contactFull', i['contactFull'], 0, 64, true),
      weights,
    },
    holdAbove,
    forwardBelow,
    budget,
  };
}

export const DIRECTOR: DirectorConfig = parseDirectorConfig(RAW_DIRECTOR);

/** The budget row for this many humans: none counts as one, more than six as six. */
export function budgetFor(humans: number, config: DirectorConfig = DIRECTOR): BudgetRow {
  const n = Math.max(1, Math.min(config.budget.length, Math.round(humans)));
  return config.budget[n - 1]!;
}

/** `count` scaled by a budget factor: rounded, never below one. */
export function scaled(count: number, factor: number): number {
  return Math.max(1, Math.round(count * factor));
}

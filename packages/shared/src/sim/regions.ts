/**
 * Regions (T-4.20, the ADR-011 addendum): where a client may play, as data,
 * and the tag a code carries so an invite lands in the right one.
 *
 * A region is an entry in `data/regions.json`: an id, Fly's region, a name
 * for the lobby, a one-letter voice-safe TAG, and the public address. A room
 * code with its region is `A-KM7X`: the tag, a hyphen to read aloud, the
 * code; a campaign code the same, `A-KM7XRT34`. The wire never sees the tag
 * — a host is one region's — so the client strips it and goes to that
 * region's address, and puts it back on the link it shares. An untagged code
 * is the region the client is already on, which is what a laptop host and
 * every code from before this task are.
 *
 * Validated by hand, unknown keys refused by name, as every data file is.
 */
import RAW_REGIONS from '../data/regions.json' with { type: 'json' };
import { CAMPAIGN_CODE_LENGTH, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, normalizeRoomCode } from '../net/roomCode.ts';

export interface Region {
  readonly id: string;
  /** Fly's three-letter region. */
  readonly fly: string;
  readonly name: string;
  /** One letter of the voice-safe alphabet, unique among regions. */
  readonly tag: string;
  /** The region's public address, `wss://`. */
  readonly host: string;
}

export class RegionsDataError extends Error {}

const REGION_ID = /^[a-z][a-z0-9-]{0,31}$/;
const FLY_REGION = /^[a-z]{3}$/;

function parseRegion(raw: unknown, i: number): Region {
  const where = `regions[${i}]`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new RegionsDataError(`${where}: expected an object`);
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['id', 'fly', 'name', 'tag', 'host', '$comment'].includes(k)) throw new RegionsDataError(`${where}: unknown key '${k}'`);
  const str = (key: string): string => {
    const v = o[key];
    if (typeof v !== 'string' || v.length === 0) throw new RegionsDataError(`${where}.${key} must be a non-empty string`);
    return v;
  };
  const id = str('id');
  if (!REGION_ID.test(id)) throw new RegionsDataError(`${where}.id must match ${REGION_ID}, got '${id}'`);
  const fly = str('fly');
  if (!FLY_REGION.test(fly)) throw new RegionsDataError(`${where} '${id}': fly must be three lowercase letters, got '${fly}'`);
  const tag = str('tag');
  if (tag.length !== 1 || !ROOM_CODE_ALPHABET.includes(tag)) throw new RegionsDataError(`${where} '${id}': tag must be one letter of ${ROOM_CODE_ALPHABET}, got '${tag}'`);
  const host = str('host');
  if (!/^wss:\/\/[^/\s?#]+$/.test(host)) throw new RegionsDataError(`${where} '${id}': host must be a bare wss:// address, got '${host}'`);
  return { id, fly, name: str('name'), tag, host };
}

/** Validate the regions file: a non-empty list, ids and tags unique. */
export function parseRegions(raw: unknown): readonly Region[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new RegionsDataError('regions: expected an object');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['regions', '$comment'].includes(k)) throw new RegionsDataError(`regions: unknown key '${k}'`);
  const list = o['regions'];
  if (!Array.isArray(list) || list.length === 0) throw new RegionsDataError('regions.regions must be a non-empty list');
  const regions = list.map(parseRegion);
  const ids = new Set<string>();
  const tags = new Set<string>();
  for (const r of regions) {
    if (ids.has(r.id)) throw new RegionsDataError(`regions: id '${r.id}' is used twice`);
    if (tags.has(r.tag)) throw new RegionsDataError(`regions: tag '${r.tag}' is used twice`);
    ids.add(r.id);
    tags.add(r.tag);
  }
  return regions;
}

export const REGIONS: readonly Region[] = parseRegions(RAW_REGIONS);

export function regionById(id: string, regions: readonly Region[] = REGIONS): Region | null {
  return regions.find((r) => r.id === id) ?? null;
}

export function regionByTag(tag: string, regions: readonly Region[] = REGIONS): Region | null {
  return regions.find((r) => r.tag === tag) ?? null;
}

/** The region whose address a host is, or null for a laptop's or a stranger's. */
export function regionForHost(host: string, regions: readonly Region[] = REGIONS): Region | null {
  const wanted = host.trim().replace(/\/+$/, '');
  return regions.find((r) => r.host === wanted) ?? null;
}

/** A code with its region on the front, as it is read aloud and shared: `A-KM7X`. */
export function tagCode(tag: string, code: string): string {
  return `${tag}-${code}`;
}

export interface SplitCode {
  /** The region's tag, or null for an untagged code. */
  tag: string | null;
  /** The code the wire carries, normalised. */
  code: string;
}

/**
 * Take a typed or pasted code apart: `A-KM7X` (or `akm7x`) is tag A and
 * code KM7X; `KM7X` is untagged. A tag must be one a region has, or the
 * five characters are simply not a code. Null for anything that is neither
 * a code nor a tagged one; empty for empty.
 */
export function splitTaggedCode(raw: string, regions: readonly Region[] = REGIONS): SplitCode | null {
  const normalized = normalizeRoomCode(raw);
  if (normalized === '') return { tag: null, code: '' };
  if (normalized.length === ROOM_CODE_LENGTH || normalized.length === CAMPAIGN_CODE_LENGTH) return { tag: null, code: normalized };
  if (normalized.length === ROOM_CODE_LENGTH + 1 || normalized.length === CAMPAIGN_CODE_LENGTH + 1) {
    const tag = normalized[0]!;
    if (regionByTag(tag, regions)) return { tag, code: normalized.slice(1) };
  }
  return null;
}

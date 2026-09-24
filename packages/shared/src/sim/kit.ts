/**
 * The slice kit (T-4.10), `data/kit.json`: the pieces a level may place and
 * the cover class each one's collision makes. Collision itself is the
 * manifest's (T-4.02), written by the pieces' generators (T-4.04); this file
 * adds only what a level designer and the AI's cover reasoning want named.
 * Validated by hand as the other data files are.
 */
import RAW_KIT from '../data/kit.json' with { type: 'json' };
import type { AssetManifest } from './assets.ts';

export type KitCover = 'high' | 'low' | 'none';

export interface KitPiece {
  id: string;
  cover: KitCover;
  about: string;
}

export class KitDataError extends Error {}

const COVERS: readonly KitCover[] = ['high', 'low', 'none'];

/** The height a 'high' piece reaches at least, and a 'low' one at least and under which it stays. */
export const KIT_COVER_HEIGHT = { high: 1.6, low: 0.6 } as const;

export function parseKit(raw: unknown): KitPiece[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { pieces?: unknown }).pieces)) throw new KitDataError('kit: expected { pieces: [...] }');
  const seen = new Set<string>();
  return (raw as { pieces: unknown[] }).pieces.map((p, i) => {
    if (typeof p !== 'object' || p === null) throw new KitDataError(`kit.pieces[${i}]: expected an object`);
    const o = p as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!['id', 'cover', 'about'].includes(k)) throw new KitDataError(`kit.pieces[${i}]: unknown key '${k}'`);
    if (typeof o['id'] !== 'string' || o['id'] === '') throw new KitDataError(`kit.pieces[${i}]: id must be a string`);
    if (seen.has(o['id'])) throw new KitDataError(`kit: '${o['id']}' is listed twice`);
    seen.add(o['id']);
    if (!COVERS.includes(o['cover'] as KitCover)) throw new KitDataError(`kit '${o['id']}': cover must be one of ${COVERS.join(', ')}`);
    if (typeof o['about'] !== 'string') throw new KitDataError(`kit '${o['id']}': about must be a string`);
    return { id: o['id'], cover: o['cover'] as KitCover, about: o['about'] };
  });
}

export const KIT: readonly KitPiece[] = parseKit(RAW_KIT);

/**
 * Every way the kit and the manifest disagree: a piece the manifest lacks
 * or that is not kit or prop, or a cover class its collision does not make.
 * Empty when they agree.
 */
export function checkKit(kit: readonly KitPiece[], manifest: AssetManifest): string[] {
  const out: string[] = [];
  for (const p of kit) {
    const a = manifest.assets.find((m) => m.id === p.id);
    if (!a) {
      out.push(`kit '${p.id}': not in the manifest`);
      continue;
    }
    if (a.class !== 'kit' && a.class !== 'prop') out.push(`kit '${p.id}': is a ${a.class}, not kit or prop`);
    const top = a.collision.reduce((m, c) => Math.max(m, c.max[1]), 0);
    if (p.cover === 'high' && top < KIT_COVER_HEIGHT.high) out.push(`kit '${p.id}': 'high' cover but stands ${top} m`);
    if (p.cover === 'low' && (top < KIT_COVER_HEIGHT.low || top >= KIT_COVER_HEIGHT.high)) out.push(`kit '${p.id}': 'low' cover but stands ${top} m`);
  }
  return out;
}

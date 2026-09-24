/**
 * ADR-013's budgets as data (T-4.03), `data/assets/budgets.json`, and the
 * check of the asset manifest against them. Pure: the tools' test and
 * `pnpm check:assets` run it over the committed manifest, and a failure
 * names the asset, the number and its limit.
 *
 * Validated by hand as the other data files are, unknown keys refused by
 * name. Only ceilings are checked; see the file's comment for why the
 * bottom of ADR-013's character range is not.
 */
import RAW_BUDGETS from '../data/assets/budgets.json' with { type: 'json' };
import type { AssetManifest } from './assets.ts';

export interface ClassBudget {
  /** Triangles across every mesh in the asset, every LOD included. */
  triangles: number;
  /** Distinct joints across every skin. */
  bones: number;
  /** Materials: the atlas family's draw calls per instance. */
  materials: number;
  /** The largest side of any texture, texels. */
  textureSize: number;
  /** Textures in the asset. */
  textures: number;
}

export interface AssetBudgets {
  classes: Readonly<Record<string, ClassBudget>>;
  /** Every web copy in the manifest together, until streaming (T-4.06) says what is loaded first. */
  initialDownloadBytes: number;
}

export class AssetBudgetError extends Error {}

const CLASS_KEYS = ['triangles', 'bones', 'materials', 'textureSize', 'textures'] as const;

function keys(where: string, o: Record<string, unknown>, allowed: readonly string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k) && k !== '$comment') throw new AssetBudgetError(`${where}: unknown key '${k}'`);
  for (const k of allowed) if (!(k in o)) throw new AssetBudgetError(`${where}: missing '${k}'`);
}

function object(where: string, v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new AssetBudgetError(`${where}: expected an object`);
  return v as Record<string, unknown>;
}

function limit(where: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new AssetBudgetError(`${where}: expected an integer ≥ 0`);
  return v;
}

export function parseAssetBudgets(raw: unknown): AssetBudgets {
  const top = object('budgets', raw);
  keys('budgets', top, ['classes', 'initialDownloadBytes']);
  const rawClasses = object('budgets.classes', top['classes']);
  const classes: Record<string, ClassBudget> = {};
  for (const [name, v] of Object.entries(rawClasses)) {
    const o = object(`class '${name}'`, v);
    keys(`class '${name}'`, o, CLASS_KEYS);
    classes[name] = {
      triangles: limit(`class '${name}'.triangles`, o['triangles']),
      bones: limit(`class '${name}'.bones`, o['bones']),
      materials: limit(`class '${name}'.materials`, o['materials']),
      textureSize: limit(`class '${name}'.textureSize`, o['textureSize']),
      textures: limit(`class '${name}'.textures`, o['textures']),
    };
  }
  if (Object.keys(classes).length === 0) throw new AssetBudgetError('budgets.classes: no classes');
  return { classes, initialDownloadBytes: limit('budgets.initialDownloadBytes', top['initialDownloadBytes']) };
}

export const ASSET_BUDGETS: AssetBudgets = parseAssetBudgets(RAW_BUDGETS);

const powerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

/** Every way the manifest is over budget, one line each, naming the asset and the number. Empty when it passes. */
export function checkBudgets(manifest: AssetManifest, budgets: AssetBudgets = ASSET_BUDGETS): string[] {
  const out: string[] = [];
  let total = 0;
  for (const a of manifest.assets) {
    total += a.bytes;
    const b = budgets.classes[a.class];
    if (!b) {
      out.push(`asset '${a.id}': class '${a.class}' has no budget (classes: ${Object.keys(budgets.classes).join(', ')})`);
      continue;
    }
    const over = (what: string, n: number, max: number) => {
      if (n > max) out.push(`asset '${a.id}' (${a.class}): ${n} ${what}, over the budget of ${max}`);
    };
    over('triangles', a.triangles, b.triangles);
    over('bones', a.bones, b.bones);
    over('materials', a.materials, b.materials);
    over('textures', a.textures.length, b.textures);
    a.textures.forEach((t, i) => {
      over(`texels on a side of texture ${i}`, Math.max(t.width, t.height), b.textureSize);
      if (t.format !== 'ktx2') out.push(`asset '${a.id}' (${a.class}): texture ${i} is ${t.format}, not KTX2`);
      if (!powerOfTwo(t.width) || !powerOfTwo(t.height)) out.push(`asset '${a.id}' (${a.class}): texture ${i} is ${t.width}×${t.height}, not a power of two`);
    });
  }
  if (total > budgets.initialDownloadBytes) out.push(`initial download: ${total} bytes, over the budget of ${budgets.initialDownloadBytes}`);
  return out;
}

/**
 * Weapon sounds in play (T-2.46), the pure half: which report a shot at a
 * distance plays (near, far, or both at equal power between), one sound per
 * trigger pull however many pellets the server reports, and the reload's
 * stages as its progress crosses them. `main.ts` feeds these from the local
 * predicted shot, the server's shot events and the weapon state.
 */
import { WEAPON_SOUNDS, type WeaponSoundsConfig } from '@sandline/shared';

/** The reports to play for a shot heard at `distanceM`, each with its share of the gain. */
export function gunSoundPlan(weaponId: string, distanceM: number, cfg: WeaponSoundsConfig = WEAPON_SOUNDS): { sound: string; gain: number }[] {
  const gun = cfg.guns[weaponId] ?? cfg.guns['carbine'];
  if (!gun) return [];
  const { nearM, farM } = cfg.crossfade;
  if (distanceM <= nearM) return [{ sound: gun.near, gain: 1 }];
  if (distanceM >= farM) return [{ sound: gun.far, gain: 1 }];
  const t = ((distanceM - nearM) / (farM - nearM)) * (Math.PI / 2);
  return [
    { sound: gun.near, gain: Math.cos(t) },
    { sound: gun.far, gain: Math.sin(t) },
  ];
}

/**
 * One report per trigger pull: the server sends a shot event per pellet, so a
 * shotgun's eight arrive together. The first from a shooter plays; the rest
 * within `windowMs` of it do not.
 */
export class ShotDeduper {
  private readonly lastAt = new Map<number, number>();

  constructor(private readonly windowMs = 25) {}

  /** True for the first event of a trigger pull. */
  accept(shooterNetId: number, nowMs: number): boolean {
    const last = this.lastAt.get(shooterNetId);
    if (last !== undefined && nowMs - last < this.windowMs) return false;
    this.lastAt.set(shooterNetId, nowMs);
    return true;
  }
}

export type ReloadStage = 'out' | 'in' | 'bolt';

/**
 * A reload's stages as its progress (0..1, 0 when none) crosses them: `out`
 * as it starts, `in` and `bolt` at the data's fractions. Each stage plays
 * once per reload; progress falling back to 0 ends it.
 */
export class ReloadWatcher {
  private last = 0;
  private played = new Set<ReloadStage>();

  constructor(private readonly stages: WeaponSoundsConfig['stages'] = WEAPON_SOUNDS.stages) {}

  update(progress: number): ReloadStage[] {
    const out: ReloadStage[] = [];
    if (progress <= 0) {
      this.last = 0;
      this.played.clear();
      return out;
    }
    if (!this.played.has('out')) {
      this.played.add('out');
      out.push('out');
    }
    if (progress >= this.stages.in && !this.played.has('in')) {
      this.played.add('in');
      out.push('in');
    }
    if (progress >= this.stages.bolt && !this.played.has('bolt')) {
      this.played.add('bolt');
      out.push('bolt');
    }
    this.last = progress;
    return out;
  }

  /** The progress last seen. */
  get progress(): number {
    return this.last;
  }
}

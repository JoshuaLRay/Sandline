/**
 * Live projectile tuning (QA harness): the grenade and the rocket.
 *
 * Every number in data/projectiles.json is a guess, and how far a grenade
 * goes is the one people notice first. This makes them adjustable without a
 * rebuild, says what the current numbers do to a throw — where a level throw
 * and a 45° one first land and where they go off — and prints the row in
 * projectiles.json shape so a tuned projectile can be pasted back.
 *
 * Edits apply to the page's own copy (`ThrowQA`), which draws the aim arc and
 * the pouch, and are handed to the in-page session so the server throws what
 * the page predicts. A remote host keeps its own data: against one, the
 * sliders move the preview only (as the movement panel's do).
 *
 * The collision radius is not a slider: the drawn shape is built once at that
 * radius, and a grenade that bounced off a different sphere than the one you
 * see would read as the physics being wrong.
 */
import {
  DEFAULT_MUZZLE_RIG,
  type ProjectileDef,
  createProjectileState,
  launchVelocity,
  stepProjectile,
  degToAngle,
} from '@sandline/shared';
import { PROJECTILE_ORDER, type ThrowQA } from '../weapons/ThrowQA.ts';
import { type Panel, addCheck, addReadout, addSlider, createPanel } from './Panel.ts';

interface Row {
  key: keyof ProjectileDef & string;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Ordered as you tune: how it leaves the hand, how it flies and bounces, when and how hard it goes off, how many. */
const ROWS: Row[] = [
  { key: 'speedMPerSec', label: 'Launch speed', min: 1, max: 120, step: 0.5 },
  { key: 'loftDeg', label: 'Loft (°)', min: 0, max: 45, step: 0.5 },
  { key: 'gravity', label: 'Gravity', min: 0, max: 30, step: 0.1 },
  { key: 'dragPerSec', label: 'Air drag /s', min: 0, max: 3, step: 0.01 },
  { key: 'restitution', label: 'Bounce', min: 0, max: 1, step: 0.01 },
  { key: 'friction', label: 'Bounce friction', min: 0, max: 1, step: 0.01 },
  { key: 'rollDragPerSec', label: 'Roll drag /s', min: 0, max: 20, step: 0.1 },
  { key: 'fuseSeconds', label: 'Fuse (s)', min: 0, max: 10, step: 0.1 },
  { key: 'maxLifeSeconds', label: 'Max life (s)', min: 0.5, max: 20, step: 0.5 },
  { key: 'blastRadiusM', label: 'Blast radius', min: 0.5, max: 20, step: 0.1 },
  { key: 'blastDamage', label: 'Blast damage', min: 0, max: 400, step: 1 },
  { key: 'blastMinFraction', label: 'Blast edge ×', min: 0, max: 1, step: 0.01 },
  { key: 'blastCoverFraction', label: 'Through cover ×', min: 0, max: 1, step: 0.01 },
  { key: 'carried', label: 'Carried', min: 0, max: 10, step: 1 },
  { key: 'cooldownSeconds', label: 'Cooldown (s)', min: 0, max: 10, step: 0.1 },
];

/** Every field of a ProjectileDef, in the order projectiles.json lists them. ProjectilePanel.test.ts holds this to the data. */
export const PROJECTILE_JSON_ORDER: (keyof ProjectileDef)[] = [
  'id', 'name', 'kind', 'speedMPerSec', 'loftDeg', 'gravity', 'dragPerSec', 'radiusM', 'restitution',
  'friction', 'rollDragPerSec', 'fuseSeconds', 'detonateOnImpact', 'maxLifeSeconds', 'blastRadiusM',
  'blastDamage', 'blastMinFraction', 'blastCoverFraction', 'carried', 'cooldownSeconds',
];

/** Where a throw ends up, on open ground: its first landing, and where it goes off. */
export interface ThrowReach {
  /** Horizontal metres from the thrower to where it first touches the ground, or null if it never does. */
  firstLandM: number | null;
  /** Horizontal metres to where it detonates (or comes to rest by the end of its life). */
  goesOffM: number;
  /** Seconds from the throw to going off. */
  seconds: number;
}

/**
 * The reach of a throw at `pitchDeg` above level, from a standing eye, on an
 * empty flat floor — the same stepper the server flies it with, at the
 * server's 30 Hz. What "how far does a grenade go" means, as a number.
 */
export function throwReach(def: ProjectileDef, pitchDeg: number, eyeHeightM = DEFAULT_MUZZLE_RIG.eyeHeight): ThrowReach {
  const world = { boxes: [], groundY: 0 };
  const pitch = degToAngle(pitchDeg) & 0xfff;
  let state = createProjectileState({ x: 0, y: eyeHeightM, z: 0 }, launchVelocity(def, 0, pitch));
  let firstLandM: number | null = null;
  const dt = 1 / 30;
  const limit = Math.ceil(Math.max(def.maxLifeSeconds, def.fuseSeconds, 0.1) / dt) + 1;
  for (let i = 0; i < limit; i++) {
    const step = stepProjectile(def, state, dt, world);
    state = step.state;
    if (firstLandM === null && step.impact) firstLandM = Math.hypot(step.impact.point.x, step.impact.point.z);
    if (step.outcome === 'detonated') break;
  }
  return { firstLandM, goesOffM: Math.hypot(state.x, state.z), seconds: state.age };
}

export function createProjectilePanel(throws: ThrowQA): Panel {
  const panel = createPanel('projectile', 'Projectile tuning', true);

  const pick = document.createElement('div');
  pick.className = 'panel-pick';
  panel.body.append(pick);
  const rows = document.createElement('div');
  panel.body.append(rows);
  const reach = addReadout(panel.body, 'On open ground, from a standing eye:');
  const readout = addReadout(panel.body, 'Paste into data/projectiles.json:');

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'panel-reset';
  reset.textContent = 'Reset to shipped values';
  reset.addEventListener('click', () => throws.resetDef());
  panel.body.append(reset);

  const buttons = PROJECTILE_ORDER.map((_, index) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = throws.defOf(index).name;
    b.addEventListener('click', () => throws.select(index));
    pick.append(b);
    return b;
  });

  function refresh(): void {
    const def = throws.def;
    const body = PROJECTILE_JSON_ORDER.map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(def[key])}`).join(',\n');
    readout.textContent = `  ${JSON.stringify(def.id)}: {\n${body}\n  }`;
    const line = (label: string, pitchDeg: number) => {
      const r = throwReach(def, pitchDeg);
      const land = r.firstLandM === null ? 'never lands' : `lands ${r.firstLandM.toFixed(1)} m`;
      return `${label}: ${land}, goes off ${r.goesOffM.toFixed(1)} m after ${r.seconds.toFixed(1)} s`;
    };
    reach.textContent = [line('level', 0), line('45° up', 45)].join('\n');
  }

  /** Rebuilt on a change of projectile, as the weapon panel is on a change of weapon. */
  function rebuild(): void {
    const def = throws.def;
    panel.setTitle(`Projectile — ${def.name}`);
    buttons.forEach((b, i) => b.classList.toggle('active', i === throws.kind));
    rows.replaceChildren();
    for (const row of ROWS) {
      addSlider(rows, {
        label: row.label,
        min: row.min,
        max: row.max,
        step: row.step,
        get: () => def[row.key] as number,
        set: (value) => {
          (def as unknown as Record<string, number>)[row.key] = value;
          throws.tuned();
          refresh();
        },
      });
    }
    addCheck(
      rows,
      'Goes off on impact',
      () => def.detonateOnImpact,
      (value) => {
        def.detonateOnImpact = value;
        throws.tuned();
        refresh();
      },
    );
    refresh();
  }

  throws.onSelect = rebuild;
  rebuild();
  return panel;
}

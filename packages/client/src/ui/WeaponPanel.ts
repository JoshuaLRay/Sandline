/**
 * Live weapon tuning (QA harness).
 *
 * Every number in data/weapons.json is a guess. The range makes the effect of
 * those guesses visible; this makes them adjustable without a rebuild, and
 * prints the result in weapons.json shape so a tuned weapon can be pasted
 * straight back into the data file.
 *
 * Rows rebind to whichever weapon is selected, and edits are kept per weapon —
 * comparing the carbine against the marksman is the whole point, and that
 * comparison is worthless if switching discards what you just dialled in.
 */
import type { WeaponDef } from '@sandline/shared';
import type { CombatQA } from '../weapons/CombatQA.ts';
import { type Panel, addCheck, addReadout, addSlider, createPanel } from './Panel.ts';

interface Row {
  key: keyof WeaponDef & string;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Ordered as you tune: what it does, then how it spreads, then how it carries. */
const ROWS: Row[] = [
  { key: 'rpm', label: 'Rounds/min', min: 30, max: 1200, step: 10 },
  { key: 'damage', label: 'Damage', min: 1, max: 150, step: 1 },
  { key: 'pellets', label: 'Pellets', min: 1, max: 24, step: 1 },
  { key: 'magSize', label: 'Magazine', min: 1, max: 100, step: 1 },
  { key: 'reloadSeconds', label: 'Reload', min: 0.2, max: 8, step: 0.1 },
  { key: 'hipSpreadDeg', label: 'Cone hip', min: 0, max: 15, step: 0.05 },
  { key: 'adsSpreadDeg', label: 'Cone aimed', min: 0, max: 15, step: 0.05 },
  { key: 'proneSpreadScale', label: 'Cone prone ×', min: 0, max: 1, step: 0.05 },
  { key: 'bloomPerShotDeg', label: 'Bloom/shot', min: 0, max: 4, step: 0.05 },
  { key: 'maxSpreadDeg', label: 'Cone max', min: 0, max: 20, step: 0.1 },
  { key: 'bloomDecayDegPerSec', label: 'Bloom decay', min: 0, max: 30, step: 0.5 },
  { key: 'falloffStartM', label: 'Falloff start', min: 0, max: 150, step: 1 },
  { key: 'falloffEndM', label: 'Falloff end', min: 0, max: 250, step: 1 },
  { key: 'falloffMinFraction', label: 'Falloff floor', min: 0, max: 1, step: 0.05 },
  { key: 'maxRangeM', label: 'Max range', min: 5, max: 300, step: 5 },
  // T-2.08. Recoil moves the view, never the shot: tune it by feel.
  { key: 'recoilKickDeg', label: 'Recoil kick', min: 0, max: 6, step: 0.05 },
  { key: 'recoilDriftDeg', label: 'Recoil drift', min: 0, max: 3, step: 0.05 },
  { key: 'recoilMaxDeg', label: 'Recoil cap', min: 0, max: 20, step: 0.5 },
  { key: 'recoilRecoveryPerSec', label: 'Recoil recovery', min: 1, max: 30, step: 0.5 },
  { key: 'recoilAdsScale', label: 'Recoil aimed x', min: 0, max: 1, step: 0.05 },
  // T-2.09. Shake moves the picture, never the aim; the camera panel's
  // "Shake" scales all of these at once for the player who dislikes it.
  { key: 'shakePosM', label: 'Shake (m)', min: 0, max: 0.1, step: 0.002 },
  { key: 'shakeRollDeg', label: 'Shake roll', min: 0, max: 3, step: 0.05 },
];

/**
 * Every field of a WeaponDef, in the order weapons.json lists them. The
 * paste-back block is only useful if it is COMPLETE: the T-2.08/09 fields
 * were missing from it for a day, which would have thrown away exactly the
 * numbers the E-2.4 sign-off exists to tune. WeaponPanel.test.ts holds this
 * list to the type.
 */
export const JSON_ORDER: (keyof WeaponDef)[] = [
  'id', 'name', 'rpm', 'damage', 'pellets', 'hipSpreadDeg', 'adsSpreadDeg',
  'proneSpreadScale', 'bloomPerShotDeg', 'maxSpreadDeg', 'bloomDecayDegPerSec', 'falloffStartM',
  'falloffEndM', 'falloffMinFraction', 'maxRangeM', 'magSize', 'reloadSeconds',
  'auto',
  'recoilKickDeg', 'recoilDriftDeg', 'recoilMaxDeg', 'recoilRecoveryPerSec', 'recoilAdsScale',
  'shakePosM', 'shakeRollDeg',
  'scopeFovDeg',
];

/** Fields only some weapons have: written back when the weapon has them. */
export const OPTIONAL_FIELDS: readonly (keyof WeaponDef)[] = ['scopeFovDeg'];

export function createWeaponPanel(combat: CombatQA): Panel {
  const panel = createPanel('weapon', 'Weapon tuning');

  const rows = document.createElement('div');
  panel.body.append(rows);
  const readout = addReadout(panel.body, 'Paste into data/weapons.json:');

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'panel-reset';
  reset.textContent = 'Reset to shipped values';
  reset.addEventListener('click', () => combat.resetWeapon());
  panel.body.append(reset);

  function refreshReadout(): void {
    const def = combat.weapon;
    const body = JSON_ORDER.filter((key) => def[key] !== undefined)
      .map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(def[key])}`)
      .join(',\n');
    readout.textContent = `  ${JSON.stringify(def.id)}: {\n${body}\n  }`;
  }

  /**
   * Sliders bind to the ACTIVE definition, which the weapon switch replaces
   * wholesale, so the rows are rebuilt rather than rebound. Cheap: two dozen
   * inputs, only on a key press.
   */
  function rebuild(): void {
    const def = combat.weapon;
    panel.setTitle(`Weapon — ${def.name}`);
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
          combat.applyWeaponEdit();
          refreshReadout();
        },
      });
    }

    addCheck(
      rows,
      'Full auto',
      () => def.auto,
      (value) => {
        def.auto = value;
        combat.applyWeaponEdit();
        refreshReadout();
      },
    );

    refreshReadout();
  }

  combat.onWeaponChange = rebuild;
  rebuild();
  return panel;
}

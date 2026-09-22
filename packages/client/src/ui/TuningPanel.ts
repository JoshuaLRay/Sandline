/**
 * Live movement tuning (QA harness).
 *
 * The numbers in DEFAULT_MOVE_CONFIG are guesses. Rather than asking a human
 * "does this feel sluggish?" and guessing again, this lets them dial the values
 * in directly and hand back concrete numbers.
 *
 * Everything else in the project keeps gameplay constants in data; this panel
 * is a QA tool, so it writes to a live config object rather than to data files.
 */
import type { MoveConfig } from '@sandline/shared';
import { type Panel, addCheck, addReadout, addSlider, createPanel } from './Panel.ts';

interface Row {
  key: keyof MoveConfig;
  label: string;
  min: number;
  max: number;
  step: number;
}

const ROWS: Row[] = [
  { key: 'walkSpeed', label: 'Walk', min: 1, max: 12, step: 0.1 },
  { key: 'sprintSpeed', label: 'Sprint', min: 1, max: 16, step: 0.1 },
  { key: 'crouchSpeed', label: 'Crouch', min: 0.5, max: 8, step: 0.1 },
  { key: 'proneSpeed', label: 'Prone', min: 0.2, max: 5, step: 0.1 },
  { key: 'jumpSpeed', label: 'Jump impulse', min: 1, max: 14, step: 0.1 },
  { key: 'gravity', label: 'Gravity', min: -60, max: -5, step: 0.5 },
  // T-2.24: the vault's timing is the sign-off's question, so it is a
  // slider like the speeds. All three are shared movement config: on the
  // in-page session they move authority and prediction together.
  { key: 'vaultSeconds', label: 'Vault seconds', min: 0.2, max: 1.5, step: 0.05 },
  { key: 'vaultDistance', label: 'Vault distance', min: 0.8, max: 3, step: 0.1 },
  { key: 'vaultMaxHeight', label: 'Vault max height', min: 0.5, max: 1.6, step: 0.05 },
];

export function createTuningPanel(
  config: MoveConfig,
  onSensitivity: (value: number) => void,
  onInvertY: (value: boolean) => void,
): Panel {
  // Collapsed by default: movement has already been tuned and signed off, so
  // it is the panel least likely to be wanted open. Weapons and camera are the
  // live questions. A tester's own choice overrides this from then on.
  const panel = createPanel('movement', 'Movement tuning', true);

  for (const row of ROWS) {
    addSlider(panel.body, {
      label: row.label,
      min: row.min,
      max: row.max,
      step: row.step,
      get: () => config[row.key],
      set: (value) => {
        config[row.key] = value;
        refresh();
      },
    });
  }

  // Mouse sensitivity is a viewer preference, not a gameplay constant, so it
  // lives here but does not appear in the copyable config.
  let sensitivity = 0.55;
  addSlider(panel.body, {
    label: 'Look speed',
    min: 0.1,
    max: 2,
    step: 0.05,
    get: () => sensitivity,
    set: (value) => {
      sensitivity = value;
      onSensitivity(value);
    },
  });

  // Y inversion is a preference, not a bug: plenty of players fly-stick style.
  let inverted = false;
  addCheck(
    panel.body,
    'Invert look Y',
    () => inverted,
    (value) => {
      inverted = value;
      onInvertY(value);
    },
  );

  const readout = addReadout(panel.body, 'Paste these back to set the defaults:');
  function refresh(): void {
    const lines = ROWS.map((r) => `  ${r.key}: ${config[r.key]},`).join('\n');
    readout.textContent = `{\n${lines}\n}`;
  }
  refresh();

  return panel;
}

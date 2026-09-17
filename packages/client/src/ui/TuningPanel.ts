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
  { key: 'jumpSpeed', label: 'Jump impulse', min: 1, max: 14, step: 0.1 },
  { key: 'gravity', label: 'Gravity', min: -60, max: -5, step: 0.5 },
];

export function createTuningPanel(
  config: MoveConfig,
  onSensitivity: (value: number) => void,
  onInvertY: (value: boolean) => void,
): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'tuning';
  panel.innerHTML = '<h2>Movement tuning</h2>';

  const readout = document.createElement('pre');
  readout.id = 'tuning-out';

  const refresh = (): void => {
    const lines = ROWS.map((r) => `  ${r.key}: ${config[r.key]},`).join('\n');
    readout.textContent = `{\n${lines}\n}`;
  };

  for (const row of ROWS) {
    const wrap = document.createElement('label');
    const value = document.createElement('b');
    value.textContent = String(config[row.key]);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(row.min);
    input.max = String(row.max);
    input.step = String(row.step);
    input.value = String(config[row.key]);
    input.id = `tune-${row.key}`;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      config[row.key] = v;
      value.textContent = v.toFixed(1);
      refresh();
    });

    const name = document.createElement('span');
    name.textContent = row.label;
    wrap.append(name, value, input);
    panel.append(wrap);
  }

  // Mouse sensitivity is a viewer preference, not a gameplay constant, so it
  // lives here but does not appear in the copyable config.
  const sens = document.createElement('label');
  const sensValue = document.createElement('b');
  sensValue.textContent = '0.55';
  const sensInput = document.createElement('input');
  sensInput.type = 'range';
  sensInput.min = '0.1';
  sensInput.max = '2';
  sensInput.step = '0.05';
  sensInput.value = '0.55';
  sensInput.id = 'tune-sensitivity';
  sensInput.addEventListener('input', () => {
    sensValue.textContent = Number(sensInput.value).toFixed(2);
    onSensitivity(Number(sensInput.value));
  });
  const sensName = document.createElement('span');
  sensName.textContent = 'Look speed';
  sens.append(sensName, sensValue, sensInput);
  panel.append(sens);

  // Y inversion is a preference, not a bug: plenty of players fly-stick style.
  const invert = document.createElement('label');
  invert.className = 'check';
  const invertBox = document.createElement('input');
  invertBox.type = 'checkbox';
  invertBox.id = 'tune-invert-y';
  invertBox.addEventListener('change', () => onInvertY(invertBox.checked));
  const invertName = document.createElement('span');
  invertName.textContent = 'Invert look Y';
  invert.append(invertName, invertBox);
  panel.append(invert);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Paste these back to set the defaults:';
  panel.append(hint, readout);
  refresh();

  return panel;
}

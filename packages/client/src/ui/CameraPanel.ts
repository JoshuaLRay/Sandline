/**
 * Live third-person camera tuning (QA harness).
 *
 * Shown only in third person, because every value here describes where the arm
 * puts the camera relative to a character you cannot see in first person.
 */
import type { CameraConfig } from '../camera/cameraConfig.ts';
import { type Panel, addReadout, addSlider, createPanel } from './Panel.ts';

interface Row {
  key: keyof CameraConfig;
  label: string;
  min: number;
  max: number;
  step: number;
}

const ROWS: Row[] = [
  { key: 'distance', label: 'Arm length', min: 1, max: 12, step: 0.1 },
  { key: 'eyeHeight', label: 'Pivot height', min: 0.6, max: 2.4, step: 0.05 },
  { key: 'shoulderRight', label: 'Shoulder offset', min: 0, max: 2.5, step: 0.05 },
  { key: 'shoulderUp', label: 'Shoulder lift', min: -0.5, max: 1.5, step: 0.05 },
  { key: 'pitchShorten', label: 'Pitch shorten', min: 0, max: 0.9, step: 0.05 },
  { key: 'minCameraY', label: 'Floor guard', min: 0, max: 2, step: 0.05 },
  { key: 'minDistance', label: 'Min arm', min: 0.2, max: 4, step: 0.1 },
  { key: 'baseFov', label: 'FOV', min: 50, max: 110, step: 1 },
  { key: 'adsFov', label: 'FOV aimed', min: 20, max: 90, step: 1 },
  { key: 'adsDistanceScale', label: 'Arm aimed', min: 0.2, max: 1, step: 0.05 },
  { key: 'shoulderRightAds', label: 'Shoulder aimed', min: 0, max: 2.5, step: 0.05 },
];

export function createCameraPanel(config: CameraConfig): Panel {
  const panel = createPanel('camera', 'Camera tuning');
  const refreshers: (() => void)[] = [];

  for (const row of ROWS) {
    refreshers.push(
      addSlider(panel.body, {
        label: row.label,
        min: row.min,
        max: row.max,
        step: row.step,
        get: () => config[row.key],
        set: (value) => {
          config[row.key] = value;
          refreshReadout();
        },
      }),
    );
  }

  const readout = addReadout(panel.body, 'Paste into DEFAULT_CAMERA_CONFIG:');
  function refreshReadout(): void {
    const lines = ROWS.map((r) => `  ${r.key}: ${config[r.key]},`).join('\n');
    readout.textContent = `{\n${lines}\n}`;
  }
  refreshReadout();

  return {
    ...panel,
    setVisible(visible: boolean) {
      panel.setVisible(visible);
      if (visible) for (const refresh of refreshers) refresh();
    },
  };
}

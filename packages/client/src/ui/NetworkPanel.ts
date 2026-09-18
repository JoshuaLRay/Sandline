/**
 * Live link conditions (QA harness).
 *
 * The reason the in-page server is worth having. T-1.22 proves the netcode
 * survives 200 ms and 20% loss as a CI assertion; this is where a person finds
 * out whether surviving it feels acceptable, which is the half T-1.24 needs and
 * no assertion can answer.
 *
 * Start at a perfect link so the harness feels like the local one it replaced,
 * then make it worse on purpose.
 */
import type { LinkConditions } from '../net/LocalServer.ts';
import { type Panel, addSlider, createPanel } from './Panel.ts';

export interface NetworkPanelHooks {
  conditions: LinkConditions;
  onChange: (conditions: LinkConditions) => void;
}

/** Presets worth reaching for, matching the rows of the T-1.22 matrix. */
const PRESETS: { label: string; link: LinkConditions }[] = [
  { label: 'LAN', link: { latencyMs: 0, jitterMs: 0, lossRate: 0 } },
  { label: 'Good', link: { latencyMs: 40, jitterMs: 5, lossRate: 0 } },
  { label: 'Poor', link: { latencyMs: 80, jitterMs: 15, lossRate: 0.05 } },
  { label: 'Awful', link: { latencyMs: 200, jitterMs: 40, lossRate: 0.2 } },
];

export function createNetworkPanel(hooks: NetworkPanelHooks): Panel {
  const panel = createPanel('network', 'Link conditions');
  const { conditions } = hooks;
  const refreshers: (() => void)[] = [];

  const apply = (): void => hooks.onChange(conditions);

  refreshers.push(
    addSlider(panel.body, {
      label: 'Latency (one way)',
      min: 0,
      max: 400,
      step: 5,
      get: () => conditions.latencyMs,
      set: (v) => {
        conditions.latencyMs = v;
        apply();
      },
    }),
    addSlider(panel.body, {
      label: 'Jitter',
      min: 0,
      max: 120,
      step: 5,
      get: () => conditions.jitterMs,
      set: (v) => {
        conditions.jitterMs = v;
        apply();
      },
    }),
    addSlider(panel.body, {
      label: 'Packet loss %',
      min: 0,
      max: 40,
      step: 1,
      get: () => Math.round(conditions.lossRate * 100),
      set: (v) => {
        conditions.lossRate = v / 100;
        apply();
      },
    }),
  );

  const row = document.createElement('div');
  row.className = 'panel-presets';
  for (const preset of PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-reset';
    button.textContent = preset.label;
    button.addEventListener('click', () => {
      Object.assign(conditions, preset.link);
      apply();
      for (const refresh of refreshers) refresh();
    });
    row.append(button);
  }
  panel.body.append(row);

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent =
    'Simulated link to a session running in this page. Same protocol, prediction and lag compensation as a dedicated server; the wire is a model, not a real network.';
  panel.body.append(note);

  return panel;
}

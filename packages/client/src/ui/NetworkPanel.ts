/**
 * Live link conditions, one set per client (QA harness).
 *
 * The reason the in-page server is worth having. T-1.22 proves the netcode
 * survives 200 ms and 20% loss as a CI assertion; this is where a person finds
 * out whether surviving it feels acceptable, which is the half T-1.24 needs and
 * no assertion can answer.
 *
 * Start at a perfect link so the harness feels like the local one it replaced,
 * then make it worse on purpose.
 *
 * TWO SETS, NOT ONE. A tester who can only make everything worse at once can
 * report "it felt bad at 200 ms" and nothing more useful. Separating your link
 * from the other player's separates the two symptoms: your own link shows up as
 * correction and shot delay, theirs as rubber-banding on a capsule that is not
 * yours. Those are different bugs in different code, and the gate is supposed
 * to tell them apart.
 */
import type { LinkConditions } from '../net/LocalServer.ts';
import { type Panel, addSlider, createPanel } from './Panel.ts';

export interface LinkTarget {
  /** Subsection heading. */
  label: string;
  /** Mutated in place, so the HUD can read the very object the slider moves. */
  conditions: LinkConditions;
  onChange: (conditions: LinkConditions) => void;
  /** One line on what this particular link governs. */
  hint: string;
}

/** Presets worth reaching for, matching the rows of the T-1.22 matrix. */
const PRESETS: { label: string; link: LinkConditions }[] = [
  { label: 'LAN', link: { latencyMs: 0, jitterMs: 0, lossRate: 0 } },
  { label: 'Good', link: { latencyMs: 40, jitterMs: 5, lossRate: 0 } },
  { label: 'Poor', link: { latencyMs: 80, jitterMs: 15, lossRate: 0.05 } },
  { label: 'Awful', link: { latencyMs: 200, jitterMs: 40, lossRate: 0.2 } },
];

function addLinkControls(parent: HTMLElement, target: LinkTarget): void {
  const { conditions } = target;
  const refreshers: (() => void)[] = [];
  const apply = (): void => target.onChange(conditions);

  refreshers.push(
    addSlider(parent, {
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
    addSlider(parent, {
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
    addSlider(parent, {
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
  parent.append(row);
}

export function createNetworkPanel(targets: readonly LinkTarget[]): Panel {
  const panel = createPanel('network', 'Link conditions');

  for (const target of targets) {
    const heading = document.createElement('h3');
    heading.className = 'panel-sub';
    heading.textContent = target.label;
    const hint = document.createElement('p');
    hint.className = 'hint hint-sub';
    hint.textContent = target.hint;
    panel.body.append(heading, hint);
    addLinkControls(panel.body, target);
  }

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent =
    'Simulated links to a session running in this page. Same protocol, prediction and lag compensation as a dedicated server; the wire is a model, not a real network.';
  panel.body.append(note);

  return panel;
}

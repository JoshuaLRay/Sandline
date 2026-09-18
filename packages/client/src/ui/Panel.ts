/**
 * Panel scaffold for the QA harness.
 *
 * Three tuning panels now compete for the same corner, so they share a frame:
 * a title bar that collapses the body, and row builders so each panel is a list
 * of specs rather than forty lines of hand-rolled DOM.
 *
 * Collapsed state persists per panel. A tester who only cares about weapons
 * should not have to re-close the movement panel on every reload — and reloads
 * are frequent, because that is how you get back to a clean magazine.
 */

const STORE_PREFIX = 'sandline.panel.';

/**
 * localStorage throws in a private window and can be disabled outright, and a
 * QA harness that fails to start because it could not remember a collapsed
 * panel would be a ridiculous way to lose a session.
 */
function readCollapsed(id: string): boolean | null {
  try {
    const stored = localStorage.getItem(STORE_PREFIX + id);
    return stored === null ? null : stored === '1';
  } catch {
    return null;
  }
}

function writeCollapsed(id: string, collapsed: boolean): void {
  try {
    localStorage.setItem(STORE_PREFIX + id, collapsed ? '1' : '0');
  } catch {
    // Preference only. Losing it costs one click.
  }
}

export interface Panel {
  root: HTMLElement;
  /** Rows go here; the title bar is outside it and stays visible when collapsed. */
  body: HTMLElement;
  setVisible(visible: boolean): void;
  setTitle(text: string): void;
}

export function createPanel(id: string, title: string, startCollapsed = false): Panel {
  const root = document.createElement('section');
  root.className = 'panel';
  root.id = `panel-${id}`;

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'panel-head';
  header.setAttribute('aria-controls', `panel-${id}-body`);

  const heading = document.createElement('h2');
  heading.textContent = title;
  const chevron = document.createElement('span');
  chevron.className = 'panel-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  header.append(heading, chevron);

  const body = document.createElement('div');
  body.className = 'panel-body';
  body.id = `panel-${id}-body`;

  /**
   * A stored preference wins outright, including a stored "expanded". Folding
   * `startCollapsed` in with `||` would re-collapse a panel the tester had
   * deliberately opened, every reload, with no way to make it stick.
   */
  const stored = readCollapsed(id);
  const collapsed = stored ?? startCollapsed;
  const apply = (value: boolean): void => {
    root.classList.toggle('collapsed', value);
    header.setAttribute('aria-expanded', value ? 'false' : 'true');
  };
  apply(collapsed);

  header.addEventListener('click', () => {
    const next = !root.classList.contains('collapsed');
    apply(next);
    writeCollapsed(id, next);
  });

  root.append(header, body);
  return {
    root,
    body,
    setVisible: (visible) => {
      root.hidden = !visible;
    },
    setTitle: (text) => {
      heading.textContent = text;
    },
  };
}

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (value: number) => void;
  /** Digits after the point in the readout. Derived from `step` when omitted. */
  decimals?: number;
}

function decimalsFor(spec: SliderSpec): number {
  if (spec.decimals !== undefined) return spec.decimals;
  const text = String(spec.step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Add a labelled slider. Returns a refresh that re-reads the bound value. */
export function addSlider(parent: HTMLElement, spec: SliderSpec): () => void {
  const digits = decimalsFor(spec);
  const wrap = document.createElement('label');
  const value = document.createElement('b');
  const name = document.createElement('span');
  name.textContent = spec.label;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);

  const refresh = (): void => {
    const current = spec.get();
    input.value = String(current);
    value.textContent = current.toFixed(digits);
  };

  input.addEventListener('input', () => {
    spec.set(Number(input.value));
    value.textContent = Number(input.value).toFixed(digits);
  });

  wrap.append(name, value, input);
  parent.append(wrap);
  refresh();
  return refresh;
}

/** Add a labelled checkbox. Returns a refresh that re-reads the bound value. */
export function addCheck(
  parent: HTMLElement,
  label: string,
  get: () => boolean,
  set: (value: boolean) => void,
): () => void {
  const wrap = document.createElement('label');
  wrap.className = 'check';
  const name = document.createElement('span');
  name.textContent = label;
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.addEventListener('change', () => set(box.checked));
  wrap.append(name, box);
  parent.append(wrap);
  const refresh = (): void => {
    box.checked = get();
  };
  refresh();
  return refresh;
}

/** A copyable block of the current values, for pasting back into data. */
export function addReadout(parent: HTMLElement, hint: string): HTMLPreElement {
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = hint;
  const pre = document.createElement('pre');
  pre.className = 'panel-out';
  parent.append(note, pre);
  return pre;
}

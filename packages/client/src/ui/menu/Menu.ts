/**
 * The menus (T-4.26): the main menu the lobby now lives in, the pause menu
 * Esc opens in a session, and the settings panel both share.
 *
 * The lobby (T-1.5.06, T-4.19) is still the lobby — its fields, its
 * buttons, its rooms — restyled as the main menu's Play panel rather than
 * rewritten. Settings edit a `Settings` value and hand every change to the
 * page through `onSettings`, which applies it and stores it; nothing here
 * reads the renderer or the input. Audio volumes are kept for E-2.7, which
 * is not built yet, and say so.
 */
import { DEFAULT_SETTINGS, KEY_BINDINGS, QUALITY_LEVELS, SETTINGS_RANGES, type QualityLevel, type Settings } from './settings.ts';
import './menu.css';

export interface MenuOptions {
  /** The lobby's root: the Play panel. */
  play: HTMLElement;
  settings: Settings;
  onSettings: (next: Settings) => void;
  onResume: () => void;
  onLeave: () => void;
}

export type MenuMode = 'hidden' | 'main' | 'pause';
export type MenuTab = 'play' | 'settings';

export interface Menu {
  readonly root: HTMLElement;
  readonly mode: MenuMode;
  readonly tab: MenuTab;
  /** The main menu: the lobby's Play panel and Settings. */
  showMain(): void;
  /** The pause menu: Resume, Settings, Leave. */
  showPause(): void;
  hide(): void;
  select(tab: MenuTab): void;
  /** Put a settings value into the controls (a reset, or one loaded after the fact). */
  setSettings(next: Settings): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent?.append(node);
  return node;
}

function button(text: string, className: string, onClick: () => void, parent?: HTMLElement): HTMLButtonElement {
  const b = el('button', className, parent);
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

const QUALITY_TEXT: Readonly<Record<QualityLevel, string>> = {
  low: 'Low — under the budget, for a weaker machine',
  medium: 'Medium — the budget: 60 fps at 1080p on integrated graphics',
  high: 'High — a discrete GPU\'s headroom on resolution and shadows',
};

export function createMenu(options: MenuOptions): Menu {
  const root = el('div', 'menu hidden');
  root.id = 'menu';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'menu-title');
  const card = el('div', 'menu-card', root);
  const header = el('header', 'menu-header', card);
  const title = el('h1', 'menu-title', header);
  title.id = 'menu-title';
  title.innerHTML = 'Sandline <span>M4</span>';
  const nav = el('nav', 'menu-nav', header);
  const playTab = button('Play', 'menu-tab', () => select('play'), nav);
  playTab.dataset['tab'] = 'play';
  const settingsTab = button('Settings', 'menu-tab', () => select('settings'), nav);
  settingsTab.dataset['tab'] = 'settings';
  const leaveButton = button('Leave session', 'menu-tab menu-leave', () => options.onLeave(), nav);

  const body = el('div', 'menu-body', card);
  const playPanel = el('section', 'menu-panel menu-play', body);
  playPanel.append(options.play);
  const pausePanel = el('section', 'menu-panel menu-pause', body);
  const pauseText = el('p', 'menu-pause-text', pausePanel);
  pauseText.textContent = 'Paused for you only: the session runs on. Esc or Resume to go back.';
  button('Resume', 'lobby-primary menu-resume', () => options.onResume(), pausePanel);

  // -- Settings --
  const settingsPanel = el('section', 'menu-panel menu-settings', body);
  let current: Settings = { ...options.settings, volumes: { ...options.settings.volumes } };
  const emit = (): void => options.onSettings({ ...current, volumes: { ...current.volumes } });

  const controls: { refresh: () => void }[] = [];
  const range = (
    label: string,
    key: string,
    min: number,
    max: number,
    step: number,
    read: () => number,
    write: (v: number) => void,
    format: (v: number) => string = (v) => v.toFixed(2),
  ): void => {
    const row = el('label', 'menu-row', settingsPanel);
    const text = el('span', 'menu-row-label', row);
    text.textContent = label;
    const input = el('input', 'menu-range', row);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.dataset['setting'] = key;
    const value = el('output', 'menu-row-value', row);
    const refresh = (): void => {
      input.value = String(read());
      value.textContent = format(read());
    };
    input.addEventListener('input', () => {
      write(Number(input.value));
      refresh();
      emit();
    });
    controls.push({ refresh });
  };
  const check = (label: string, key: string, read: () => boolean, write: (v: boolean) => void): void => {
    const row = el('label', 'menu-row menu-check', settingsPanel);
    const input = el('input', 'menu-checkbox', row);
    input.type = 'checkbox';
    input.dataset['setting'] = key;
    const text = el('span', 'menu-row-label', row);
    text.textContent = label;
    const refresh = (): void => {
      input.checked = read();
    };
    input.addEventListener('change', () => {
      write(input.checked);
      emit();
    });
    controls.push({ refresh });
  };

  const heading = (text: string): void => {
    const h = el('h2', 'menu-heading', settingsPanel);
    h.textContent = text;
  };

  heading('Look');
  range('Mouse sensitivity', 'sensitivity', SETTINGS_RANGES.sensitivity.min, SETTINGS_RANGES.sensitivity.max, SETTINGS_RANGES.sensitivity.step, () => current.sensitivity, (v) => { current.sensitivity = v; });
  check('Invert vertical look', 'invertY', () => current.invertY, (v) => { current.invertY = v; });
  range('Field of view', 'fovDeg', SETTINGS_RANGES.fovDeg.min, SETTINGS_RANGES.fovDeg.max, SETTINGS_RANGES.fovDeg.step, () => current.fovDeg, (v) => { current.fovDeg = v; }, (v) => `${Math.round(v)}°`);

  heading('Audio');
  const audioNote = el('p', 'menu-note', settingsPanel);
  audioNote.textContent = 'Kept for E-2.7, the combat audio, which is not in this build yet.';
  const percent = (v: number): string => `${Math.round(v * 100)}%`;
  range('Master', 'master', 0, 1, SETTINGS_RANGES.volume.step, () => current.volumes.master, (v) => { current.volumes.master = v; }, percent);
  range('Effects', 'effects', 0, 1, SETTINGS_RANGES.volume.step, () => current.volumes.effects, (v) => { current.volumes.effects = v; }, percent);
  range('Voice', 'voice', 0, 1, SETTINGS_RANGES.volume.step, () => current.volumes.voice, (v) => { current.volumes.voice = v; }, percent);

  heading('Graphics');
  const qualityRow = el('label', 'menu-row', settingsPanel);
  const qualityLabel = el('span', 'menu-row-label', qualityRow);
  qualityLabel.textContent = 'Quality';
  const qualitySelect = el('select', 'menu-select', qualityRow);
  qualitySelect.dataset['setting'] = 'quality';
  for (const level of QUALITY_LEVELS) {
    const option = document.createElement('option');
    option.value = level;
    option.textContent = QUALITY_TEXT[level];
    qualitySelect.append(option);
  }
  qualitySelect.addEventListener('change', () => {
    current.quality = qualitySelect.value as QualityLevel;
    emit();
  });
  controls.push({ refresh: () => { qualitySelect.value = current.quality; } });

  heading('Keys');
  const keys = el('dl', 'menu-keys', settingsPanel);
  for (const binding of KEY_BINDINGS) {
    const dt = el('dt', '', keys);
    dt.textContent = binding.action;
    const dd = el('dd', '', keys);
    dd.textContent = binding.keys;
  }
  const keysNote = el('p', 'menu-note', settingsPanel);
  keysNote.textContent = 'Shown, not yet rebindable.';

  button('Reset to defaults', 'lobby-secondary menu-reset', () => {
    current = { ...DEFAULT_SETTINGS, volumes: { ...DEFAULT_SETTINGS.volumes } };
    for (const c of controls) c.refresh();
    emit();
  }, settingsPanel);

  let mode: MenuMode = 'hidden';
  let tab: MenuTab = 'play';

  const render = (): void => {
    // The attribute as well as the class: hidden with or without the stylesheet.
    root.hidden = mode === 'hidden';
    root.classList.toggle('hidden', mode === 'hidden');
    root.dataset['mode'] = mode;
    playTab.textContent = mode === 'pause' ? 'Resume' : 'Play';
    leaveButton.hidden = mode !== 'pause';
    playTab.classList.toggle('selected', tab === 'play');
    settingsTab.classList.toggle('selected', tab === 'settings');
    playPanel.hidden = !(mode === 'main' && tab === 'play');
    pausePanel.hidden = !(mode === 'pause' && tab === 'play');
    settingsPanel.hidden = tab !== 'settings';
  };
  const select = (next: MenuTab): void => {
    // In the pause menu the first tab is Resume itself.
    if (mode === 'pause' && next === 'play' && tab === 'play') {
      options.onResume();
      return;
    }
    tab = next;
    render();
  };
  render();
  for (const c of controls) c.refresh();

  return {
    root,
    get mode() {
      return mode;
    },
    get tab() {
      return tab;
    },
    showMain() {
      mode = 'main';
      tab = 'play';
      render();
    },
    showPause() {
      mode = 'pause';
      tab = 'play';
      render();
    },
    hide() {
      mode = 'hidden';
      render();
    },
    select,
    setSettings(next) {
      current = { ...next, volumes: { ...next.volumes } };
      for (const c of controls) c.refresh();
    },
  };
}

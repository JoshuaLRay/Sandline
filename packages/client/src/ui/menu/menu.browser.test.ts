/**
 * The menus in a real browser (T-4.26): the main menu around the lobby's
 * Play panel, the pause menu's Resume and Leave, and settings that a page
 * reloaded from the same localStorage comes back with. Run with
 * `pnpm test:parity-browsers` (the `assets-browsers` project).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMenu } from './Menu.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings, browserStore, loadSettings, saveSettings } from './settings.ts';

function mount() {
  const play = document.createElement('div');
  play.id = 'lobby';
  play.textContent = 'the lobby';
  const applied: Settings[] = [];
  let resumed = 0;
  let left = 0;
  const menu = createMenu({
    play,
    settings: loadSettings(browserStore()),
    onSettings: (next) => {
      applied.push(next);
      saveSettings(browserStore(), next);
    },
    onResume: () => {
      resumed += 1;
    },
    onLeave: () => {
      left += 1;
    },
  });
  document.body.append(menu.root);
  const setting = <T extends HTMLElement>(key: string): T => document.querySelector<T>(`[data-setting="${key}"]`)!;
  // Ancestors count: a panel inside a hidden section is not visible.
  const visible = (el: Element | null): boolean => el !== null && (el as HTMLElement).checkVisibility();
  return { menu, play, applied, get resumed() { return resumed; }, get left() { return left; }, setting, visible };
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.removeItem(SETTINGS_KEY);
});

describe('the menus (T-4.26)', () => {
  it('the main menu shows the lobby on Play and the settings on Settings; hidden shows nothing', () => {
    const { menu, play, visible } = mount();
    expect(visible(menu.root)).toBe(false);
    menu.showMain();
    expect(visible(menu.root)).toBe(true);
    expect(visible(play)).toBe(true);
    expect(visible(document.querySelector('.menu-settings'))).toBe(false);
    document.querySelector<HTMLButtonElement>('.menu-tab[data-tab="settings"]')!.click();
    expect(menu.tab).toBe('settings');
    expect(visible(play)).toBe(false);
    expect(visible(document.querySelector('.menu-settings'))).toBe(true);
    // The lobby's own show/hide still rules its panel inside the menu.
    document.querySelector<HTMLButtonElement>('.menu-tab[data-tab="play"]')!.click();
    expect(visible(play)).toBe(true);
    play.hidden = true;
    expect(visible(play)).toBe(false);
    menu.hide();
    expect(visible(menu.root)).toBe(false);
  });

  it('the pause menu resumes on Resume and on its first tab, and leaves on Leave', () => {
    const t = mount();
    t.menu.showPause();
    expect(t.visible(t.menu.root)).toBe(true);
    expect(t.visible(t.play)).toBe(false);
    expect(t.visible(document.querySelector('.menu-pause'))).toBe(true);
    document.querySelector<HTMLButtonElement>('.menu-resume')!.click();
    expect(t.resumed).toBe(1);
    document.querySelector<HTMLButtonElement>('.menu-tab[data-tab="play"]')!.click();
    expect(t.resumed).toBe(2);
    document.querySelector<HTMLButtonElement>('.menu-tab[data-tab="settings"]')!.click();
    expect(t.visible(document.querySelector('.menu-settings'))).toBe(true);
    document.querySelector<HTMLButtonElement>('.menu-leave')!.click();
    expect(t.left).toBe(1);
  });

  it('a setting changed in the menu is applied, stored, and back after a reload', () => {
    const first = mount();
    first.menu.showMain();
    first.menu.select('settings');
    const sensitivity = first.setting<HTMLInputElement>('sensitivity');
    sensitivity.value = '1.25';
    sensitivity.dispatchEvent(new Event('input', { bubbles: true }));
    const invert = first.setting<HTMLInputElement>('invertY');
    invert.checked = true;
    invert.dispatchEvent(new Event('change', { bubbles: true }));
    const quality = first.setting<HTMLSelectElement>('quality');
    quality.value = 'high';
    quality.dispatchEvent(new Event('change', { bubbles: true }));
    const master = first.setting<HTMLInputElement>('master');
    master.value = '0.3';
    master.dispatchEvent(new Event('input', { bubbles: true }));
    expect(first.applied.at(-1)).toMatchObject({ sensitivity: 1.25, invertY: true, quality: 'high', volumes: { master: 0.3 } });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toMatchObject({ sensitivity: 1.25, invertY: true, quality: 'high' });

    // A reload: a fresh menu from the same store shows the same values.
    document.body.innerHTML = '';
    const second = mount();
    expect(loadSettings(browserStore())).toMatchObject({ sensitivity: 1.25, invertY: true, quality: 'high', volumes: { master: 0.3 } });
    expect(second.setting<HTMLInputElement>('sensitivity').value).toBe('1.25');
    expect(second.setting<HTMLInputElement>('invertY').checked).toBe(true);
    expect(second.setting<HTMLSelectElement>('quality').value).toBe('high');

    // Reset puts the defaults back, and stores them.
    document.querySelector<HTMLButtonElement>('.menu-reset')!.click();
    expect(second.applied.at(-1)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(browserStore())).toEqual(DEFAULT_SETTINGS);
  });
});

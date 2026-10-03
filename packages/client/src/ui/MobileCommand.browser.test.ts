import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileCommand } from './MobileCommand.ts';
import type { CommandRow } from './menu/commandModel.ts';

const rows: CommandRow[] = [0, 1, 2].map(slot => ({
  slot, label: `${slot + 1} · Bot · AR`, human: slot === 2, commander: slot === 2 ? -1 : 0,
  options: [], switchable: slot !== 2, captured: false,
}));
const roots: HTMLElement[] = [];
afterEach(() => { roots.forEach(root => root.remove()); roots.length = 0; });
function setup() {
  const parent = document.createElement('div');
  document.body.append(parent);
  roots.push(parent);
  const actions = { watch: vi.fn(), assign: vi.fn(), aggression: vi.fn(), order: vi.fn(() => true), settings: vi.fn(), leave: vi.fn(), recenter: vi.fn() };
  const ui = createMobileCommand(parent, actions);
  ui.root.hidden = false;
  ui.update(rows, 0, 0);
  return { ui, actions };
}
function pointer(button: Element, type: string, x: number, y: number) {
  button.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
}

describe('mobile direct commands', () => {
  it('selects a bot and arms an order directly, then sends once at the scene tap', () => {
    const { ui, actions } = setup();
    (ui.root.querySelectorAll('.mobile-squad button')[2] as HTMLButtonElement).click();
    expect(actions.watch).toHaveBeenCalledWith(1);
    (ui.root.querySelector('.mobile-quick-orders button') as HTMLButtonElement).click();
    expect(actions.order).not.toHaveBeenCalled();
    expect(ui.tapAt(123, 456)).toBe(true);
    expect(actions.order).toHaveBeenCalledExactlyOnceWith('move', { to: 'slot', index: 1 }, 123, 456);
    expect(ui.tapAt(123, 456)).toBe(false);
  });
  it('sends one drag-and-release command and ignores drops on controls', () => {
    const { ui, actions } = setup();
    const button = ui.root.querySelector('.mobile-quick-orders button')!;
    // Synthetic pointer events do not create native active pointers for capture.
    vi.spyOn(button, 'setPointerCapture').mockImplementation(() => {});
    const canvas = document.createElement('canvas');
    roots.push(canvas);
    document.body.append(canvas);
    const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(canvas);
    pointer(button, 'pointerdown', 10, 10);
    pointer(button, 'pointermove', 100, 100);
    pointer(button, 'pointerup', 100, 100);
    expect(actions.order).toHaveBeenCalledExactlyOnceWith('move', { to: 'all' }, 100, 100);
    hit.mockReturnValue(button);
    pointer(button, 'pointerdown', 10, 10);
    pointer(button, 'pointermove', 100, 100);
    pointer(button, 'pointerup', 100, 100);
    expect(actions.order).toHaveBeenCalledTimes(1);
    hit.mockRestore();
  });
  it('cancels placement on gesture interruption and roster changes', () => {
    const { ui, actions } = setup();
    const button = ui.root.querySelector('.mobile-quick-orders button') as HTMLButtonElement;
    button.click();
    ui.cancelPlacement();
    expect(ui.tapAt(20, 20)).toBe(false);
    button.click();
    ui.update(rows.map(row => ({ ...row, commander: 2 })), 0, 0);
    expect(ui.tapAt(20, 20)).toBe(false);
    ui.issueAt(20, 20);
    expect(actions.order).not.toHaveBeenCalled();
    expect(ui.root.querySelector('[role="status"]')?.textContent).toContain('unavailable');
  });
});


describe('mobile aggression commands', () => {
  function openSquad(ui: ReturnType<typeof createMobileCommand>) {
    (ui.root.querySelector('.mobile-trigger') as HTMLButtonElement).click();
  }
  function policies(ui: ReturnType<typeof createMobileCommand>) {
    return Array.from(ui.root.querySelectorAll<HTMLButtonElement>('.mobile-aggression button'));
  }
  it('sends every group policy directly and waits for authoritative confirmation', () => {
    const { ui, actions } = setup();
    openSquad(ui);
    expect(policies(ui).map(button => button.textContent)).toEqual(['Hold fire', 'Defensive', 'Aggressive']);
    for (const [index, mode] of ['hold-fire', 'defensive', 'aggressive'].entries()) {
      policies(ui)[index]!.click();
      expect(actions.aggression).toHaveBeenLastCalledWith(mode, { to: 'all' });
    }
    expect(actions.aggression).toHaveBeenCalledTimes(3);
    expect(actions.order).not.toHaveBeenCalled();
    expect(policies(ui)[2]!.getAttribute('aria-pressed')).toBe('true');
    ui.update(rows, 0, 0, ['hold-fire', 'defensive', 'aggressive']);
    expect(ui.root.querySelector('.mobile-aggression-status')?.textContent).toBe('Current: mixed');
    expect(policies(ui).every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
    ui.update(rows, 0, 0, ['defensive', 'defensive', 'aggressive']);
    expect(policies(ui)[1]!.getAttribute('aria-pressed')).toBe('true');
  });
  it('addresses the selected bot, including the spectator’s own AI character', () => {
    const { ui, actions } = setup();
    (ui.root.querySelectorAll('.mobile-squad button')[2] as HTMLButtonElement).click();
    ui.update(rows, 1, 0, ['aggressive', 'hold-fire', 'aggressive']);
    openSquad(ui);
    expect(policies(ui)[0]!.getAttribute('aria-pressed')).toBe('true');
    policies(ui)[1]!.click();
    expect(actions.aggression).toHaveBeenCalledExactlyOnceWith('defensive', { to: 'slot', index: 1 });
    (ui.root.querySelectorAll('.mobile-squad button')[1] as HTMLButtonElement).click();
    policies(ui)[0]!.click();
    expect(actions.aggression).toHaveBeenLastCalledWith('hold-fire', { to: 'slot', index: 0 });
  });
  it('cancels armed scene placement when opening the policy menu', () => {
    const { ui, actions } = setup();
    (ui.root.querySelector('.mobile-quick-orders button') as HTMLButtonElement).click();
    openSquad(ui);
    policies(ui)[0]!.click();
    expect(ui.tapAt(10, 10)).toBe(false);
    expect(actions.order).not.toHaveBeenCalled();
  });
  it('disables policies after a selected bot is captured or reassigned, and for groups without eligible bots', () => {
    for (const unavailable of [{ captured: true }, { commander: 2 }, { human: true, label: '2 · Human · AR' }]) {
      const { ui, actions } = setup();
      (ui.root.querySelectorAll('.mobile-squad button')[2] as HTMLButtonElement).click();
      openSquad(ui);
      ui.update(rows.map(row => row.slot === 1 ? { ...row, ...unavailable } : row), 1, 0);
      expect(policies(ui).every(button => button.disabled)).toBe(true);
      policies(ui)[0]!.click();
      expect(actions.aggression).not.toHaveBeenCalled();
      (ui.root.querySelector('.mobile-squad button') as HTMLButtonElement).click();
      ui.update(rows.map(row => ({ ...row, commander: 2 })), 1, 0);
      expect(policies(ui).every(button => button.disabled)).toBe(true);
    }
  });
});

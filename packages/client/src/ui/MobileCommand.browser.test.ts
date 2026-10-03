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
  const actions = { watch: vi.fn(), assign: vi.fn(), order: vi.fn(() => true), settings: vi.fn(), leave: vi.fn(), recenter: vi.fn() };
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from '@vitest/browser/context';
import { RESTORE_MAP_CHANGED_MESSAGE } from '@sandline/shared';
import { createRestoreChoice, type RestoreChoiceModel } from './restoreChoice.ts';

afterEach(() => { document.body.innerHTML = ''; });

const model = (over: Partial<RestoreChoiceModel> = {}): RestoreChoiceModel => ({
  message: RESTORE_MAP_CHANGED_MESSAGE, host: true, waiting: '', inventory: 'Restart uses the original mission-start inventory.',
  restartAllowed: true, options: [{ run: 'replay', mission: 'earlier', label: 'Replay — Earlier', briefing: ['First mission'] }], ...over,
});

describe('the restore dialog on desktop and mobile (U-143)', () => {
  it.each([1280, 360])('provides usable restart, mission select and leave actions at %s px', async (width) => {
    await page.viewport(width, 720);
    const choice = createRestoreChoice(document.body);
    const restart = vi.fn(); const choose = vi.fn(); const leave = vi.fn();
    choice.set(model(), restart, choose, leave);
    expect(choice.root.hidden).toBe(false);
    expect(choice.root.getAttribute('aria-modal')).toBe('true');
    expect(choice.root.querySelector('h2')!.textContent).toBe(RESTORE_MAP_CHANGED_MESSAGE);
    const buttons = [...choice.root.querySelectorAll('button')];
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[0]!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(choice.root.querySelector('.restore-choice-panel')!.getBoundingClientRect().width).toBeLessThanOrEqual(width);
    buttons[0]!.click(); expect(restart).toHaveBeenCalledOnce();
    choice.root.querySelector('summary')!.click();
    expect(buttons[1]!.checkVisibility()).toBe(true);
    await page.screenshot({ path: `../../../../docs/backlog/evidence/U-143-restore-${width}.png` });
    buttons[1]!.click(); expect(choose).toHaveBeenCalledWith('replay', 'earlier');
    buttons[2]!.click(); expect(leave).toHaveBeenCalledOnce();
    choice.set(null, restart, choose, leave); expect(choice.root.hidden).toBe(true);
  });

  it('keeps guests waiting and leaves only Leave room available', () => {
    const choice = createRestoreChoice(document.body); const restart = vi.fn(); const choose = vi.fn(); const leave = vi.fn();
    choice.set(model({ host: false, waiting: 'Ann is choosing how to continue' }), restart, choose, leave);
    expect(choice.root.textContent).toContain('Ann is choosing how to continue');
    const buttons = [...choice.root.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Leave room']);
    buttons[0]!.click(); expect(leave).toHaveBeenCalledOnce();
    expect(restart).not.toHaveBeenCalled(); expect(choose).not.toHaveBeenCalled();
  });

  it('disables prisoner restart, retains selection, and keeps keyboard focus inside the decision', () => {
    const choice = createRestoreChoice(document.body); const restart = vi.fn();
    choice.set(model({ restartAllowed: false, inventory: 'Approved holding positions are required; the pool is preserved.' }), restart, vi.fn(), vi.fn());
    const button = choice.root.querySelector('button')!; expect(button.disabled).toBe(true);
    button.click(); expect(restart).not.toHaveBeenCalled();
    const summary = choice.root.querySelector('summary')!; expect(document.activeElement).toBe(summary);
    summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement!.textContent).toBe('Leave room');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(summary);
  });
});

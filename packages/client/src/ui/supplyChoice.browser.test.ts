import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from '@vitest/browser/context';
import { SUPPLY_FIXTURES } from './supplyFixtures.ts';
import { mountSupplyReview } from './supplyReview.ts';
import { createSupplyChoice } from './supplyChoice.ts';
import { createMobileCommand } from './MobileCommand.ts';

let review: ReturnType<typeof mountSupplyReview> | null = null;
afterEach(() => { review?.dispose(); review = null; document.body.replaceChildren(); });

describe('cache choices in a real browser (U-134)', () => {
  it.each([1280, 360])('captures all five stock types, partial use, contention and exhausted scenery at %s px', async width => {
    await page.viewport(width, 800);
    const mobile = width === 360;
    const ui = review = mountSupplyReview(document.body, mobile);
    const button = (id: string) => ui.choice.root.querySelector<HTMLButtonElement>(`button[data-item="${id}"]`)!;
    if (!mobile) {
      expect(button('rocket').getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      button('primary-ammo').click(); ui.refresh();
    } else {
      expect(ui.choice.root.querySelectorAll('button')).toHaveLength(1); // hidden Cancel only; stock rows never issue use.
      ui.actor.net.selectSupply('P-SOUTH', { kind: 'primary-ammo' }); ui.room.settle();
    }
    ui.actor.holding = true;
    // Contention is another real user's accepted choice, never a locally invented reservation.
    const other = ui.room.place(ui.observer, 0); other.kits = 0;
    if (!mobile) { ui.observer.net.selectSupply('P-SOUTH', { kind: 'health-kit' }); ui.observer.holding = true; ui.room.settle(); }
    ui.step(12);
    expect(ui.choice.root.textContent).toContain('40%');
    expect(ui.choice.root.querySelector('progress')!.value).toBe(mobile ? 0 : 40);
    if (!mobile) expect(ui.choice.root.querySelector('.supply-others')!.textContent).toContain('40%');
    await page.screenshot({ path: `../../../../docs/backlog/evidence/U-134-P-SOUTH-${width}.png` });
    ui.step(18); ui.actor.holding = ui.observer.holding = false;
    expect(ui.viewer.net.supplyCaches[0]!.stock.primaryAmmoUnits).toBe(14040);
    expect(ui.choice.root.textContent).toContain('5.85 magazine equivalents');
    await page.screenshot({ path: `../../../../docs/backlog/evidence/U-134-partial-${width}.png` });
    for (let i = 1; i < 5; i++) {
      ui.show(i);
      if (i === 2 && !mobile) {
        ui.room.session.slots[1]!.kits = 3; ui.room.session.slots[1]!.weaponState.ammo = 100; ui.step(3);
        expect(button('health-kit').disabled).toBe(true); expect(button('primary-ammo').disabled).toBe(true);
      }
      if (i === 3 && !mobile) {
        ui.room.session.slots[1]!.equipment = -1; ui.step(3);
        expect(button('rocket').disabled).toBe(true); expect(button('rocket').textContent).toContain('Incompatible');
        const stock = structuredClone(ui.viewer.net.supplyCaches); button('rocket').click(); ui.step(30);
        expect(ui.viewer.net.supplyCaches).toEqual(stock);
      }
      if (i === 4) {
        const soldier = ui.room.session.slots[1]!; soldier.equipment = 1;
        // Spend all three finite pools through the real host; reset capacity only inside this fixture.
        for (let n = 0; n < 15; n++) {
          soldier.pouch[1] = 0; soldier.kits = 0; soldier.weaponState.ammo = 0;
          const item = n < 6 ? { kind: 'projectile', projectile: 'rocket' } as const
            : n < 9 ? { kind: 'health-kit' } as const : { kind: 'primary-ammo' } as const;
          ui.actor.net.selectSupply('P-OUTPOST', item); ui.room.settle(); ui.actor.holding = true; ui.step(30);
        }
        ui.actor.holding = false; ui.step(3);
        expect(ui.choice.root.textContent).toContain('Empty supply cache');
        expect(ui.scenery.count).toBe(5);
      }
      expect(ui.choice.root.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      expect(ui.choice.root.textContent).toContain(SUPPLY_FIXTURES[i]!.id);
      await page.screenshot({ path: `../../../../docs/backlog/evidence/U-134-${SUPPLY_FIXTURES[i]!.id}-${width}.png` });
    }
    expect(ui.renderer.info.render.calls).toBe(3); // Floor plus two shared cache draws, including exhausted boxes.
  }, 30_000);

  it('keeps the focused choice stable during progress, and cancels accepted/pending selection on UI dismissal', () => {
    const ui = review = mountSupplyReview(document.body);
    const health = ui.choice.root.querySelector<HTMLButtonElement>('button[data-item="health-kit"]')!;
    health.focus(); health.click(); ui.refresh();
    const selected = ui.choice.root.querySelector<HTMLButtonElement>('button[data-item="health-kit"]')!;
    selected.focus(); ui.actor.holding = true; ui.step(12);
    expect(document.activeElement).toBe(selected);
    ui.choice.set(null); ui.room.settle(); expect(ui.actor.net.supplyProgress).toEqual([]);
    ui.step(30); expect(ui.actor.net.kits).toBe(0);
    const select = vi.fn(); const panel = createSupplyChoice(document.body, select);
    panel.set(ui.room.model(ui.actor, 0)); panel.root.querySelector<HTMLButtonElement>('button[data-item="health-kit"]')!.click();
    panel.set(null); expect(select).toHaveBeenLastCalledWith('P-SOUTH', null);
  });

  it('keeps landscape stock scrolling clear of the approved camera and command controls', async () => {
    await page.viewport(820, 360);
    const ui = review = mountSupplyReview(document.body, true);
    const command = createMobileCommand(document.body, {
      watch: vi.fn(), assign: vi.fn(), aggression: vi.fn(), order: vi.fn(() => true), settings: vi.fn(), leave: vi.fn(), recenter: vi.fn(),
    });
    command.root.hidden = false; command.update([], 1, 0);
    const info = ui.choice.root.getBoundingClientRect();
    const recenter = command.root.querySelector('.mobile-recenter')!.getBoundingClientRect();
    const orders = command.root.querySelector('.mobile-quick-orders')!.getBoundingClientRect();
    expect(info.top).toBeGreaterThan(recenter.bottom);
    expect(info.bottom).toBeLessThan(orders.top);
    expect(ui.choice.root.scrollHeight).toBeGreaterThan(ui.choice.root.clientHeight);
    ui.choice.root.scrollTop = ui.choice.root.scrollHeight;
    expect(ui.choice.root.querySelector('.supply-help')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(info.bottom);
    ui.choice.root.scrollTop = 0;
    document.querySelector<HTMLElement>('.supply-fixture-caption')!.hidden = true;
    await page.screenshot({ path: '../../../../docs/backlog/evidence/U-134-mobile-landscape.png' });
  });
});

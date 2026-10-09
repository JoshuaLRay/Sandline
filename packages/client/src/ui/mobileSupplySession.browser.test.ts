import { afterEach, describe, expect, it } from 'vitest';
import { page } from '@vitest/browser/context';
import { mountMobileSupplyReview } from './mobileSupplyReview.ts';

let review: ReturnType<typeof mountMobileSupplyReview> | null = null;
afterEach(() => { review?.dispose(); review = null; document.body.replaceChildren(); });

describe('phone collection lifecycle through Session and the production adapter (U-148)', () => {
  it.each(['cancel', 'blur', 'menu', 'ownership', 'capture', 'reconnect'] as const)(
    'cancels actual host collection on %s without spending or repeating stock', async why => {
      await page.viewport(360, 800);
      const ui = review = mountMobileSupplyReview(document.body);
      const open = () => ui.choice.root.querySelector<HTMLButtonElement>('.mobile-supply-trigger')!.click();
      open();
      const recipient = ui.choice.root.querySelector<HTMLSelectElement>('[aria-label="Supply recipient"]')!;
      recipient.value = '1'; recipient.dispatchEvent(new Event('change'));
      ui.choice.root.querySelector<HTMLButtonElement>('[data-item="health-kit"]')!.click(); ui.step(12);
      expect(ui.choice.root.querySelector('progress')!.value).toBe(40);
      if (why === 'cancel') ui.choice.root.querySelector<HTMLButtonElement>('.mobile-supply-cancel')!.click();
      if (why === 'blur') window.dispatchEvent(new Event('blur'));
      if (why === 'menu') ui.command.root.querySelector<HTMLButtonElement>('.mobile-settings')!.click();
      if (why === 'ownership') { ui.desktop.net.assignCommander(1, 3); ui.room.settle(); ui.refresh(); }
      if (why === 'capture') { expect(ui.room.session.captureCharacter(1, { x: 20, y: 0, z: 20 })).toBe(true); ui.room.settle(); ui.refresh(); }
      if (why === 'reconnect') { ui.choice.set(null); ui.room.reconnect(ui.commander); ui.commander.net.spectate(3); ui.room.settle(); }
      ui.step(33);
      expect(ui.commander.net.supplyProgress).toEqual([]);
      expect(ui.room.session.slots[1]!.kits).toBe(0);
      expect(ui.commander.net.supplyCaches[0]!.stock.healthKits).toBe(2);
      expect(ui.room.requests(ui.commander).filter(message => message.item !== null)).toHaveLength(1);
      expect(ui.room.requests(ui.commander).filter(message => message.item === null).length).toBeLessThanOrEqual(1);
    },
  );

  it('shows the host depleted result to competing phone and desktop users', async () => {
    await page.viewport(360, 800);
    const ui = review = mountMobileSupplyReview(document.body); ui.show(1);
    ui.choice.root.querySelector<HTMLButtonElement>('.mobile-supply-trigger')!.click();
    const recipient = ui.choice.root.querySelector<HTMLSelectElement>('[aria-label="Supply recipient"]')!;
    recipient.value = '1'; recipient.dispatchEvent(new Event('change'));
    const cache = ui.choice.root.querySelector<HTMLSelectElement>('[aria-label="Supply cache"]')!;
    cache.value = 'P-ROAD'; cache.dispatchEvent(new Event('change'));
    ui.choice.root.querySelector<HTMLButtonElement>('[data-item="health-kit"]')!.click();
    ui.desktop.net.selectSupply('P-ROAD', { kind: 'health-kit' }); ui.desktop.holding = true; ui.room.settle(); ui.step(30);
    const depleted = ui.choice.root.querySelector<HTMLButtonElement>('[data-item="health-kit"]')!;
    expect(depleted.disabled).toBe(true); expect(depleted.textContent).toContain('Depleted');
    expect(ui.room.session.slots[1]!.kits).toBe(1); expect(ui.desktop.net.kits).toBe(0);
    expect(ui.commander.net.supplyCaches[1]!.stock.healthKits).toBe(0);
    const panel = ui.choice.root.querySelector<HTMLElement>('.mobile-supply-panel')!;
    panel.scrollTop = Math.max(0, panel.scrollHeight - panel.clientHeight);
    await page.screenshot({ path: '../../../../docs/backlog/evidence/U-148-depleted-contention-360.png' });
    ui.desktop.holding = false; ui.step(30);
    expect(ui.commander.net.supplyCaches[1]!.stock.healthKits).toBe(0);
  });

  it('keeps empty scenery and disables every choice after finite host transfers exhaust the cache', async () => {
    await page.viewport(360, 800);
    const ui = review = mountMobileSupplyReview(document.body);
    ui.choice.root.querySelector<HTMLButtonElement>('.mobile-supply-trigger')!.click();
    const recipient = ui.choice.root.querySelector<HTMLSelectElement>('[aria-label="Supply recipient"]')!;
    recipient.value = '1'; recipient.dispatchEvent(new Event('change'));
    const soldier = ui.room.session.slots[1]!;
    // Capacity is reset only by this isolated review fixture. Every transfer and stock update is host-owned.
    for (const [item, repeats] of [['rocket', 3], ['health-kit', 2], ['primary-ammo', 6]] as const) {
      for (let n = 0; n < repeats; n++) {
        soldier.pouch[1] = 0; soldier.kits = 0; soldier.weaponState.ammo = 0; ui.step(3);
        const button = ui.choice.root.querySelector<HTMLButtonElement>(`[data-item="${item}"]`)!;
        expect(button.disabled).toBe(false); button.click(); ui.step(30);
      }
    }
    expect(ui.commander.net.supplyCaches[0]!.stock).toEqual({ projectiles: { rocket: 0 }, healthKits: 0, primaryAmmoUnits: 0 });
    expect(ui.scenery.count).toBe(5);
    expect(ui.choice.root.textContent).toContain('Empty supply cache');
    expect(Array.from(ui.choice.root.querySelectorAll<HTMLButtonElement>('.mobile-supply-row')).every(button => button.disabled)).toBe(true);
    await page.screenshot({ path: '../../../../docs/backlog/evidence/U-148-empty-cache-360.png' });
    ui.step(30); expect(ui.scenery.count).toBe(5);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from '@vitest/browser/context';
import { createMoveState, type SupplyUseProgress } from '@sandline/shared';
import { createMobileSupplyChoice } from './mobileSupplyChoice.ts';
import { mobileSupplyChoiceModel } from './mobileSupplyModel.ts';
import { createMobileCommand } from './MobileCommand.ts';
import { commandRows } from './menu/commandModel.ts';
import { SUPPLY_FIXTURES, SUPPLY_FIXTURE_INVENTORY } from './supplyFixtures.ts';
import { createSupplySessionFixture } from './supplySessionFixture.ts';
import { mobileSupplyState } from './mobileSupplyState.ts';

const mounted: ReturnType<typeof createMobileSupplyChoice>[] = [];
afterEach(() => { mounted.forEach(ui => ui.dispose()); mounted.length = 0; vi.useRealTimers(); document.body.replaceChildren(); });

function setup() {
  const actions = { select: vi.fn(), onOpen: vi.fn() };
  const ui = createMobileSupplyChoice(document.body, actions); mounted.push(ui);
  const sessionKey = {};
  const source = {
    sessionKey, commanderSlot: 0, caches: SUPPLY_FIXTURES, uses: [] as readonly SupplyUseProgress[],
    rows: [{ slot: 1, label: '2 · Brennan · BRN', human: false, commander: 0, captured: false, switchable: true, options: [] }],
    inventory: () => SUPPLY_FIXTURE_INVENTORY, capacity: () => ({ pouch: [2, 2], healthKits: 3 }),
  };
  const refresh = () => ui.set(mobileSupplyChoiceModel(source));
  refresh(); (ui.root.querySelector('.mobile-supply-trigger') as HTMLButtonElement).click();
  const recipient = ui.root.querySelector<HTMLSelectElement>('[aria-label="Supply recipient"]')!;
  const cache = ui.root.querySelector<HTMLSelectElement>('[aria-label="Supply cache"]')!;
  const chooseBot = () => { recipient.value = '1'; recipient.dispatchEvent(new Event('change')); };
  const item = (id: string) => ui.root.querySelector<HTMLButtonElement>(`[data-item="${id}"]`)!;
  return { ui, actions, source, refresh, recipient, cache, chooseBot, item };
}

describe('mobile commander supplies in a real browser (U-148)', () => {
  it('requires one explicit bot, sends one type, preserves host progress and cancels accepted or pending use once', () => {
    const f = setup();
    expect(f.actions.onOpen).toHaveBeenCalledOnce();
    expect(f.item('health-kit').disabled).toBe(true);
    f.chooseBot(); f.item('health-kit').click();
    expect(f.actions.select).toHaveBeenCalledExactlyOnceWith(1, 'P-SOUTH', { kind: 'health-kit' });
    expect(f.ui.root.querySelector('progress')!.value).toBe(0);
    expect(f.ui.root.textContent).toContain('Request sent · waiting for host');
    f.source.uses = [{ slot: 1, cacheId: 'P-SOUTH', item: { kind: 'health-kit' }, percent: 0 }]; f.refresh();
    expect(f.ui.root.textContent).toContain('Host accepted · waiting to collect');
    expect(f.ui.root.textContent).not.toContain('Approaching');
    f.source.uses = [{ ...f.source.uses[0]!, percent: 40 }]; f.refresh();
    const active = f.item('health-kit'); active.focus(); f.refresh();
    expect(document.activeElement).toBe(active);
    expect(f.ui.root.querySelector('progress')!.value).toBe(40);
    expect(f.ui.root.textContent).toContain('Collecting · 40%');
    expect(f.item('health-kit').textContent).toContain('2 remaining');
    f.ui.cancel(); f.ui.cancel(); f.refresh(); f.ui.cancel();
    expect(f.actions.select).toHaveBeenCalledTimes(2);
    expect(f.actions.select).toHaveBeenLastCalledWith(1, 'P-SOUTH', null);
    f.source.uses = []; f.refresh();
    expect(f.ui.root.textContent).toContain('Host ended collection');
    (f.ui.root.querySelector('.mobile-supply-trigger') as HTMLButtonElement).click();
    f.item('health-kit').click(); f.ui.set(null);
    expect(f.actions.select).toHaveBeenCalledTimes(4);
    expect(f.actions.select).toHaveBeenLastCalledWith(1, 'P-SOUTH', null);
    expect(f.ui.root.hidden).toBe(true);
  });

  it.each(['recipient', 'cache', 'ownership', 'inventory', 'session', 'blur', 'class'])('cancels a pending request on %s changes', change => {
    const f = setup(); f.chooseBot(); f.item('health-kit').click();
    if (change === 'recipient') { f.recipient.value = '-1'; f.recipient.dispatchEvent(new Event('change')); }
    if (change === 'cache') { f.cache.value = 'P-ROAD'; f.cache.dispatchEvent(new Event('change')); }
    if (change === 'ownership') { f.source.rows[0]!.commander = 2; f.refresh(); }
    if (change === 'inventory') f.ui.set(mobileSupplyChoiceModel({ ...f.source, inventory: () => null }));
    if (change === 'session') f.ui.set(mobileSupplyChoiceModel({ ...f.source, sessionKey: {} }));
    if (change === 'blur') window.dispatchEvent(new Event('blur'));
    if (change === 'class') { f.source.rows[0]!.label = '2 · Holloway · HOL'; f.refresh(); }
    expect(f.actions.select).toHaveBeenLastCalledWith(1, 'P-SOUTH', null);
    expect(f.actions.select).toHaveBeenCalledTimes(2);
    expect(f.ui.root.querySelector('progress')!.value).toBe(0);
  });

  it('bounds a refused pending request, keeps late host progress cancelled and never times accepted collection locally', () => {
    vi.useFakeTimers();
    const f = setup(); f.chooseBot(); f.item('health-kit').click();
    vi.advanceTimersByTime(5000);
    expect(f.actions.select).toHaveBeenNthCalledWith(1, 1, 'P-SOUTH', { kind: 'health-kit' });
    expect(f.actions.select).toHaveBeenCalledTimes(2);
    expect(f.actions.select).toHaveBeenLastCalledWith(1, 'P-SOUTH', null);
    expect(f.ui.root.textContent).toContain('Collection not confirmed · request cancelled');
    f.source.uses = [{ slot: 1, cacheId: 'P-SOUTH', item: { kind: 'health-kit' }, percent: 0 }]; f.refresh();
    expect(f.ui.root.textContent).toContain('Cancellation requested');
    f.ui.cancel(); expect(f.actions.select).toHaveBeenCalledTimes(2);
    (f.ui.root.querySelector('.mobile-supply-trigger') as HTMLButtonElement).click();
    f.item('health-kit').click(); f.refresh();
    vi.advanceTimersByTime(60000);
    expect(f.actions.select).toHaveBeenCalledTimes(3);
    expect(f.ui.root.querySelector('progress')!.value).toBe(0);
    expect(f.ui.root.textContent).toContain('Host accepted · waiting to collect');
  });

  it.each(['full', 'incompatible', 'empty'])('cancels pending %s choices immediately on a confirmed change', status => {
    const f = setup(); f.chooseBot(); f.item('primary-ammo').click();
    if (status === 'full') f.ui.set(mobileSupplyChoiceModel({ ...f.source, inventory: () => ({ ...SUPPLY_FIXTURE_INVENTORY, ammo: 30 }) }));
    if (status === 'incompatible') f.ui.set(mobileSupplyChoiceModel({ ...f.source, inventory: () => ({ ...SUPPLY_FIXTURE_INVENTORY, heldWeapon: 'sidearm' }) }));
    if (status === 'empty') f.ui.set(mobileSupplyChoiceModel({ ...f.source, caches: SUPPLY_FIXTURES.map(row => ({ ...row, stock: { ...row.stock, primaryAmmoUnits: 0 } })) }));
    expect(f.actions.select).toHaveBeenLastCalledWith(1, 'P-SOUTH', null);
    expect(f.ui.root.textContent).toContain('Choice unavailable · request cancelled');
  });

  it.each([[360, 800], [820, 360]])('fits and scrolls with camera and command controls at %s × %s', async (width, height) => {
    await page.viewport(width, height);
    const f = setup(); f.chooseBot();
    const command = createMobileCommand(document.body, {
      watch: vi.fn(), assign: vi.fn(), aggression: vi.fn(), order: vi.fn(() => true), settings: vi.fn(), leave: vi.fn(), recenter: vi.fn(),
    });
    command.root.hidden = false; command.update([], 1, 0);
    const panel = f.ui.root.querySelector<HTMLElement>('.mobile-supply-panel')!;
    const trigger = f.ui.root.querySelector('.mobile-supply-trigger')!.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const camera = command.root.querySelector('.mobile-recenter')!.getBoundingClientRect();
    const orders = command.root.querySelector('.mobile-quick-orders')!.getBoundingClientRect();
    const squad = command.root.querySelector('.mobile-squad')!.getBoundingClientRect();
    expect(trigger.height).toBeGreaterThanOrEqual(48);
    expect(trigger.right).toBeLessThan(camera.left);
    expect(box.top > camera.bottom || box.right < camera.left || box.left > camera.right).toBe(true);
    expect(box.top > trigger.bottom || box.right < trigger.left || box.left > trigger.right).toBe(true);
    expect(box.bottom).toBeLessThan(Math.min(orders.top, squad.top));
    expect(box.left).toBeGreaterThanOrEqual(14); expect(box.right).toBeLessThanOrEqual(width - 14);
    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    panel.scrollTop = panel.scrollHeight;
    expect(panel.querySelector('.mobile-supply-help')!.getBoundingClientRect().bottom).toBeLessThan(box.bottom);
    panel.scrollTop = 0;
  });

  it.each([[360, 800], [820, 360]])('captures actual Session contention, confirmed recipient capacity and partial transfer at %s × %s', async (width, height) => {
    await page.viewport(width, height);
    const room = createSupplySessionFixture(); const commander = room.join(0); const other = room.join(3);
    commander.net.spectate(3); room.settle();
    const soldier = room.session.slots[1]!;
    soldier.state = createMoveState(0, 0, -1); soldier.kits = 0; soldier.weaponState.ammo = soldier.weapon.magSize - 15;
    const human = room.session.slots[3]!; human.state = createMoveState(0.5, 0, -1); human.kits = 0;
    room.step(3);
    const ui = createMobileSupplyChoice(document.body, {
      select: (slot, cacheId, item) => { commander.net.selectCommanderSupply(slot, cacheId, item); room.settle(); }, onOpen: vi.fn(),
    }); mounted.push(ui);
    const refresh = () => ui.set(mobileSupplyState(commander.net));
    refresh(); (ui.root.querySelector('.mobile-supply-trigger') as HTMLButtonElement).click();
    const recipient = ui.root.querySelector<HTMLSelectElement>('[aria-label="Supply recipient"]')!;
    expect(Array.from(recipient.options).some(option => option.value === '3')).toBe(false);
    recipient.value = '1'; recipient.dispatchEvent(new Event('change'));
    ui.root.querySelector<HTMLButtonElement>('[data-item="primary-ammo"]')!.click();
    other.net.selectSupply('P-SOUTH', { kind: 'health-kit' }); other.holding = true; room.settle();
    room.step(12); refresh();
    expect(ui.root.querySelector('progress')!.value).toBe(40);
    expect(ui.root.querySelector('.mobile-supply-others')!.textContent).toContain('Slot 4 · Health kit · Collecting 40%');
    expect(ui.root.querySelector('[data-item="primary-ammo"]')!.textContent).toContain('Take 15 rounds');
    const command = createMobileCommand(document.body, {
      watch: vi.fn(), assign: vi.fn(), aggression: vi.fn(), order: vi.fn(() => true), settings: vi.fn(), leave: vi.fn(), recenter: vi.fn(),
    }); command.root.hidden = false; command.update(commandRows(commander.net.roster, 0), 3, 0);
    await page.screenshot({ path: `../../../../docs/backlog/evidence/U-148-collection-${width}.png` });
    room.step(18); other.holding = false; refresh();
    expect(commander.net.supplyCaches[0]!.stock.primaryAmmoUnits).toBe(14040);
    expect(ui.root.querySelector('[data-item="primary-ammo"]')!.textContent).toContain('Already full');
    expect(ui.root.textContent).toContain('5.85 magazine equivalents');
    expect(ui.root.textContent).toContain('Host ended collection');
    const panel = ui.root.querySelector<HTMLElement>('.mobile-supply-panel')!;
    if (height < 450) panel.scrollTop = ui.root.querySelector<HTMLElement>('[data-item="primary-ammo"]')!.offsetTop - panel.clientHeight / 2;
    await page.screenshot({ path: `../../../../docs/backlog/evidence/U-148-partial-${width}.png` });
    panel.scrollTop = panel.scrollHeight;
    await page.screenshot({ path: `../../../../docs/backlog/evidence/U-148-scrolled-${width}.png` });
  }, 30_000);
});

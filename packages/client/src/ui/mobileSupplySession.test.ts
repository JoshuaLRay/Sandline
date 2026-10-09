import { describe, expect, it } from 'vitest';
import { createMobileSupplySessionFixture } from './mobileSupplySessionFixture.ts';

describe('production mobile supply adapter on real Session snapshots (U-148)', () => {
  it('confirms each recipient inventory, including the spectator own bot, without granting watched human authority', () => {
    const room = createMobileSupplySessionFixture(); const commander = room.join(0); room.join(3);
    commander.net.spectate(3); room.settle();
    room.place(0).kits = 0;
    const bot = room.place(1); bot.kits = 0; bot.weaponState.ammo = bot.weapon.magSize - 15;
    room.step(3);
    const model = room.model(commander);
    expect(model.recipients.map(row => row.slot)).toEqual([0, 1, 2, 4, 5]);
    expect(model.recipients.every(row => row.confirmed)).toBe(true);
    const own = model.recipients.find(row => row.slot === 0)!;
    expect(own.label).toContain('your bot');
    expect(own.caches[0]!.choices.find(row => row.item.kind === 'health-kit')!.detail).toBe('Take 1 kit charge');
    const recipient = model.recipients.find(row => row.slot === 1)!;
    expect(recipient.caches[0]!.choices.find(row => row.item.kind === 'primary-ammo')!.detail).toBe('Take 15 rounds');
    commander.net.selectCommanderSupply(0, 'P-SOUTH', { kind: 'health-kit' }); room.settle(); room.step(30);
    expect(commander.net.recipientSupplyInventory(0)!.kits).toBe(1);
    expect(commander.net.supplyCaches[0]!.stock.healthKits).toBe(1);
    room.dispose();
  });

  it('keeps class/fireteam reach and removes captured and downed recipients from authoritative snapshots', () => {
    const room = createMobileSupplySessionFixture(); const commander = room.join(3);
    commander.net.spectate(0); room.settle(); room.step(3);
    expect(room.session.commanderOf(1)).toBe(3); // Assigned authority still cannot cross the class/fireteam boundary.
    expect(room.model(commander).recipients.map(row => row.slot)).toEqual([3, 4, 5]);
    const bot = room.place(4); bot.kits = 0;
    commander.net.selectCommanderSupply(4, 'P-SOUTH', { kind: 'health-kit' }); room.settle(); room.step(9);
    expect(room.model(commander).recipients.find(row => row.slot === 4)!.caches[0]!.own!.percent).toBe(30);
    Object.assign(bot.health, { current: 0, downedAt: 1 }); room.step(3);
    expect(room.model(commander).recipients.map(row => row.slot)).toEqual([3, 5]);
    expect(commander.net.supplyProgress).toEqual([]);
    expect(room.session.captureCharacter(5, { x: 20, y: 0, z: 20 })).toBe(true); room.step(3);
    expect(room.model(commander).recipients.map(row => row.slot)).toEqual([3]);
    expect(commander.net.supplyCaches[0]!.stock.healthKits).toBe(2);
    room.dispose();
  });

  it('reflects finite shared contention and one partial transfer without local stock or recipient prediction', () => {
    const room = createMobileSupplySessionFixture(); const commander = room.join(0); const desktop = room.join(3);
    commander.net.spectate(3); room.settle();
    const bot = room.place(1, 1, -.5); bot.kits = 0;
    const human = room.place(3, 1, .5); human.kits = 0;
    room.step(3);
    commander.net.selectCommanderSupply(1, 'P-ROAD', { kind: 'health-kit' });
    desktop.net.selectSupply('P-ROAD', { kind: 'health-kit' }); desktop.holding = true; room.settle(); room.step(12);
    const choice = room.model(commander).recipients.find(row => row.slot === 1)!.caches[1]!;
    expect(choice.own!.percent).toBe(40); expect(choice.others[0]!.percent).toBe(40);
    expect(commander.net.recipientSupplyInventory(1)!.kits).toBe(0);
    expect(commander.net.supplyCaches[1]!.stock.healthKits).toBe(1);
    room.step(18); desktop.holding = false;
    expect(commander.net.recipientSupplyInventory(1)!.kits).toBe(1);
    expect(desktop.net.kits).toBe(0); expect(commander.net.supplyCaches[1]!.stock.healthKits).toBe(0);
    expect(commander.net.supplyCaches).toEqual(desktop.net.supplyCaches);
    room.place(1); bot.weaponState.ammo = bot.weapon.magSize - 15; room.step(3);
    commander.net.selectCommanderSupply(1, 'P-SOUTH', { kind: 'primary-ammo' }); room.settle(); room.step(30);
    expect(commander.net.recipientSupplyInventory(1)!.ammo).toBe(100);
    expect(commander.net.supplyCaches[0]!.stock.primaryAmmoUnits).toBe(14040);
    room.step(30); expect(commander.net.supplyCaches[0]!.stock.primaryAmmoUnits).toBe(14040);
    room.dispose();
  });

  it('clears host collection and confirmed inventory on reconnect, without replaying an earlier request', () => {
    const room = createMobileSupplySessionFixture(); const commander = room.join(0); room.join(3);
    commander.net.spectate(3); room.settle(); const bot = room.place(1); bot.kits = 0; room.step(3);
    commander.net.selectCommanderSupply(1, 'P-SOUTH', { kind: 'health-kit' }); room.settle(); room.step(12);
    expect(commander.net.supplyProgress[0]!.percent).toBe(40);
    room.reconnect(commander);
    expect(commander.net.supplyProgress).toEqual([]);
    expect(commander.net.recipientSupplyInventory(1)).toBeNull();
    commander.net.spectate(3); room.settle(); room.step(33);
    expect(commander.net.supplyProgress).toEqual([]); expect(bot.kits).toBe(0);
    expect(commander.net.supplyCaches[0]!.stock.healthKits).toBe(2);
    expect(room.requests(commander)).toHaveLength(1);
    room.dispose();
  });
});

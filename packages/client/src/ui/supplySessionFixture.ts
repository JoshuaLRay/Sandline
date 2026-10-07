import {
  createLoopbackPair, createMoveState, encodeMessage, parseEncounter, parseEventScript, requireWorld, SUPPLY_AMMO_UNITS_PER_MAGAZINE, TICK_SECONDS,
  type MissionDef,
} from '@sandline/shared';
import { Session } from '@sandline/server/session';
import { NetClient } from '../net/NetClient.ts';
import { SUPPLY_FIXTURES } from './supplyFixtures.ts';
import { supplyCapacity, supplyChoiceModel, supplyInventory } from './supplyModel.ts';

/** Real host, wire codec and browser network client; only the fixture's placement/input clock is controlled. */
export function createSupplySessionFixture() {
  const world = requireWorld('greybox-01');
  const encounter = parseEncounter({ world: world.id, aliveCap: 4, probes: [1], areas: {}, groups: [
    { id: 'unused', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'script' } },
  ] });
  const mission: MissionDef = { id: 'supply-presentation', world: world.id, respawn: false, objectives: [{ type: 'survive', label: 'Review supplies', seconds: 3600 }] };
  const script = parseEventScript({ world: world.id, blockers: [], events: [], supplyCaches: SUPPLY_FIXTURES.map(cache => ({
    ...cache, stock: { projectiles: cache.stock.projectiles, healthKits: cache.stock.healthKits, primaryMagazines: cache.stock.primaryAmmoUnits / SUPPLY_AMMO_UNITS_PER_MAGAZINE },
  })) }, encounter, world, mission);
  const session = new Session(undefined, '', world, { encounter, mission, events: script, loadouts: 'class' });
  const players: { net: NetClient; pair: ReturnType<typeof createLoopbackPair>; holding: boolean }[] = [];
  let now = 0; let tick = 0;
  const settle = () => players.forEach(player => player.pair.settle());
  const join = (slot: number) => {
    const pair = createLoopbackPair(); session.addConnection(pair.a, now);
    const net = new NetClient(pair.b, `Reviewer ${slot + 1}`);
    const player = { net, pair, holding: false }; players.push(player);
    net.join('', '', '', '', '', false, slot); settle(); return player;
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += TICK_SECONDS * 1000; tick++;
      for (const player of players) player.pair.b.send(encodeMessage({ kind: 'Input', tick, moveX: 0, moveY: 0,
        yaw: 0, pitch: 0, buttons: player.holding ? 8 : 0 }));
      settle(); session.step(now); settle();
    }
  };
  const place = (player: ReturnType<typeof join>, cacheIndex: number) => {
    const cache = SUPPLY_FIXTURES[cacheIndex]!;
    const soldier = session.slots[player.net.slot]!;
    soldier.state = createMoveState(cache.feet.x, cache.feet.y, cache.feet.z - 1);
    return soldier;
  };
  const model = (player: ReturnType<typeof join>, cacheIndex: number, readOnly = false) => supplyChoiceModel(
    player.net.supplyCaches.find(cache => cache.id === SUPPLY_FIXTURES[cacheIndex]!.id)!, supplyInventory(player.net),
    supplyCapacity(player.net), player.net.supplyProgress, player.net.slot, readOnly);
  return { session, join, step, settle, place, model };
}

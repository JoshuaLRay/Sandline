/**
 * AI fire through the authoritative path (T-3.15).
 *
 * An enemy whose brain names a target shoots it through the fire path a
 * human's `Fire` takes: the same weapon row, cadence, magazine and reload,
 * the same trace and `applyDamage`, the same `HitEvent` — with no rewind. A
 * loopback client in slot 0 listens for the events; it sends no input, so its
 * soldier stands still where it spawned (or where a test puts it).
 *
 * The aim arithmetic is unit-tested in `ai/aim.test.ts` with numbers of its
 * own. What these prove is the committed rifleman's shooting on the session.
 */
import { describe, expect, it } from 'vitest';
import {
  type Message,
  PROTOCOL_VERSION,
  buildTree,
  createHealth,
  createLoopbackPair,
  createMoveState,
  decodeMessage,
  encodeMessage,
  getEnemy,
  getWeapon,
  isAlive,
  isDowned,
  parseTreeDef,
} from '@sandline/shared';
import { type BrainTree, createBrainRegistry } from '../ai/Brain.ts';
import { aimPoints } from '../ai/aim.ts';
import { type EnemyEntity, Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const RIFLEMAN = getEnemy('rifleman');
const GUN = getWeapon(RIFLEMAN.weapon);
/** Wire yaw facing −Z, towards the spawn line. */
const FACING_SPAWN = 512;

type HitEvent = Extract<Message, { kind: 'HitEvent' }>;

/** A fixture tree: shoot whoever `want()` names, re-read on every think. */
function shootAt(want: () => number | null): BrainTree {
  const registry = createBrainRegistry().action('shoot', ({ blackboard }) => {
    blackboard.set('fireAt', want());
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'test-shoot', root: { type: 'action', name: 'shoot' } }), registry);
}

/** A client in slot 0 that collects every HitEvent. */
function listen(session: Session) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const hits: HitEvent[] = [];
  pair.b.onMessage((bytes) => {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return;
    }
    if (msg.kind === 'HitEvent') hits.push(msg);
    if (msg.kind === 'Delta') pair.b.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'target', room: '' }));
  pair.settle();
  return {
    hits,
    run(count: number, each?: () => void): void {
      for (let i = 0; i < count; i++) {
        session.step((session.tick + 1) * TICK_MS);
        pair.settle();
        each?.();
      }
    },
  };
}

function enemy(session: Session, id: number): EnemyEntity {
  return session.enemies.find((e) => e.netId === id)!;
}

/**
 * Slot 0 stood at `at`, and a rifleman `rangeM` north of it facing it, whose
 * brain wants to shoot it whenever `wanting()` says so (always by default).
 */
function range(rangeM: number, at = { x: 0, y: 0, z: 0 }, wanting: () => boolean = () => true) {
  const session = new Session(undefined, '', 'range');
  const client = listen(session);
  const target = session.slots[0]!;
  target.state = createMoveState(at.x, at.y, at.z);
  const netId = session.spawnEnemy('rifleman', {
    x: at.x,
    y: 0,
    z: at.z + rangeM,
    yaw: FACING_SPAWN,
    tree: shootAt(() => (wanting() ? target.netId : null)),
  }) as number;
  return { session, client, target, netId, shooter: () => enemy(session, netId) };
}

/** The angle, degrees, between where a shot went and the line to the target's chest. */
function errorDeg(hit: HitEvent, chest: { x: number; y: number; z: number }): number {
  const a = { x: hit.x - hit.originX, y: hit.y - hit.originY, z: hit.z - hit.originZ };
  const b = { x: chest.x - hit.originX, y: chest.y - hit.originY, z: chest.z - hit.originZ };
  const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
}

describe('AI fire through the authoritative path (T-3.15)', () => {
  it("an enemy's shot is a HitEvent with its netId, hurts a slot through applyDamage, and can down it", () => {
    const { client, target, netId } = range(10);
    let ticks = 0;
    while (isAlive(target.health) && ticks++ < 300) client.run(1);
    const onTarget = client.hits.filter((h) => h.shooterNetId === netId && h.targetNetId === target.netId);
    expect(onTarget.length).toBeGreaterThan(0);
    expect(onTarget.every((h) => h.damage > 0)).toBe(true);
    // Downed, not dead: a slot goes down through the one applyDamage (T-2.13).
    expect(isDowned(target.health)).toBe(true);
    // What the events say it dealt is what the slot lost.
    const dealt = onTarget.reduce((sum, h) => sum + h.damage, 0);
    // The wire carries whole points, so each event may round by up to a half.
    expect(Math.abs(target.health.max - target.health.current - dealt)).toBeLessThanOrEqual(onTarget.length / 2);
  });

  it("hits a still, standing soldier at the band's range inside the band the archetype's data describes", () => {
    const band = RIFLEMAN.accuracy.hitBand;
    const { client, target, netId, shooter } = range(band.rangeM);
    const shots = 300;
    // Healed after every tick: the target stays standing so every shot is at the same soldier.
    // 300 rounds with reloads take about 45 s; four minutes is a rail, not a budget.
    for (let t = 0; t < 30 * 240 && shooter().weaponState.shotIndex < shots; t++) {
      client.run(1, () => Object.assign(target.health, createHealth()));
    }
    const fired = client.hits.filter((h) => h.shooterNetId === netId);
    expect(fired.length).toBe(shots);
    const hit = fired.filter((h) => h.targetNetId === target.netId).length / shots;
    console.log(`rifleman at ${band.rangeM} m: ${(hit * 100).toFixed(1)}% of ${shots} shots hit (band ${band.min}..${band.max})`);
    expect(hit).toBeGreaterThanOrEqual(band.min);
    expect(hit).toBeLessThanOrEqual(band.max);
  });

  it('time on target narrows the spread', () => {
    // Acquire, fire for a moment, lose the target, acquire again — many times.
    // Early shots are those in the first tenth of the settle time; settled ones after it.
    let wanting = true;
    const { session, client, target, netId: id } = range(20, undefined, () => wanting);
    const chest = aimPoints(target.state, false, false)[0]!;
    const early: number[] = [];
    const settled: number[] = [];
    const cycle = Math.round((RIFLEMAN.accuracy.settleSeconds + 1) * 30);
    for (let t = 0; t < cycle * 40; t++) {
      const before = client.hits.length;
      wanting = t % cycle < cycle - 15;
      client.run(1, () => Object.assign(target.health, createHealth()));
      const aim = enemy(session, id).aim;
      for (const h of client.hits.slice(before)) {
        if (h.shooterNetId !== id || !aim) continue;
        const onTarget = session.tick * (TICK_MS / 1000) - aim.since;
        if (onTarget <= RIFLEMAN.accuracy.settleSeconds * 0.1) early.push(errorDeg(h, chest));
        else if (onTarget >= RIFLEMAN.accuracy.settleSeconds) settled.push(errorDeg(h, chest));
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(`time on target: mean error ${mean(early).toFixed(2)}° over ${early.length} early shots, ${mean(settled).toFixed(2)}° over ${settled.length} settled`);
    expect(early.length).toBeGreaterThan(30);
    expect(settled.length).toBeGreaterThan(30);
    expect(mean(early)).toBeGreaterThan(mean(settled) * 1.5);
  });

  it('reloads when empty, and cannot fire while reloading', () => {
    const { client, netId, shooter, target } = range(10);
    const firedAt: number[] = [];
    let reloadSeen = false;
    for (let i = 0; i < 30 * 8 && firedAt.length < GUN.magSize + 1; i++) {
      const before = client.hits.length;
      client.run(1, () => Object.assign(target.health, createHealth()));
      if (client.hits.slice(before).some((h) => h.shooterNetId === netId)) firedAt.push(i * TICK_MS);
      const ws = shooter().weaponState;
      if (ws.ammo === 0) {
        expect(ws.reloadEndsAt).toBeGreaterThan(0);
        reloadSeen = true;
      }
    }
    expect(reloadSeen).toBe(true);
    expect(firedAt.length).toBe(GUN.magSize + 1);
    // The last round of the magazine and the first of the next are a reload apart, at least.
    const gap = (firedAt[GUN.magSize]! - firedAt[GUN.magSize - 1]!) / 1000;
    expect(gap).toBeGreaterThanOrEqual(GUN.reloadSeconds);
    expect(shooter().weaponState.ammo).toBe(GUN.magSize - 1);
  });

  it('never fires through a wall, and fires once the target steps out from behind it', () => {
    // East wall A spans x 6..9 at z 4, 2.4 m tall; the gap to east wall B is x 9..11.
    const { client, target, netId, shooter } = range(10, { x: 7.5, y: 0, z: -1 });
    client.run(90);
    expect(client.hits.filter((h) => h.shooterNetId === netId)).toEqual([]);
    expect(shooter().weaponState.ammo).toBe(GUN.magSize);
    expect(shooter().aim).toBeNull();
    expect(target.health.current).toBe(target.health.max);

    // Into the gap, with the rifleman moved over to face down it.
    target.state = createMoveState(10, 0, -1);
    shooter().state = createMoveState(10, 0, 9);
    client.run(30);
    expect(client.hits.filter((h) => h.shooterNetId === netId).length).toBeGreaterThan(0);
  });
});

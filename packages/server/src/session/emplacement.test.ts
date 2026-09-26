/**
 * The mounted MG on the session (T-4.29): a real `Session` on a world of its
 * own — one gun facing north behind a sandbag — with humans over loopback.
 * A press of E within reach mounts and a second dismounts; the gunner is
 * held crouched at the gunner's place, looking within the arc; a mounted
 * Fire is the gun's weapon from the gun's muzzle through the one fire path,
 * warming it until it overheats and cools; the sandbag covers the body and
 * leaves the head; an enemy MG takes an empty gun it can bear with, fires
 * through the same path, and leaves it when its target stays outside the
 * arc; a downed gunner, a departed one and a restart all free the gun.
 */
import { describe, expect, it } from 'vitest';
import {
  type Message,
  PROTOCOL_VERSION,
  applyDamage,
  buildTree,
  createHealth,
  createLoopbackPair,
  createMoveState,
  decodeMessage,
  degToWire,
  encodeMessage,
  eyePosition,
  getEmplacement,
  getWeapon,
  isDowned,
  loadWorld,
  parseTreeDef,
  tableToWire,
} from '@sandline/shared';
import { type BrainTree, createBrainRegistry } from '../ai/Brain.ts';
import { aimAngles, aimPoints } from '../ai/aim.ts';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const NEST = getEmplacement('mg-nest');
const LMG = getWeapon('lmg');
const INTERACT = 0b1000;

type HitEvent = Extract<Message, { kind: 'HitEvent' }>;

/** Every loopback link made, so a step's messages can be delivered to everyone. */
const links: (() => void)[] = [];
const settleAll = () => links.forEach((settle) => settle());

/** One gun at the origin's north, facing north (+Z), a 0.9 m sandbag a little in front of it. */
function nestWorld() {
  return loadWorld({
    id: 'nest',
    floor: { halfExtent: 60 },
    cover: [{ id: 'sandbags', x: 0, y: 0, z: 11.4, w: 1.6, h: 0.9, d: 0.4 }],
    emplacements: [{ id: 'g', kind: 'mg-nest', x: 0, y: 0, z: 10, yawDeg: 0 }],
  });
}

/** A fixture tree: shoot whoever `want()` names, re-read on every think. */
function shootAt(want: () => number | null): BrainTree {
  const registry = createBrainRegistry().action('shoot', ({ blackboard }) => {
    blackboard.set('fireAt', want());
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'test-shoot', root: { type: 'action', name: 'shoot' } }), registry);
}

/** A tree that wants nothing: a target that stands there. */
function idle(): BrainTree {
  const registry = createBrainRegistry().action('stand', () => 'running');
  return buildTree(parseTreeDef({ id: 'test-stand', root: { type: 'action', name: 'stand' } }), registry);
}

/** A human over loopback: joins, collects HitEvents, and sends inputs and shots on the tick. */
function human(session: Session, name: string) {
  const pair = createLoopbackPair();
  links.push(() => pair.settle());
  session.addConnection(pair.a, 0);
  const hits: HitEvent[] = [];
  let slot = -1;
  let netId = 0;
  pair.b.onMessage((bytes) => {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return;
    }
    if (msg.kind === 'JoinAck') {
      slot = msg.slot;
      netId = msg.netId;
    }
    if (msg.kind === 'HitEvent') hits.push(msg);
    if (msg.kind === 'Delta') pair.b.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name, room: '' }));
  pair.settle();
  let yaw = 0;
  let pitch = 0;
  return {
    hits,
    get slot() {
      return slot;
    },
    get netId() {
      return netId;
    },
    get body() {
      return session.slots[slot]!;
    },
    look(newYaw: number, newPitch = 0) {
      yaw = newYaw;
      pitch = newPitch;
    },
    /** One tick: an Input with these buttons and sticks, then the step. */
    tick(buttons = 0, moveY = 0) {
      const tick = session.tick + 1;
      pair.b.send(encodeMessage({ kind: 'Input', tick, moveX: 0, moveY, yaw, pitch, buttons }));
      pair.settle();
      session.step(tick * TICK_MS);
      pair.settle();
    },
    /** A trigger pull at table-unit angles, sent before this tick's step. */
    fire(aimYaw: number, aimPitch: number) {
      const tick = session.tick + 1;
      pair.b.send(encodeMessage({ kind: 'Fire', tick, yaw: aimYaw & 0xfff, pitch: aimPitch & 0xfff, renderTimeMs: Math.round(tick * TICK_MS), weapon: 0, ads: true }));
      pair.settle();
      session.step(tick * TICK_MS);
      pair.settle();
    },
    leave() {
      pair.b.close('left');
      pair.settle();
    },
  };
}

function run(session: Session, ticks: number, each?: () => void): void {
  for (let i = 0; i < ticks; i += 1) {
    session.step((session.tick + 1) * TICK_MS);
    settleAll();
    each?.();
  }
}

/** Slot 0 stood a step behind the gunner's place, and on the gun after a press. */
function mounted() {
  const session = new Session(undefined, '', nestWorld());
  const gun = session.emplacements[0]!;
  const a = human(session, 'a');
  a.body.state = createMoveState(gun.place.x + 0.5, 0, gun.place.z - 0.3);
  a.tick(INTERACT);
  a.tick(INTERACT);
  expect(session.mountOf(a.slot)).toBe(gun);
  return { session, gun, a };
}

const table = (deg: number) => degToWire(deg) << 2;

describe('the mounted MG on the session (T-4.29)', () => {
  it('a press of E within reach mounts, a hold does not re-press, a second press dismounts, and a press from afar does nothing', () => {
    const session = new Session(undefined, '', nestWorld());
    const gun = session.emplacements[0]!;
    expect(gun.place).toEqual({ x: 0, y: 0, z: 10 - NEST.gunnerBackM });
    const a = human(session, 'a');
    // Five metres off: not in reach.
    a.body.state = createMoveState(0, 0, gun.place.z - 5);
    a.tick(INTERACT);
    a.tick(INTERACT);
    expect(session.mountOf(a.slot)).toBeNull();
    // Within `mountRangeM`: on the gun, at its gunner's place, crouched, and the gun says who.
    a.tick(0);
    a.body.state = createMoveState(0.5, 0, gun.place.z - 0.3);
    a.tick(INTERACT);
    expect(session.mountOf(a.slot)).toBe(gun);
    expect(gun.gunnerNetId).toBe(a.netId);
    a.tick(INTERACT);
    expect(a.body.state.x).toBeCloseTo(gun.place.x, 6);
    expect(a.body.state.z).toBeCloseTo(gun.place.z, 6);
    expect(a.body.state.crouched).toBe(true);
    // Held for a second: still on it. Released and pressed again: off it, where they stood.
    for (let i = 0; i < 30; i += 1) a.tick(INTERACT);
    expect(session.mountOf(a.slot)).toBe(gun);
    a.tick(0);
    a.tick(INTERACT);
    expect(session.mountOf(a.slot)).toBeNull();
    expect(gun.gunnerNetId).toBe(0);
    expect(a.body.state.x).toBeCloseTo(gun.place.x, 6);
  });

  it('a gunner moves nothing, and the gun goes where they look as far as the arc and the elevation allow', () => {
    const { session, gun, a } = mounted();
    a.look(degToWire(20), degToWire(5));
    for (let i = 0; i < 10; i += 1) a.tick(0, 1);
    expect(a.body.state.z).toBeCloseTo(gun.place.z, 6);
    expect(gun.yaw).toBe(degToWire(20));
    expect(gun.pitch).toBe(degToWire(5));
    // Past the traverse: laid on the stop. Past the elevation: held at the limit.
    a.look(degToWire(90), degToWire(45));
    a.tick(0);
    expect(gun.yaw).toBe(degToWire(60));
    expect(a.body.yaw).toBe(degToWire(60));
    expect(gun.pitch).toBe(degToWire(20));
    // The other way round the wrap, written the wire's way.
    a.look(1024 - degToWire(100), 1024 - degToWire(30));
    a.tick(0);
    expect(gun.yaw).toBe(1024 - degToWire(60));
    expect(gun.pitch & 0x3ff).toBe((1024 - degToWire(10)) & 0x3ff);
    void session;
  });

  it("a mounted Fire is the gun's weapon from the gun's muzzle, held within the arc, and warms the gun", () => {
    const { session, gun, a } = mounted();
    const targetId = session.spawnEnemy('rifleman', { x: 0, y: 0, z: 25, yaw: 512, tree: idle() }) as number;
    const target = session.enemies.find((e) => e.netId === targetId)!;
    // A tick, so the new soldier is in the hitbox history a shot resolves against.
    run(session, 1);
    const chest = aimPoints(target.state, false, false)[0]!;
    const line = aimAngles(gun.muzzle, chest);
    const before = a.hits.length;
    for (let i = 0; i < 5; i += 1) {
      a.fire(line.yaw, line.pitch);
      run(session, 2);
    }
    const shots = a.hits.slice(before).filter((h) => h.shooterNetId === a.netId);
    expect(shots.length).toBe(5);
    // Every round from the gun's muzzle (as the wire carries it), and the LMG's aimed cone puts them on a man at fifteen metres.
    for (const shot of shots) {
      expect(Math.abs(shot.originX - gun.muzzle.x)).toBeLessThan(0.01);
      expect(Math.abs(shot.originY - gun.muzzle.y)).toBeLessThan(0.01);
      expect(Math.abs(shot.originZ - gun.muzzle.z)).toBeLessThan(0.01);
    }
    const onTarget = shots.filter((h) => h.targetNetId === targetId);
    expect(onTarget.length).toBeGreaterThan(0);
    expect(onTarget.every((h) => h.damage > 0)).toBe(true);
    // The gun's belt, not the carbine the message named; and the gun is warmer.
    expect(gun.weaponState.ammo).toBe(LMG.magSize - 5);
    expect(a.body.weaponState.ammo).toBe(a.body.weapon.magSize);
    expect(gun.heat.heat).toBeGreaterThan(0);
    expect(gun.heat.heat).toBeLessThanOrEqual(5 * NEST.heat.perShot);
    // Aimed ninety degrees off: the round leaves along the sixty-degree stop.
    const n = a.hits.length;
    a.fire(table(90), 0);
    const off = a.hits.slice(n).find((h) => h.shooterNetId === a.netId)!;
    const bearing = (Math.atan2(off.x - off.originX, off.z - off.originZ) * 180) / Math.PI;
    expect(Math.abs(bearing - 60)).toBeLessThan(2);
  });

  it('a belt fired without pause overheats the gun, which fires again once it has cooled below the threshold', () => {
    const { session, gun, a } = mounted();
    const fired = () => a.hits.filter((h) => h.shooterNetId === a.netId).length;
    for (let i = 0; i < 240; i += 1) a.fire(0, 0);
    expect(gun.heat.overheated).toBe(true);
    const atOverheat = fired();
    expect(atOverheat).toBeGreaterThan(40);
    expect(atOverheat).toBeLessThan(LMG.magSize);
    // Still hot: nothing leaves. Cooled below the threshold: it fires.
    a.fire(0, 0);
    expect(fired()).toBe(atOverheat);
    while (gun.heat.overheated) run(session, 1);
    expect(gun.heat.heat).toBeLessThan(NEST.heat.fireBelow);
    a.fire(0, 0);
    expect(fired()).toBe(atOverheat + 1);
  });

  it("the sandbag covers the gunner's body and leaves the head exposed", () => {
    const { session, a } = mounted();
    const b = human(session, 'b');
    b.body.state = createMoveState(0, 0, 20);
    b.look(512);
    b.tick(0);
    a.tick(0);
    const points = aimPoints(a.body.state, true, false);
    const head = points[1]!;
    const eye = eyePosition(b.body.state.x, b.body.state.y, b.body.state.z);
    const atHead = aimAngles(eye, head);
    // Aimed rounds, each with the carbine's own small cone: over the bag, into the head.
    let n = b.hits.length;
    for (let i = 0; i < 6; i += 1) {
      b.fire(atHead.yaw, atHead.pitch);
      run(session, 2);
    }
    const headShots = b.hits.slice(n).filter((h) => h.shooterNetId === b.netId);
    expect(headShots.length).toBe(6);
    expect(headShots.filter((h) => h.targetNetId === a.netId).length).toBeGreaterThan(0);
    // At the chest: every round stops in the bag.
    n = b.hits.length;
    const atBody = aimAngles(eye, { x: head.x, y: 0.6, z: head.z });
    for (let i = 0; i < 6; i += 1) {
      b.fire(atBody.yaw, atBody.pitch);
      run(session, 2);
    }
    const bodyShots = b.hits.slice(n).filter((h) => h.shooterNetId === b.netId);
    expect(bodyShots.length).toBe(6);
    expect(bodyShots.every((h) => h.targetNetId === 0 && h.z > 11)).toBe(true);
  });

  it('an MG that fights within reach of an empty gun takes it, fires from its muzzle, and leaves it when its target stays outside the arc', () => {
    const session = new Session(undefined, '', nestWorld());
    const gun = session.emplacements[0]!;
    const a = human(session, 'a');
    a.body.state = createMoveState(0, 0, 30);
    const mgId = session.spawnEnemy('mg', { x: 2.5, y: 0, z: 9, yaw: 0, tree: shootAt(() => a.netId) }) as number;
    const mg = session.enemies.find((e) => e.netId === mgId)!;
    const heal = () => Object.assign(a.body.health, createHealth());
    run(session, 2, heal);
    expect(gun.gunnerNetId).toBe(mgId);
    expect(mg.mounted).toBe(gun);
    expect(mg.state.x).toBeCloseTo(gun.place.x, 6);
    run(session, 90, heal);
    const rounds = a.hits.filter((h) => h.shooterNetId === mgId);
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds.every((h) => Math.abs(h.originY - gun.muzzle.y) < 0.01 && Math.abs(h.originZ - gun.muzzle.z) < 0.01)).toBe(true);
    expect(gun.weaponState.ammo).toBeLessThan(LMG.magSize);
    expect(gun.heat.heat).toBeGreaterThan(0);
    // The target walks round behind the gun: the gun cannot bear, and after the data's seconds the gunner leaves it.
    a.body.state = createMoveState(0, 0, -10);
    const leaveTicks = Math.ceil(NEST.ai.leaveAfterSeconds * 30);
    run(session, leaveTicks - 5, heal);
    expect(mg.mounted).toBe(gun);
    run(session, 10, heal);
    expect(mg.mounted).toBeNull();
    expect(gun.gunnerNetId).toBe(0);
    // And does not take it back while the target is still behind it.
    run(session, 10, heal);
    expect(gun.gunnerNetId).toBe(0);
  });

  it('a downed gunner, a departed one and a restart each free the gun', () => {
    const { session, gun, a } = mounted();
    applyDamage(a.body.health, 500, session.tick / 30);
    expect(isDowned(a.body.health)).toBe(true);
    run(session, 1);
    expect(session.mountOf(a.slot)).toBeNull();
    expect(gun.gunnerNetId).toBe(0);
    // Back on it after a heal, then gone from the seat: the bot does not use the gun.
    Object.assign(a.body.health, createHealth());
    a.body.state = createMoveState(gun.place.x, 0, gun.place.z);
    a.tick(0);
    a.tick(INTERACT);
    expect(gun.gunnerNetId).toBe(a.netId);
    a.leave();
    expect(gun.gunnerNetId).toBe(0);
    expect(a.body.mounted).toBeNull();
    // A restart: free, cold, belted, laid on its facing.
    gun.heat.heat = 0.9;
    gun.weaponState.ammo = 3;
    gun.yaw = degToWire(40);
    session.restartMission();
    expect(gun.heat).toEqual({ heat: 0, overheated: false });
    expect(gun.weaponState.ammo).toBe(LMG.magSize);
    expect(gun.yaw).toBe(tableToWire(0));
  });
});

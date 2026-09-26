/**
 * U-002 (B-09): shots and throws leave from the eye of the stance the body is
 * in — standing, crouched or prone — on a real `Session` over loopback, the
 * path the host's rooms and the in-page session share.
 *
 * The world is a flat floor with one wall 1.3 m high, 2 m in front of the
 * first slot: taller than a crouched eye, lower than a standing one. Crouched
 * behind it the body is hidden to the head and — the point of B-09 — so is
 * the muzzle: a crouched soldier must not shoot (or throw) over cover from a
 * standing eye it does not have.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MUZZLE_RIG,
  INPUT_BUTTONS,
  type Message,
  PROTOCOL_VERSION,
  PROJECTILE_IDS,
  SPAWN_POINTS,
  buildTree,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
  loadWorld,
} from '@sandline/shared';
import { createBrainRegistry } from '../ai/Brain.ts';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const SPAWN = SPAWN_POINTS[0]!;
const WALL_H = 1.3;
const WALL_Z = SPAWN.z + 2;
const WORLD = loadWorld({
  id: 'stance-origin-test',
  floor: { halfExtent: 60 },
  cover: [{ id: 'chest-wall', x: SPAWN.x, y: 0, z: WALL_Z, w: 4, h: WALL_H, d: 0.3 }],
});
/** An enemy standing well beyond the wall, straight ahead (+z is yaw 0). */
const TARGET = { x: SPAWN.x, y: 0, z: SPAWN.z + 14 };
const FRAG = PROJECTILE_IDS.indexOf('frag');

type Stance = 'standing' | 'crouched' | 'prone';
const BUTTONS: Record<Stance, number> = { standing: 0, crouched: INPUT_BUTTONS.crouch, prone: INPUT_BUTTONS.prone };
const EYE: Record<Stance, number> = {
  standing: DEFAULT_MUZZLE_RIG.eyeHeight,
  crouched: DEFAULT_MUZZLE_RIG.crouchEyeHeight,
  prone: DEFAULT_MUZZLE_RIG.proneEyeHeight,
};

/** A seated client in slot 0, holding `stance`, facing +z. */
function seated(stance: Stance) {
  const session = new Session(undefined, '', WORLD);
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const hits: Extract<Message, { kind: 'HitEvent' }>[] = [];
  pair.b.onMessage((bytes) => {
    const msg = decodeMessage(bytes);
    if (msg.kind === 'HitEvent') hits.push(msg);
  });
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'tester', room: '' }));
  pair.settle();
  let now = 0;
  const step = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      now += TICK_MS;
      pair.b.send(encodeMessage({ kind: 'Input', tick: Math.round(now / TICK_MS), moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: BUTTONS[stance] }));
      pair.settle();
      session.step(now);
      pair.settle();
    }
  };
  // Long enough to settle into the stance and fill the rewind history with it.
  step(45);
  const target = session.spawnEnemy('rifleman', { ...TARGET, tree: buildTree('idle', createBrainRegistry()) })!;
  step(2);
  const me = session.slots[0]!.state;
  return {
    session,
    hits,
    me,
    target,
    /** Yaw/pitch (table units, 1/4096 turn) from this stance's eye to a point. */
    aimAt(p: { x: number; y: number; z: number }) {
      const dx = p.x - me.x;
      const dy = p.y - (me.y + EYE[stance]);
      const dz = p.z - me.z;
      const turn = 4096;
      const yaw = Math.round((Math.atan2(dx, dz) / (2 * Math.PI)) * turn);
      const pitch = Math.round((Math.atan2(dy, Math.hypot(dx, dz)) / (2 * Math.PI)) * turn);
      return { yaw: ((yaw % turn) + turn) % turn, pitch: ((pitch % turn) + turn) % turn };
    },
    fire(aim: { yaw: number; pitch: number }, ads: boolean) {
      pair.b.send(encodeMessage({ kind: 'Fire', tick: Math.round(now / TICK_MS), ...aim, renderTimeMs: now, weapon: 0, ads }));
      pair.settle();
      return hits.at(-1);
    },
    throwFrag(aim: { yaw: number; pitch: number }) {
      pair.b.send(encodeMessage({ kind: 'Throw', tick: Math.round(now / TICK_MS), ...aim, projectile: FRAG }));
      pair.settle();
      return session.projectilesNow().at(-1);
    },
  };
}

describe('every stance fires and throws from its own eye (U-002, B-09)', () => {
  for (const stance of ['standing', 'crouched', 'prone'] as const) {
    it(`${stance}: the shot's origin on the wire and a throw's launch are the ${stance} eye`, () => {
      const s = seated(stance);
      const hit = s.fire({ yaw: 0, pitch: 0 }, true);
      expect(hit, 'the shot is resolved').toBeDefined();
      console.log(`[U-002] ${stance}: shot origin ${(hit!.originY - s.me.y).toFixed(2)} m above the feet (rig ${EYE[stance]} m)`);
      expect(hit!.originY - s.me.y).toBeCloseTo(EYE[stance], 1);
      const frag = s.throwFrag({ yaw: 0, pitch: 0 });
      expect(frag, 'the throw left the hand').toBeDefined();
      expect(frag!.y - s.me.y).toBeCloseTo(EYE[stance], 1);
    });
  }

  it('crouched behind a wall above the crouched eye: the round meets the wall, and the same aim standing clears it', () => {
    const crouched = seated('crouched');
    const chest = { ...TARGET, y: 1.2 };
    const blocked = crouched.fire(crouched.aimAt(chest), true)!;
    console.log(`[U-002] crouched behind ${WALL_H} m: stopped at z ${(blocked.z - SPAWN.z).toFixed(2)} m (wall at 2 m), target ${blocked.targetNetId}`);
    expect(blocked.targetNetId).not.toBe(crouched.target);
    expect(blocked.z).toBeLessThan(WALL_Z + 0.2);

    const standing = seated('standing');
    const clear = standing.fire(standing.aimAt(chest), true)!;
    expect(clear.targetNetId).toBe(standing.target);
  });

  it('crouched behind the wall, a throw leaves below its top and does not sail over it at a flat aim', () => {
    const s = seated('crouched');
    const frag = s.throwFrag({ yaw: 0, pitch: 0 })!;
    expect(frag.y).toBeLessThan(s.me.y + WALL_H);
  });

  it('aiming down the sights or from the hip does not move the origin', () => {
    for (const stance of ['standing', 'crouched', 'prone'] as const) {
      const s = seated(stance);
      const ads = s.fire({ yaw: 0, pitch: 0 }, true)!;
      const hip = s.fire({ yaw: 0, pitch: 0 }, false)!;
      expect([hip.originX, hip.originY, hip.originZ]).toEqual([ads.originX, ads.originY, ads.originZ]);
    }
  });
});

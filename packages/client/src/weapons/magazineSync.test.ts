/**
 * U-028: a manual reload is the host's, and the page's magazine follows the
 * host's.
 *
 * Unit: `CombatQA.reconcileMagazine` holds our shots against a lagging host
 * count without counting them twice, lets a refused one lapse, keeps our
 * finished reload standing until the host's lands, and never shows more
 * rounds than the host has. Headless end to end on a real `Session`, a real
 * `NetClient` over loopback and the page's `CombatQA`: a reload with rounds
 * left refills the host's magazine on the host's clock, a watcher sees it,
 * a shot during it is refused by both, a switch cancels it, and the
 * refusals hold.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { TICK_SECONDS, WEAPON_IDS, createLoopbackPair, encodeMessage, getWeapon, type Message } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { Session } from '@sandline/server/session';
import * as THREE from 'three';
import { NetClient } from '../net/NetClient.ts';
import { CombatQA, MAGAZINE_HOLD_SECONDS, WEAPON_ORDER } from './CombatQA.ts';

const CARBINE = WEAPON_ORDER.indexOf('carbine');
const MAG = getWeapon('carbine').magSize;
const RELOAD = getWeapon('carbine').reloadSeconds;

const ctx = (firing: boolean, triggerEdge = firing) => ({ origin: new THREE.Vector3(), yaw: 0, pitch: 0, firing, triggerEdge, ads: false });

describe('the page follows the host\'s magazine (U-028)', () => {
  it('a shot of ours stays spent against a lagging host count, and is not counted twice once taken', () => {
    const c = new CombatQA(new THREE.Scene());
    c.reconcileMagazine({ weapon: CARBINE, ammo: MAG }, 0);
    expect(c.tick(1, TICK_SECONDS, ctx(true))).not.toBeNull();
    expect(c.magazine(TICK_SECONDS).ammo).toBe(MAG - 1);
    c.reconcileMagazine({ weapon: CARBINE, ammo: MAG }, 2 * TICK_SECONDS);
    expect(c.magazine(0).ammo).toBe(MAG - 1);
    expect(c.pendingShotCount).toBe(1);
    c.reconcileMagazine({ weapon: CARBINE, ammo: MAG - 1 }, 3 * TICK_SECONDS);
    expect(c.magazine(0).ammo).toBe(MAG - 1);
    expect(c.pendingShotCount).toBe(0);
  });

  it('a shot the host refused lapses; the page never shows more rounds than the host has', () => {
    const c = new CombatQA(new THREE.Scene());
    c.reconcileMagazine({ weapon: CARBINE, ammo: 12 }, 0);
    expect(c.magazine(0).ammo).toBe(12);
    c.tick(1, 1, ctx(true));
    c.reconcileMagazine({ weapon: CARBINE, ammo: 12 }, 1 + MAGAZINE_HOLD_SECONDS + 0.01);
    expect(c.magazine(0).ammo).toBe(12);
    // A page that thinks it has more than the host is brought down to the host's.
    c.reconcileMagazine({ weapon: CARBINE, ammo: 7 }, 5);
    expect(c.magazine(5).ammo).toBe(7);
  });

  it('our reload stands while it runs and until the host\'s lands, then the host\'s count is the count', () => {
    const c = new CombatQA(new THREE.Scene());
    c.reconcileMagazine({ weapon: CARBINE, ammo: 10 }, 0);
    c.requestReload(0);
    // Mid-reload the host's old count does not touch ours.
    c.reconcileMagazine({ weapon: CARBINE, ammo: 10 }, RELOAD / 2);
    expect(c.magazine(RELOAD / 2).reloading).toBe(true);
    // Ours finishes; the host's, begun a moment later, has not yet.
    c.tick(Math.ceil(RELOAD / TICK_SECONDS), RELOAD + 0.01, ctx(false));
    expect(c.magazine(RELOAD + 0.01).ammo).toBe(MAG);
    c.reconcileMagazine({ weapon: CARBINE, ammo: 10 }, RELOAD + 0.05);
    expect(c.magazine(0).ammo).toBe(MAG);
    // The host's lands.
    c.reconcileMagazine({ weapon: CARBINE, ammo: MAG }, RELOAD + 0.1);
    expect(c.magazine(0).ammo).toBe(MAG);
    // A host that never reloaded (the Reload lost to a refusal): after the hold, its count stands.
    const d = new CombatQA(new THREE.Scene());
    d.reconcileMagazine({ weapon: CARBINE, ammo: 10 }, 0);
    d.requestReload(0);
    d.tick(Math.ceil(RELOAD / TICK_SECONDS), RELOAD + 0.01, ctx(false));
    d.reconcileMagazine({ weapon: CARBINE, ammo: 10 }, RELOAD + MAGAZINE_HOLD_SECONDS + 0.1);
    expect(d.magazine(0).ammo).toBe(10);
  });

  it('while the host is on another gun (a switch in flight) the page\'s magazine is left alone', () => {
    const c = new CombatQA(new THREE.Scene());
    c.reconcileMagazine({ weapon: WEAPON_ORDER.indexOf('sidearm'), ammo: 3 }, 0);
    expect(c.magazine(0).ammo).toBe(MAG);
  });
});

describe('a manual reload over a hosted room, end to end (U-028)', () => {
  beforeAll(() => initNav());

  function room() {
    const session = new Session();
    let now = 0;
    const clients: { net: NetClient; pair: ReturnType<typeof createLoopbackPair> }[] = [];
    const settle = () => clients.forEach((c) => c.pair.settle());
    const join = (name: string) => {
      const pair = createLoopbackPair();
      session.addConnection(pair.a, now);
      const net = new NetClient(pair.b, name);
      clients.push({ net, pair });
      net.join();
      settle();
      return net;
    };
    const send = (net: NetClient, msg: Message) => {
      clients.find((c) => c.net === net)!.pair.b.send(encodeMessage(msg));
      settle();
    };
    const step = (ticks = 1) => {
      for (let i = 0; i < ticks; i++) {
        now += TICK_SECONDS * 1000;
        clients.forEach((c) => c.pair.b.send(encodeMessage({ kind: 'Ping', id: 1, clientTime: 0 })));
        settle();
        session.step(now);
        settle();
      }
    };
    return { session, join, send, step, get tick() { return session.tick; } };
  }

  it('a reload with rounds left refills the host\'s magazine on its clock; the page follows and a watcher sees it', () => {
    const r = room();
    const me = r.join('me');
    const watcher = r.join('watcher');
    r.step(3);
    const slot = r.session.slots[me.slot]!;
    // Ten rounds out, on the host.
    for (let i = 0; i < 10; i++) {
      me.fire(r.tick, 0, 0, CARBINE, false);
      r.step(Math.ceil(60 / getWeapon('carbine').rpm / TICK_SECONDS) + 1);
    }
    expect(slot.weaponState.ammo).toBe(MAG - 10);
    expect(me.magazine).toEqual({ weapon: CARBINE, ammo: MAG - 10 });
    // Before U-028 this reached nobody: the host's magazine stayed at 20.
    me.reload();
    r.step(1);
    expect(r.session.slots[me.slot]!.weaponState.reloadEndsAt).toBeGreaterThan(0);
    // The watcher sees the body reload: its replicated progress rises.
    r.step(Math.round(RELOAD / 2 / TICK_SECONDS));
    expect(watcher.remoteWeapon(slot.netId).reloadProgress).toBeGreaterThan(0.3);
    // A shot mid-reload: the host refuses it, the magazine is not spent.
    me.fire(r.tick, 0, 0, CARBINE, false);
    r.step(1);
    expect(slot.weaponState.ammo).toBe(MAG - 10);
    // On the host's clock, full — without firing again to settle it.
    r.step(Math.round(RELOAD / 2 / TICK_SECONDS) + 3);
    expect(slot.weaponState.ammo).toBe(MAG);
    expect(me.magazine).toEqual({ weapon: CARBINE, ammo: MAG });
    expect(watcher.remoteWeapon(slot.netId).reloadProgress).toBe(0);
  });

  it('a reload requested mid-burst: the held trigger\'s shots stop with it on both sides, and the page shows the host\'s count', () => {
    const r = room();
    const me = r.join('me');
    r.step(3);
    const slot = r.session.slots[me.slot]!;
    const page = new CombatQA(new THREE.Scene());
    const tick = () => r.tick * TICK_SECONDS;
    page.reconcileMagazine(me.magazine!, tick());
    // A held trigger: the page fires on its own cadence, and each round it spends goes to the host.
    const burst = (ticks: number, reload = -1) => {
      for (let i = 0; i < ticks; i++) {
        if (i === reload) {
          page.requestReload(tick());
          me.reload();
        }
        page.reconcileMagazine(me.magazine!, tick());
        if (page.tick(r.tick, tick(), ctx(true, i === 0)) !== null) me.fire(r.tick, 0, 0, CARBINE, false);
        r.step(1);
      }
    };
    burst(Math.round(RELOAD / TICK_SECONDS), 12);
    const fired = page.shotsFired;
    expect(fired).toBeGreaterThan(2);
    // The host took exactly the page's shots — none drawn after the reload began.
    expect(slot.weaponState.reloadEndsAt).toBeGreaterThan(0);
    expect(slot.weaponState.ammo).toBe(MAG - fired);
    expect(page.magazine(tick()).reloading).toBe(true);
    // Both finish; the page shows the host's full magazine and fires from it.
    burst(Math.round(RELOAD / TICK_SECONDS));
    expect(slot.weaponState.reloadEndsAt).toBe(0);
    page.reconcileMagazine(me.magazine!, tick());
    expect(page.magazine(tick()).ammo).toBe(slot.weaponState.ammo);
    expect(page.shotsFired - fired).toBe(MAG - slot.weaponState.ammo);
  });

  it('a switch mid-reload ends it; a reload is refused down, with a grenade in hand, or on a full magazine', () => {
    const r = room();
    const me = r.join('me');
    r.step(3);
    const slot = r.session.slots[me.slot]!;
    // Full: nothing to do.
    me.reload();
    r.step(1);
    expect(slot.weaponState.reloadEndsAt).toBe(0);
    slot.weaponState.ammo = 5;
    // A grenade in hand: refused.
    r.send(me, { kind: 'Equip', item: WEAPON_IDS.length });
    me.reload();
    r.step(1);
    expect(slot.weaponState.reloadEndsAt).toBe(0);
    // Down: refused.
    r.send(me, { kind: 'Equip', item: CARBINE });
    slot.health.downedAt = r.tick * TICK_SECONDS;
    me.reload();
    r.step(1);
    expect(slot.weaponState.reloadEndsAt).toBe(0);
    slot.health.downedAt = null;
    // Up, a gun in hand, rounds missing: it runs — and a switch to the sidearm ends it with the carbine.
    me.reload();
    r.step(1);
    expect(slot.weaponState.reloadEndsAt).toBeGreaterThan(0);
    r.send(me, { kind: 'Equip', item: WEAPON_IDS.indexOf('sidearm') });
    r.step(1);
    expect(slot.weapon.id).toBe('sidearm');
    expect(slot.weaponState.reloadEndsAt).toBe(0);
  });
});

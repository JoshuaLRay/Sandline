/** U-226 test harness only. No registry entry or production map revision. */
import {
  ClientConnection, PROTOCOL_VERSION, TICK_SECONDS, buildTree, createLoopbackPair, decodeMessage,
  parseCampaign, parseEncounter, parseMission, type Message, type MissionDef,
} from '@sandline/shared';
import { createBrainRegistry } from '../../../server/src/ai/Brain.ts';
import type { NavMesh } from '../../../server/src/ai/nav/NavMesh.ts';
import { newCampaignState, type CampaignState } from '../../../server/src/persistence/CampaignDatabase.ts';
import { Session } from '../../../server/src/session/Session.ts';
import type { SlotCheckpoint } from '../../../server/src/session/checkpointWorld.ts';
import { buildOutpostCaptiveFixture } from './qalatOutpostCaptives.ts';

export const fixture = buildOutpostCaptiveFixture();
export const at = (x: number, z: number) => ({ x, y: 8, z });
// Keep every solid/elevation in the tested court/cell/return corridor plus a
// four-metre margin. Nav is baked from the COMPLETE, unchanged construction.
export const world = { ...fixture.world, mapRevision: 2,
  boxes: fixture.world.boxes.filter((b) => b.maxX >= -4 && b.minX <= 64 && b.maxZ >= 342 && b.minZ <= 416),
  squadStarts: [at(16, 392), at(35, 374), at(37, 374), at(35, 376), at(37, 376), at(35, 378)],
};
export const encounter = parseEncounter({ world: world.id, aliveCap: 1, probes: [.3, 1, 1.7], areas: {},
  groups: [{ id: 'original-pow', members: [{ archetype: 'pow', count: 1 }], captive: true,
    zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'start' },
    sockets: [{ id: 'pow', archetype: 'pow', feet: fixture.pow.feet, face: { x: 16, z: 400 } }] }],
}, () => world);
export function rescueMission(slots: number[]) {
  return parseMission({ ...fixture.mission, objectives: [
    { type: 'rescue', label: 'Original POW', group: 'original-pow', holdSeconds: 1, reachM: 2 },
    ...slots.map((slot) => ({ type: 'rescue', label: `Squad ${slot}`, slot, holdSeconds: 1, reachM: 2 })),
    { type: 'survive', label: 'Fixture sentinel (not full mission)', seconds: 3600 },
  ] });
}
export const heldSlots = (count: number) => [1, 3, 5, 2, 4].slice(0, count).sort((a, b) => a - b);
export function pool(run: 'campaign' | 'replay', count: number) {
  const state = newCampaignState(world.id); state.run = run; state.completedMissions = ['earlier'];
  state.soldiers[0]!.xp = 740; state.soldiers[0]!.rank = 1;
  state.soldiers[0]!.loadout = { health: 100, weapon: 'marksman', primary: 'marksman', secondary: null,
    noPistol: false, pickedUp: true, ammo: [['marksman', 7]], pouch: [0, 1], kits: 2, equipment: -1 };
  const prisoners = heldSlots(count).reverse().map((slot) => ({ slot, at: { x: -60 + slot, y: 0, z: 12 } }));
  if (run === 'campaign') {
    for (const p of prisoners) Object.assign(state.soldiers[p.slot]!, { captured: true, prisoner: p.at });
    state.replayPrisoners = [{ slot: 4, at: { x: -50, y: 0, z: 10 } }];
  } else {
    state.replayPrisoners = prisoners;
    Object.assign(state.soldiers[4]!, { captured: true, prisoner: { x: -50, y: 0, z: 10 } });
  }
  return state;
}
const entry = (mission: string) => ({ mission, title: mission, briefing: ['Fixture'], debrief: ['Fixture'] });
const campaignDef = parseCampaign({ id: 'outpost-fixture', missions: ['earlier', world.id, 'later'].map(entry) }, () => true);
interface Internals {
  captureMissionCheckpoint(): void;
  checkpointSlot(slot: Session['slots'][number]): SlotCheckpoint;
  campaignSnapshot(): CampaignState;
}
export function play(state: CampaignState, options: { nav?: NavMesh; lobby?: boolean; mission?: MissionDef } = {}) {
  const saves: CampaignState[] = []; let handoffs = 0, now = 0;
  const session = new Session(undefined, '', world, { encounter, mission: options.mission ?? fixture.mission,
    campaign: state, campaignDef, roomLobby: options.lobby ?? false, loadouts: 'class',
    ...(options.nav ? { navMesh: options.nav, brainTree: buildTree('friendly', createBrainRegistry()) } : {}),
    onCampaignSave: (s) => saves.push(structuredClone(s)), onHandoff: () => handoffs++,
  });
  const x = session as unknown as Internals;
  const people: ReturnType<typeof join>[] = [];
  function settle() { for (let i = 0; i < 2; i++) for (const p of people) p.pair.settle(); }
  function join(resume = '') {
    const pair = createLoopbackPair(), heard: Message[] = [];
    session.addConnection(pair.a, now);
    const person = { pair, heard, resume: '', client: new ClientConnection(pair.b, { onRestoreGate: (m) => heard.push(m) }) };
    pair.b.onMessage((data) => { const m = decodeMessage(data); if (m.kind === 'JoinAck') person.resume = m.resume ?? ''; });
    people.push(person); person.client.send({ kind: 'Join', version: PROTOCOL_VERSION,
      name: 'outpost tester', room: '', ...(resume ? { resume } : {}) }); settle();
    return person;
  }
  const send = (p: ReturnType<typeof join>, m: Message) => { p.client.send(m); settle(); };
  const step = (count = 1, interact = false) => {
    for (let i = 0; i < count; i++) {
      for (const p of people) send(p, { kind: 'Ping', id: 1, clientTime: now });
      // Production held-E path, with the human at an ordinarily walked stand.
      for (const s of session.slots) if (!s.isBot) { s.interactHeld = interact; s.staleTicks = 0; }
      session.step(now += TICK_SECONDS * 1000); settle();
    }
  };
  return { session, saves, join, send, step, handoffs: () => handoffs,
    pow: () => session.enemies.find((e) => e.def.friendly)!,
    captured: () => session.slots.filter((s) => s.captured).map((s) => ({ slot: s.index, at: s.prisoner })),
    inventory: () => session.slots.map((s) => x.checkpointSlot(s)),
    snapshot: () => x.campaignSnapshot(),
    save: () => { x.captureMissionCheckpoint(); return structuredClone(saves.at(-1)!); },
    gate: (p: ReturnType<typeof join>) => p.heard.filter((m) => m.kind === 'RestoreGate').at(-1)?.choice,
    close: () => { for (const p of people) { p.pair.b.close('fixture complete'); p.pair.settle(); } },
  };
}

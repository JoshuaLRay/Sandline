import { runMission } from './scenarios/mission.ts';
const seed = Number(process.argv[2] ?? 1);
let last = -1;
const r = await runMission(seed, 1, undefined, undefined, (s, sec) => {
  if (Math.floor(sec / 5) === last) return;
  last = Math.floor(sec / 5);
  const tanks = s.enemies.filter((e) => e.def.id === 'tank');
  const t = tanks.map((e) => `tank(${e.state.x.toFixed(0)},${e.state.z.toFixed(0)}) hp${e.health.current.toFixed(0)} sp${e.speed.toFixed(1)} ${e.drive?.phase}${e.tell ? ' TELL' : ''}`).join(' ');
  const sl = s.slots.map((x) => `${x.health.current.toFixed(0)}@${x.state.x.toFixed(0)},${x.state.z.toFixed(0)}`).join(' ');
  console.log(`${sec.toFixed(0)}s obj${s.mission?.objective} ${s.mission?.phase} | ${t} | ${sl} | live ${s.enemies.filter((e) => e.health.diedAt === null && e.def.id !== 'tank').length}`);
});
console.log(r.outcome, r.seconds);

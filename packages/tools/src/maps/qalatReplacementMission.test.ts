/** U-230 unregistered mission and one-shot source contracts; production stays untouched. */
import { describe, expect, it } from 'vitest';
import { parseMission, requireWorld, missionFor, areaContains } from '@sandline/shared';
import missionRaw from './qalat-outpost-mission.json' with { type: 'json' };
import scriptRaw from './qalat-replacement-script.json' with { type: 'json' };
import { replacementInputs } from './qalatReplacement.ts';

describe('U-230 isolated Qalat objective and event contracts', () => {
  const mission = parseMission(missionRaw);
  it('keeps five stable objectives, shared optional radio stage, protected POW and separate final extraction', () => {
    expect(mission.objectives.map((o) => o.type)).toEqual(['reach','rescue','destroy','destroy','reach']);
    expect(mission.objectives.map((o) => o.stage)).toEqual([0,1,1,2,3]);
    expect(mission.objectives[1]).toMatchObject({ group:'prisoner', holdSeconds:3, reachM:2 });
    expect(mission.objectives[2]).toMatchObject({ group:'radio-operator', optional:true, checkpoint:false });
    expect(mission.failure?.protectedGroup).toBe('prisoner');
    expect(mission.prisonerHoldings?.map((h) => h.id)).toEqual(['carry-1','carry-2','carry-3','carry-4','carry-5']);
    expect(requireWorld('qalat-road').mapRevision ?? 1).toBe(1);
    expect(missionFor('qalat-road')?.objectives[0]?.label).not.toBe('Reach the prisoner outpost');
  });
  it('height-bounds both mandatory reach areas, never crediting basement or ridge coordinates', () => {
    const approach = mission.objectives[0]!, extraction = mission.objectives[4]!;
    expect(approach.type).toBe('reach');
    expect(extraction.type).toBe('reach');
    if (approach.type !== 'reach' || extraction.type !== 'reach' || typeof approach.area === 'string' || typeof extraction.area === 'string') return;
    expect(approach.area).toMatchObject({x:32,z:382,radius:32,minY:7.5,maxY:10.5});
    expect(extraction.area).toMatchObject({x:0,z:-6,radius:12,minY:7.5,maxY:10.5});
    expect(extraction).toMatchObject({who:'all',escort:true,checkpoint:false});
    expect(areaContains(approach.area,{x:32,y:0,z:382})).toBe(false);
    expect(areaContains(approach.area,{x:32,y:26,z:382})).toBe(false);
    expect(areaContains(extraction.area,{x:0,y:0,z:-6})).toBe(false);
    expect(areaContains(extraction.area,{x:0,y:8,z:-6})).toBe(true);
  });
  it('records exactly one route reveal box and the approved timed event ordering', () => {
    const reveal = scriptRaw.events.find((e) => e.id === 'route-reveal');
    expect(reveal?.trigger).toEqual({kind:'enter-box',minX:20,maxX:44,minZ:53,maxZ:75,minY:7.5,maxY:10.5});
    const timed = scriptRaw.events.filter((e) => 'delaySeconds' in e)
      .map((e) => [e.id, e.delaySeconds]);
    expect(timed).toEqual([['escort-hint',3],['armour-early',5],['armour-delayed',20],['reserve-release',45]]);
    expect(scriptRaw.events.find((e) => e.id === 'armour-early')).toMatchObject({
      ifGroupAlive:'radio-operator',unlessFlag:'tank-arrived'
    });
    expect(scriptRaw.events.find((e) => e.id === 'armour-delayed')).toMatchObject({unlessFlag:'tank-arrived'});
    expect(scriptRaw.events.find((e) => e.id === 'reserve-release')?.actions[0]).toMatchObject({
      kind:'spawn-group',group:'counterattack'
    });
  });
  it('keeps construction isolated and POW separate from five carried holdings', () => {
    const fixture = replacementInputs();
    expect(fixture.world.mission).toBeNull();
    expect(fixture.pow.id).toBe('mission-pow');
    expect(fixture.mission.objectives).toHaveLength(5);
    expect(fixture.mission.prisonerHoldings?.some((h) => h.id === fixture.pow.id)).toBe(false);
  },60000);
});

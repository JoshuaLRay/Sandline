import { describe, expect, it } from 'vitest';
import { Blackboard } from './blackboard.ts';
import { BtRegistry, TREE_DEFS, buildTree, parseTreeDef, type BtStatus } from './bt.ts';

type Board = { count: number };

/**
 * A harness: actions named `a`, `b`, ... return the statuses their script
 * gives, one per tick they are ticked (the last repeats), and every tick and
 * halt is logged as `name@tick` / `name!halt`.
 */
function harness(tree: unknown, scripts: Record<string, BtStatus[]>, conditions: Record<string, () => boolean> = {}) {
  const log: string[] = [];
  const calls: Record<string, number> = {};
  const reg = new BtRegistry<null, Board>();
  for (const [name, script] of Object.entries(scripts)) {
    reg.action(name, {
      tick: (f) => {
        const n = calls[name] ?? 0;
        calls[name] = n + 1;
        log.push(`${name}@${f.tick}`);
        return script[Math.min(n, script.length - 1)]!;
      },
      halt: () => {
        log.push(`${name}!halt`);
        calls[name] = 0;
      },
    });
  }
  for (const [name, fn] of Object.entries(conditions)) reg.condition(name, fn);
  const bt = buildTree(parseTreeDef({ id: 't', root: tree }), reg).instantiate({
    seed: 1,
    blackboard: new Blackboard<Board>({ count: 0 }),
    ctx: null,
  });
  return { bt, log, calls };
}

const act = (name: string) => ({ type: 'action', name });
const cond = (name: string) => ({ type: 'condition', name });

describe('sequence', () => {
  it('succeeds when every child succeeds, in order', () => {
    const h = harness({ type: 'sequence', children: [act('a'), act('b')] }, { a: ['success'], b: ['success'] });
    expect(h.bt.tick(0)).toBe('success');
    expect(h.log).toEqual(['a@0', 'b@0']);
  });

  it('fails on the first failure without ticking the rest', () => {
    const h = harness({ type: 'sequence', children: [act('a'), act('b')] }, { a: ['failure'], b: ['success'] });
    expect(h.bt.tick(0)).toBe('failure');
    expect(h.log).toEqual(['a@0']);
  });

  it('runs while a child runs, and resumes at that child on re-entry', () => {
    const h = harness(
      { type: 'sequence', children: [act('a'), act('b'), act('c')] },
      { a: ['success'], b: ['running', 'running', 'success'], c: ['success'] },
    );
    expect(h.bt.tick(0)).toBe('running');
    expect(h.bt.tick(1)).toBe('running');
    expect(h.bt.tick(2)).toBe('success');
    // `a` is not re-ticked while `b` runs.
    expect(h.log).toEqual(['a@0', 'b@0', 'b@1', 'b@2', 'c@2']);
    // Finished, so the next tick starts from the top (b's script now repeats success).
    h.bt.tick(3);
    expect(h.log.slice(5)).toEqual(['a@3', 'b@3', 'c@3']);
  });

  it('reactive: re-checks earlier children and halts the running one when a guard fails', () => {
    let guard = true;
    const h = harness(
      { type: 'sequence', reactive: true, children: [cond('guard'), act('a')] },
      { a: ['running'] },
      { guard: () => guard },
    );
    expect(h.bt.tick(0)).toBe('running');
    expect(h.bt.tick(1)).toBe('running');
    guard = false;
    expect(h.bt.tick(2)).toBe('failure');
    expect(h.log).toEqual(['a@0', 'a@1', 'a!halt']);
  });
});

describe('selector', () => {
  it('succeeds on the first success without ticking the rest', () => {
    const h = harness({ type: 'selector', children: [act('a'), act('b')] }, { a: ['success'], b: ['success'] });
    expect(h.bt.tick(0)).toBe('success');
    expect(h.log).toEqual(['a@0']);
  });

  it('fails when every child fails', () => {
    const h = harness({ type: 'selector', children: [act('a'), act('b')] }, { a: ['failure'], b: ['failure'] });
    expect(h.bt.tick(0)).toBe('failure');
    expect(h.log).toEqual(['a@0', 'b@0']);
  });

  it('runs while a child runs, and resumes at that child on re-entry', () => {
    const h = harness(
      { type: 'selector', children: [act('a'), act('b')] },
      { a: ['failure'], b: ['running', 'failure'] },
    );
    expect(h.bt.tick(0)).toBe('running');
    expect(h.bt.tick(1)).toBe('failure');
    expect(h.log).toEqual(['a@0', 'b@0', 'b@1']);
  });

  it('reactive: a higher-priority child that now succeeds pre-empts and halts a running one', () => {
    let seen = false;
    const h = harness(
      { type: 'selector', reactive: true, children: [cond('seen'), act('patrol')] },
      { patrol: ['running'] },
      { seen: () => seen },
    );
    expect(h.bt.tick(0)).toBe('running');
    expect(h.bt.tick(1)).toBe('running');
    seen = true;
    expect(h.bt.tick(2)).toBe('success');
    expect(h.log).toEqual(['patrol@0', 'patrol@1', 'patrol!halt']);
  });
});

describe('parallel', () => {
  it('"all": succeeds once all have, not re-ticking finished children', () => {
    const h = harness(
      { type: 'parallel', children: [act('a'), act('b')] },
      { a: ['success'], b: ['running', 'success'] },
    );
    expect(h.bt.tick(0)).toBe('running');
    expect(h.bt.tick(1)).toBe('success');
    expect(h.log).toEqual(['a@0', 'b@0', 'b@1']);
  });

  it('"all": fails on the first failure and halts the rest', () => {
    const h = harness(
      { type: 'parallel', children: [act('a'), act('b')] },
      { a: ['running', 'failure'], b: ['running'] },
    );
    expect(h.bt.tick(0)).toBe('running');
    expect(h.bt.tick(1)).toBe('failure');
    expect(h.log).toEqual(['a@0', 'b@0', 'a@1', 'b@1', 'b!halt']);
  });

  it('"one": succeeds on the first success and halts the rest', () => {
    const h = harness(
      { type: 'parallel', success: 'one', children: [act('a'), act('b')] },
      { a: ['running'], b: ['running', 'success'] },
    );
    expect(h.bt.tick(0)).toBe('running');
    expect(h.bt.tick(1)).toBe('success');
    expect(h.log).toEqual(['a@0', 'b@0', 'a@1', 'b@1', 'a!halt']);
  });

  it('"one": fails only when all have failed', () => {
    const h = harness(
      { type: 'parallel', success: 'one', children: [act('a'), act('b')] },
      { a: ['failure'], b: ['running', 'failure'] },
    );
    expect(h.bt.tick(0)).toBe('running');
    expect(h.bt.tick(1)).toBe('failure');
    expect(h.log).toEqual(['a@0', 'b@0', 'b@1']);
  });
});

describe('inverter', () => {
  it.each([
    ['success', 'failure'],
    ['failure', 'success'],
    ['running', 'running'],
  ] as const)('%s -> %s', (from, to) => {
    const h = harness({ type: 'inverter', child: act('a') }, { a: [from] });
    expect(h.bt.tick(0)).toBe(to);
  });
});

describe('condition', () => {
  it('is success or failure, never running', () => {
    let v = true;
    const h = harness(cond('c'), {}, { c: () => v });
    expect(h.bt.tick(0)).toBe('success');
    v = false;
    expect(h.bt.tick(1)).toBe('failure');
    expect(h.bt.runningPath()).toEqual([]);
  });
});

describe('cooldown', () => {
  it('fails without ticking its child for `ticks` ticks after a success', () => {
    const h = harness({ type: 'cooldown', ticks: 30, child: act('a') }, { a: ['success'] });
    const results: BtStatus[] = [];
    for (let t = 10; t <= 45; t++) results.push(h.bt.tick(t));
    expect(h.log).toEqual(['a@10', 'a@40']);
    expect(results[0]).toBe('success');
    expect(results.slice(1, 30).every((s) => s === 'failure')).toBe(true); // ticks 11..39
    expect(results[30]).toBe('success'); // tick 40
  });

  it('measures ticks, not calls: ticked every third tick it still waits 30 ticks', () => {
    const h = harness({ type: 'cooldown', ticks: 30, child: act('a') }, { a: ['success'] });
    for (let t = 0; t <= 60; t += 3) h.bt.tick(t);
    expect(h.log).toEqual(['a@0', 'a@30', 'a@60']);
  });

  it('a failure does not start the cooldown', () => {
    const h = harness({ type: 'cooldown', ticks: 30, child: act('a') }, { a: ['failure', 'success'] });
    expect(h.bt.tick(0)).toBe('failure');
    expect(h.bt.tick(1)).toBe('success');
    expect(h.bt.tick(2)).toBe('failure');
    expect(h.log).toEqual(['a@0', 'a@1']);
  });

  it('a running child keeps being ticked; the cooldown starts when it succeeds', () => {
    const h = harness({ type: 'cooldown', ticks: 5, child: act('a') }, { a: ['running', 'running', 'success'] });
    expect([0, 1, 2, 3, 6, 7].map((t) => h.bt.tick(t))).toEqual(['running', 'running', 'success', 'failure', 'failure', 'success']);
    expect(h.log).toEqual(['a@0', 'a@1', 'a@2', 'a@7']);
  });
});

describe('timeout', () => {
  it('fails and halts a child still running `ticks` ticks after it started', () => {
    const h = harness({ type: 'timeout', ticks: 10, child: act('a') }, { a: ['running'] });
    const results: BtStatus[] = [];
    for (let t = 100; t <= 110; t++) results.push(h.bt.tick(t));
    expect(results.slice(0, 10).every((s) => s === 'running')).toBe(true);
    expect(results[10]).toBe('failure');
    // Ticked 100..109 — its ten ticks, not an eleventh — then halted.
    expect(h.log.filter((l) => l.startsWith('a@'))).toHaveLength(10);
    expect(h.log.at(-1)).toBe('a!halt');
    // A new activation gets a new budget.
    expect(h.bt.tick(111)).toBe('running');
    expect(h.log.at(-1)).toBe('a@111');
  });

  it('measures ticks, not calls', () => {
    const h = harness({ type: 'timeout', ticks: 10, child: act('a') }, { a: ['running'] });
    const results = [100, 103, 106, 109, 112].map((t) => h.bt.tick(t));
    expect(results).toEqual(['running', 'running', 'running', 'running', 'failure']);
  });

  it('passes a child that finishes in time straight through', () => {
    const h = harness({ type: 'timeout', ticks: 10, child: act('a') }, { a: ['running', 'success'] });
    expect(h.bt.tick(0)).toBe('running');
    expect(h.bt.tick(9)).toBe('success');
  });
});

describe('instance', () => {
  it('halt() halts running actions; runningPath names the running branch', () => {
    const h = harness(
      { type: 'sequence', children: [act('a'), { type: 'timeout', ticks: 50, child: act('b') }] },
      { a: ['success'], b: ['running'] },
    );
    h.bt.tick(0);
    expect(h.bt.runningPath()).toEqual(['root sequence', 'root.children[1] timeout', 'root.children[1].child action:b']);
    h.bt.halt();
    expect(h.log.at(-1)).toBe('b!halt');
    expect(h.bt.runningPath()).toEqual([]);
  });

  it('refuses a tick that goes backwards', () => {
    const h = harness(act('a'), { a: ['success'] });
    h.bt.tick(5);
    expect(() => h.bt.tick(4)).toThrow(/before the last tick/);
  });

  it('leaves share the blackboard', () => {
    const reg = new BtRegistry<null, Board>().action('inc', (f) => {
      f.blackboard.set('count', f.blackboard.get('count') + 1);
      return 'success';
    });
    const board = new Blackboard<Board>({ count: 0 });
    const bt = buildTree(parseTreeDef({ id: 't', root: act('inc') }), reg).instantiate({ seed: 0, blackboard: board, ctx: null });
    bt.tick(0);
    bt.tick(1);
    expect(board.get('count')).toBe(2);
  });
});

describe('seeded randomness', () => {
  // A patrol that picks one of four moves with the instance's rng each tick.
  const TREE = {
    type: 'selector',
    children: [
      { type: 'sequence', children: [cond('coin'), { type: 'cooldown', ticks: 3, child: act('shoot') }] },
      { type: 'action', name: 'move', args: { choices: 4 } },
    ],
  };

  function run(seed: number): string[] {
    const out: string[] = [];
    const reg = new BtRegistry<null, Board>()
      .condition('coin', (f) => f.rng.next() < 0.5)
      .action('shoot', () => {
        out.push('shoot');
        return 'success';
      })
      .action('move', (f, args) => {
        out.push(`move${Math.floor(f.rng.next() * Number(args['choices']))}`);
        return 'success';
      });
    const bt = buildTree(parseTreeDef({ id: 'r', root: TREE }), reg).instantiate({
      seed,
      blackboard: new Blackboard<Board>({ count: 0 }),
      ctx: null,
    });
    for (let t = 0; t < 200; t++) bt.tick(t);
    return out;
  }

  it('two runs from the same seed produce the same sequence of actions', () => {
    const a = run(1234);
    expect(a).toHaveLength(200);
    expect(new Set(a).size).toBe(5); // it did exercise every branch
    expect(run(1234)).toEqual(a);
  });

  it('a different seed produces a different sequence', () => {
    expect(run(1235)).not.toEqual(run(1234));
  });
});

describe('loading', () => {
  it('a tree referencing an unregistered action fails at load with its name', () => {
    const reg = new BtRegistry<null, Board>().action('a', () => 'success');
    const def = parseTreeDef({ id: 'combat', root: { type: 'sequence', children: [act('a'), act('throwGrenade')] } });
    expect(() => buildTree(def, reg)).toThrow("tree 'combat': root.children[1]: unregistered action 'throwGrenade'");
  });

  it('and an unregistered condition likewise', () => {
    const reg = new BtRegistry<null, Board>().action('canSee', () => 'success');
    const def = parseTreeDef({ id: 'x', root: { type: 'inverter', child: cond('canSee') } });
    expect(() => buildTree(def, reg)).toThrow("tree 'x': root.child: unregistered condition 'canSee'");
  });

  it.each([
    [{ type: 'sequence', children: [] }, /root\.children: a sequence needs a non-empty array/],
    [{ type: 'repeat', child: act('a') }, /root: unknown node type "repeat"/],
    [{ type: 'action', name: 'a', delay: 3 }, /root: unknown key "delay" on a action/],
    [{ type: 'cooldown', ticks: 0.5, child: act('a') }, /root\.ticks: expected a positive whole number/],
    [{ type: 'timeout', ticks: 0, child: act('a') }, /root\.ticks: expected a positive whole number/],
    [{ type: 'parallel', success: 'most', children: [act('a')] }, /root\.success: expected "all" or "one"/],
    [{ type: 'selector', reactive: 'yes', children: [act('a')] }, /root\.reactive: expected a boolean/],
    [{ type: 'action', name: 'a', args: { at: [1] } }, /root\.args\.at: expected a finite number, string or boolean/],
    [{ type: 'inverter', child: { type: 'action' } }, /root\.child\.name: a action needs the name/],
  ])('refuses a malformed node: %j', (root, message) => {
    expect(() => parseTreeDef({ id: 'bad', root })).toThrow(message);
  });

  it('refuses unknown keys on the tree itself', () => {
    expect(() => parseTreeDef({ id: 'bad', root: act('a'), version: 2 })).toThrow(/unknown key "version"/);
  });

  it('every committed tree is validated at import and builds against its leaves', () => {
    expect([...TREE_DEFS.keys()]).toContain('idle');
    const reg = new BtRegistry<null, Board>().action('idle', () => 'running');
    const bt = buildTree('idle', reg).instantiate({ seed: 0, blackboard: new Blackboard<Board>({ count: 0 }), ctx: null });
    expect(bt.tick(0)).toBe('running');
    expect(() => buildTree('nope', reg)).toThrow("tree 'nope': no such tree");
  });
});

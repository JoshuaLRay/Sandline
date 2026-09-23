/**
 * Behaviour tree runtime (T-3.07, E-3.3).
 *
 * Trees are DATA (standing rule 4): authored as JSON in `data/trees/*.json`,
 * validated structurally when this module is imported, and bound to code only
 * by name — a condition or action node names a leaf the server registers in a
 * `BtRegistry`. `buildTree` resolves every name once, at load, so a tree that
 * names a leaf nobody registered fails there with the name and where it is,
 * not on the tick the branch is first reached.
 *
 * In `shared`, not `server`, because it is platform-free logic (§3). It imports
 * nothing but the PRNG and reads no clock: time is the tick handed to `tick`,
 * and randomness is the instance's seeded `Sfc32`, which leaves draw from. Two
 * instances of one tree with one seed, ticked on the same ticks against the
 * same world, run the same actions in the same order.
 *
 * Nodes and their semantics:
 *
 * - `sequence` — children in order; fails on the first failure, succeeds when
 *   all succeed, runs while one runs. With memory (the default) a running
 *   sequence resumes AT the running child next tick, not re-checking the ones
 *   before it. `reactive: true` re-ticks from the first child every tick and
 *   halts the running child if an earlier one now fails — a guard that stays
 *   checked while the action it guards runs.
 * - `selector` — the mirror: succeeds on the first success, fails when all
 *   fail. `reactive: true` lets an earlier (higher-priority) child that now
 *   succeeds or runs pre-empt a later running one, which is halted.
 * - `parallel` — ticks every child that has not finished in this activation;
 *   `success: "all"` (default) succeeds when all have and fails on the first
 *   failure, `success: "one"` succeeds on the first success and fails when all
 *   have failed. Whatever is still running when it decides is halted.
 * - `inverter` — success ↔ failure; running stays running.
 * - `cooldown` — after its child SUCCEEDS, fails without ticking the child
 *   until `ticks` ticks have passed. A failed attempt does not start the
 *   cooldown; a child halted mid-run does not either.
 * - `timeout` — fails, halting its child, once the child has been running for
 *   `ticks` ticks since the tick it started. The child is not ticked on that
 *   tick: it gets its budget and no more.
 * - `condition` — a registered predicate: success or failure, never running.
 * - `action` — a registered leaf returning any status. An action that is
 *   abandoned while running (pre-empted, timed out, its parallel decided) is
 *   told so through its optional `halt`.
 *
 * Ticks are absolute session ticks, so `cooldown` and `timeout` measure time
 * the same whether the tree is ticked every tick or every third (T-3.08's
 * 10 Hz brains): a 30-tick cooldown is one second either way.
 */
import TREE_IDLE from '../data/trees/idle.json' with { type: 'json' };
import TREE_RIFLEMAN from '../data/trees/rifleman.json' with { type: 'json' };
import TREE_MG from '../data/trees/mg.json' with { type: 'json' };
import TREE_FRIENDLY from '../data/trees/friendly.json' with { type: 'json' };
import { Sfc32 } from '../math/prng.ts';
import type { Blackboard } from './blackboard.ts';

export type BtStatus = 'success' | 'failure' | 'running';

/** Arguments a leaf node passes its registered function, from the tree file. */
export type BtArgs = Readonly<Record<string, number | string | boolean>>;

// ---------------------------------------------------------------------------
// Authoring form — what a tree file holds
// ---------------------------------------------------------------------------

export type BtNodeDef =
  | { readonly type: 'sequence'; readonly reactive: boolean; readonly children: readonly BtNodeDef[] }
  | { readonly type: 'selector'; readonly reactive: boolean; readonly children: readonly BtNodeDef[] }
  | { readonly type: 'parallel'; readonly success: 'all' | 'one'; readonly children: readonly BtNodeDef[] }
  | { readonly type: 'inverter'; readonly child: BtNodeDef }
  | { readonly type: 'cooldown'; readonly ticks: number; readonly child: BtNodeDef }
  | { readonly type: 'timeout'; readonly ticks: number; readonly child: BtNodeDef }
  | { readonly type: 'condition'; readonly name: string; readonly args: BtArgs }
  | { readonly type: 'action'; readonly name: string; readonly args: BtArgs };

export interface BtTreeDef {
  readonly id: string;
  readonly root: BtNodeDef;
}

class BtDataError extends Error {}

const KEYS: Record<BtNodeDef['type'], readonly string[]> = {
  sequence: ['type', 'reactive', 'children'],
  selector: ['type', 'reactive', 'children'],
  parallel: ['type', 'success', 'children'],
  inverter: ['type', 'child'],
  cooldown: ['type', 'ticks', 'child'],
  timeout: ['type', 'ticks', 'child'],
  condition: ['type', 'name', 'args'],
  action: ['type', 'name', 'args'],
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseNode(raw: unknown, where: string): BtNodeDef {
  if (!isObject(raw)) throw new BtDataError(`${where}: expected a node object`);
  const type = raw['type'];
  if (typeof type !== 'string' || !(type in KEYS)) {
    throw new BtDataError(`${where}: unknown node type ${JSON.stringify(type)}`);
  }
  const t = type as BtNodeDef['type'];
  for (const key of Object.keys(raw)) {
    if (!KEYS[t].includes(key)) throw new BtDataError(`${where}: unknown key "${key}" on a ${t}`);
  }

  const children = (): BtNodeDef[] => {
    const list = raw['children'];
    if (!Array.isArray(list) || list.length === 0) {
      throw new BtDataError(`${where}.children: a ${t} needs a non-empty array of children`);
    }
    return list.map((c, i) => parseNode(c, `${where}.children[${i}]`));
  };
  const flag = (key: string): boolean => {
    const v = raw[key];
    if (v === undefined) return false;
    if (typeof v !== 'boolean') throw new BtDataError(`${where}.${key}: expected a boolean`);
    return v;
  };
  const ticks = (): number => {
    const v = raw['ticks'];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      throw new BtDataError(`${where}.ticks: expected a positive whole number of ticks, got ${String(v)}`);
    }
    return v;
  };
  const leaf = (): { name: string; args: BtArgs } => {
    const name = raw['name'];
    if (typeof name !== 'string' || name.length === 0) {
      throw new BtDataError(`${where}.name: a ${t} needs the name of a registered ${t}`);
    }
    const a = raw['args'] ?? {};
    if (!isObject(a)) throw new BtDataError(`${where}.args: expected an object`);
    for (const [k, v] of Object.entries(a)) {
      if (typeof v !== 'string' && typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v))) {
        throw new BtDataError(`${where}.args.${k}: expected a finite number, string or boolean`);
      }
    }
    return { name, args: { ...(a as Record<string, number | string | boolean>) } };
  };

  switch (t) {
    case 'sequence':
    case 'selector':
      return { type: t, reactive: flag('reactive'), children: children() };
    case 'parallel': {
      const s = raw['success'] ?? 'all';
      if (s !== 'all' && s !== 'one') throw new BtDataError(`${where}.success: expected "all" or "one"`);
      return { type: t, success: s, children: children() };
    }
    case 'inverter': {
      return { type: t, child: parseNode(raw['child'], `${where}.child`) };
    }
    case 'cooldown':
    case 'timeout':
      return { type: t, ticks: ticks(), child: parseNode(raw['child'], `${where}.child`) };
    case 'condition':
    case 'action':
      return { type: t, ...leaf() };
  }
}

/**
 * Validate a tree file's structure: node types, their keys (unknown keys are
 * refused, as `follow.json`'s are), children, tick counts and leaf args. Names
 * are checked against a registry later, by `buildTree` — the registry is the
 * server's, and this runs at import.
 */
export function parseTreeDef(raw: unknown): BtTreeDef {
  if (!isObject(raw)) throw new BtDataError('tree: expected { id, root }');
  const id = raw['id'];
  if (typeof id !== 'string' || id.length === 0) throw new BtDataError('tree.id: expected a non-empty string');
  for (const key of Object.keys(raw)) {
    // `$comment` is a note for whoever edits the file, as in every other data file.
    if (key !== 'id' && key !== 'root' && key !== '$comment') throw new BtDataError(`tree '${id}': unknown key "${key}"`);
  }
  try {
    return { id, root: parseNode(raw['root'], 'root') };
  } catch (e) {
    if (e instanceof BtDataError) throw new BtDataError(`tree '${id}': ${e.message}`);
    throw e;
  }
}

/** Every committed tree, validated at import. Keyed by id. */
export const TREE_DEFS: ReadonlyMap<string, BtTreeDef> = (() => {
  const map = new Map<string, BtTreeDef>();
  for (const raw of [TREE_IDLE, TREE_RIFLEMAN, TREE_MG, TREE_FRIENDLY]) {
    const def = parseTreeDef(raw);
    if (map.has(def.id)) throw new BtDataError(`tree '${def.id}': duplicate id`);
    map.set(def.id, def);
  }
  return map;
})();

// ---------------------------------------------------------------------------
// Registry — the server's leaves, by name
// ---------------------------------------------------------------------------

/** What a leaf sees on the tick it runs. */
export interface BtFrame<C, S extends object> {
  /** The tick this tree is being ticked on. */
  readonly tick: number;
  /** This instance's seeded generator; the only randomness a leaf may use. */
  readonly rng: Sfc32;
  readonly blackboard: Blackboard<S>;
  /** Whatever the owner hands in — the entity, the world, the session. */
  readonly ctx: C;
}

export type BtCondition<C, S extends object> = (frame: BtFrame<C, S>, args: BtArgs) => boolean;

export interface BtAction<C, S extends object> {
  tick(frame: BtFrame<C, S>, args: BtArgs): BtStatus;
  /** Called when the action is abandoned while running. */
  halt?(frame: BtFrame<C, S>, args: BtArgs): void;
}

export class BtRegistry<C, S extends object> {
  private readonly conditions = new Map<string, BtCondition<C, S>>();
  private readonly actions = new Map<string, BtAction<C, S>>();

  condition(name: string, fn: BtCondition<C, S>): this {
    if (this.conditions.has(name)) throw new Error(`condition '${name}' is already registered`);
    this.conditions.set(name, fn);
    return this;
  }

  /** Register an action; a bare function is an action with no `halt`. */
  action(name: string, action: BtAction<C, S> | BtAction<C, S>['tick']): this {
    if (this.actions.has(name)) throw new Error(`action '${name}' is already registered`);
    this.actions.set(name, typeof action === 'function' ? { tick: action } : action);
    return this;
  }

  getCondition(name: string): BtCondition<C, S> | undefined {
    return this.conditions.get(name);
  }

  getAction(name: string): BtAction<C, S> | undefined {
    return this.actions.get(name);
  }
}

// ---------------------------------------------------------------------------
// Compiled form — flat nodes, leaves resolved; shared by every instance
// ---------------------------------------------------------------------------

type Compiled<C, S extends object> =
  | { kind: 'sequence' | 'selector'; reactive: boolean; children: number[]; path: string }
  | { kind: 'parallel'; need: 'all' | 'one'; children: number[]; path: string }
  | { kind: 'inverter' | 'cooldown' | 'timeout'; ticks: number; children: [number]; path: string }
  | { kind: 'condition'; fn: BtCondition<C, S>; args: BtArgs; children: []; path: string; name: string }
  | { kind: 'action'; action: BtAction<C, S>; args: BtArgs; children: []; path: string; name: string };

/** A tree bound to a registry. Immutable; `instantiate` gives a brain its own run state. */
export class BtTree<C, S extends object> {
  readonly id: string;
  /** @internal */
  readonly nodes: readonly Compiled<C, S>[];

  constructor(id: string, nodes: Compiled<C, S>[]) {
    this.id = id;
    this.nodes = nodes;
  }

  instantiate(opts: { seed: number; blackboard: Blackboard<S>; ctx: C }): BehaviorTree<C, S> {
    return new BehaviorTree(this, opts.seed, opts.blackboard, opts.ctx);
  }
}

/**
 * Resolve a tree's leaves against a registry. Throws, naming the leaf and its
 * place in the tree, if any condition or action is not registered.
 */
export function buildTree<C, S extends object>(def: BtTreeDef | string, registry: BtRegistry<C, S>): BtTree<C, S> {
  const tree = typeof def === 'string' ? TREE_DEFS.get(def) : def;
  if (!tree) throw new BtDataError(`tree '${String(def)}': no such tree`);
  const nodes: Compiled<C, S>[] = [];

  const visit = (n: BtNodeDef, path: string): number => {
    const index = nodes.length;
    // Reserve the slot so a parent's index precedes its children's.
    nodes.push(undefined as unknown as Compiled<C, S>);
    let c: Compiled<C, S>;
    switch (n.type) {
      case 'sequence':
      case 'selector':
        c = { kind: n.type, reactive: n.reactive, path, children: n.children.map((ch, i) => visit(ch, `${path}.children[${i}]`)) };
        break;
      case 'parallel':
        c = { kind: 'parallel', need: n.success, path, children: n.children.map((ch, i) => visit(ch, `${path}.children[${i}]`)) };
        break;
      case 'inverter':
        c = { kind: 'inverter', ticks: 0, path, children: [visit(n.child, `${path}.child`)] };
        break;
      case 'cooldown':
      case 'timeout':
        c = { kind: n.type, ticks: n.ticks, path, children: [visit(n.child, `${path}.child`)] };
        break;
      case 'condition': {
        const fn = registry.getCondition(n.name);
        if (!fn) throw new BtDataError(`tree '${tree.id}': ${path}: unregistered condition '${n.name}'`);
        c = { kind: 'condition', fn, args: n.args, children: [], path, name: n.name };
        break;
      }
      case 'action': {
        const action = registry.getAction(n.name);
        if (!action) throw new BtDataError(`tree '${tree.id}': ${path}: unregistered action '${n.name}'`);
        c = { kind: 'action', action, args: n.args, children: [], path, name: n.name };
        break;
      }
    }
    nodes[index] = c;
    return index;
  };

  visit(tree.root, 'root');
  return new BtTree(tree.id, nodes);
}

// ---------------------------------------------------------------------------
// Instance — one brain's run state
// ---------------------------------------------------------------------------

export class BehaviorTree<C, S extends object> {
  readonly tree: BtTree<C, S>;
  readonly rng: Sfc32;
  readonly blackboard: Blackboard<S>;
  readonly ctx: C;

  /** Per node: running after the last tick it was ticked on. */
  private readonly running: boolean[];
  /** sequence/selector: the running child's position. parallel: unused. */
  private readonly cursor: number[];
  /** cooldown: first tick the child may run again. timeout: tick the child started. */
  private readonly mark: number[];
  /** parallel: per node, each child's result in this activation, or null. */
  private readonly done: (BtStatus | null)[][];
  private frame: BtFrame<C, S>;
  private lastTick = -Infinity;

  constructor(tree: BtTree<C, S>, seed: number, blackboard: Blackboard<S>, ctx: C) {
    this.tree = tree;
    this.rng = new Sfc32(seed);
    this.blackboard = blackboard;
    this.ctx = ctx;
    const n = tree.nodes.length;
    this.running = new Array<boolean>(n).fill(false);
    this.cursor = new Array<number>(n).fill(0);
    this.mark = new Array<number>(n).fill(-Infinity);
    this.done = tree.nodes.map((node) => node.children.map(() => null));
    this.frame = { tick: 0, rng: this.rng, blackboard, ctx };
  }

  /** Tick the tree once. Ticks must not go backwards. */
  tick(tick: number): BtStatus {
    if (!Number.isInteger(tick)) throw new Error(`bt '${this.tree.id}': tick must be an integer, got ${tick}`);
    if (tick < this.lastTick) throw new Error(`bt '${this.tree.id}': tick ${tick} is before the last tick ${this.lastTick}`);
    this.lastTick = tick;
    this.frame = { tick, rng: this.rng, blackboard: this.blackboard, ctx: this.ctx };
    return this.run(0);
  }

  /** Abandon whatever is running, halting running actions, as if never ticked. */
  halt(): void {
    this.stop(0);
  }

  /**
   * The running branch after the last tick, root first, as tree-file paths
   * with leaf names — what a debug view shows as "where the brain is".
   */
  runningPath(): string[] {
    const out: string[] = [];
    let i = 0;
    while (this.running[i]) {
      const node = this.tree.nodes[i]!;
      out.push(node.kind === 'action' ? `${node.path} action:${node.name}` : `${node.path} ${node.kind}`);
      const next = node.children.find((c) => this.running[c]);
      if (next === undefined) break;
      i = next;
    }
    return out;
  }

  private run(i: number): BtStatus {
    const node = this.tree.nodes[i]!;
    const tick = this.frame.tick;
    let s: BtStatus;
    switch (node.kind) {
      case 'condition':
        return node.fn(this.frame, node.args) ? 'success' : 'failure';
      case 'action':
        s = node.action.tick(this.frame, node.args);
        break;
      case 'inverter':
        s = this.run(node.children[0]);
        if (s !== 'running') s = s === 'success' ? 'failure' : 'success';
        break;
      case 'cooldown':
        if (!this.running[i] && tick < this.mark[i]!) return 'failure';
        s = this.run(node.children[0]);
        if (s === 'success') this.mark[i] = tick + node.ticks;
        break;
      case 'timeout':
        if (!this.running[i]) this.mark[i] = tick;
        else if (tick - this.mark[i]! >= node.ticks) {
          this.stop(node.children[0]);
          this.running[i] = false;
          return 'failure';
        }
        s = this.run(node.children[0]);
        break;
      case 'sequence':
      case 'selector': {
        // A sequence stops on failure, a selector on success; either stops on running.
        const stopOn: BtStatus = node.kind === 'sequence' ? 'failure' : 'success';
        const start = !node.reactive && this.running[i] ? this.cursor[i]! : 0;
        s = node.kind === 'sequence' ? 'success' : 'failure';
        let k = start;
        for (; k < node.children.length; k++) {
          const cs = this.run(node.children[k]!);
          if (cs === 'running' || cs === stopOn) {
            s = cs;
            break;
          }
        }
        // Anything after the child that decided was left behind this tick.
        for (let j = k + 1; j < node.children.length; j++) this.stop(node.children[j]!);
        this.cursor[i] = s === 'running' ? k : 0;
        break;
      }
      case 'parallel': {
        const done = this.done[i]!;
        if (!this.running[i]) done.fill(null);
        let ok = 0;
        let bad = 0;
        for (let k = 0; k < node.children.length; k++) {
          if (done[k] === null) {
            const cs = this.run(node.children[k]!);
            if (cs !== 'running') done[k] = cs;
          }
          if (done[k] === 'success') ok++;
          else if (done[k] === 'failure') bad++;
        }
        const n = node.children.length;
        const need = node.need === 'all' ? n : 1;
        if (ok >= need) s = 'success';
        else if (bad > n - need) s = 'failure';
        else s = 'running';
        if (s !== 'running') {
          for (const c of node.children) this.stop(c);
          done.fill(null);
        }
        break;
      }
    }
    this.running[i] = s === 'running';
    return s;
  }

  /** Halt node i if it is running: its running descendants first, then itself. */
  private stop(i: number): void {
    if (!this.running[i]) return;
    const node = this.tree.nodes[i]!;
    for (const c of node.children) this.stop(c);
    if (node.kind === 'action') node.action.halt?.(this.frame, node.args);
    this.running[i] = false;
    this.cursor[i] = 0;
    this.done[i]!.fill(null);
  }
}

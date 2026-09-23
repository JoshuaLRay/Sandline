/**
 * An authoritative session running inside the page, reached over a simulated
 * link (T-1.18 wiring, T-1.21 NetSim).
 *
 * WHY IN-BROWSER. The QA home is GitHub Pages, which is static hosting: there
 * is no process there to connect to, and no session host exists yet (ADR-011
 * describes regional hosting; nothing is deployed). Waiting for one would mean
 * the netcode stays untestable by a person indefinitely.
 *
 * WHAT IS REAL ABOUT IT. Everything except the wire. It is the same `Session`
 * the dedicated server runs, the same encode/decode, the same delta baselines,
 * the same prediction and reconciliation, the same lag compensation. Packets
 * are byte-identical to the ones a socket would carry; they simply travel
 * through NetSim instead of TCP. That is the identical arrangement T-1.22's
 * matrix runs headlessly in CI — this makes it feelable.
 *
 * WHAT IS NOT. Real jitter distributions, real reordering under congestion,
 * real NAT and TCP head-of-line blocking. NetSim's latency, jitter and loss are
 * a model. A remote server is still the only way to judge those, and T-1.24
 * should say so.
 *
 * THE PAYOFF. Because the link is simulated, its conditions are a slider. A
 * tester can feel 200 ms and 20% loss on demand, which is exactly the judgement
 * no amount of green CI substitutes for.
 *
 * ONE LINK PER CLIENT. Every attached client owns its NetSim pair and its own
 * conditions, because "mine is bad" and "theirs is bad" are different faults
 * that feel different and break different code. YOUR link drives prediction and
 * reconciliation: raise its latency and you feel your own corrections and your
 * own firing. A REMOTE player's link drives only what you see of them — their
 * input reaches the server late, so their capsule interpolates from stale
 * samples no matter how good your own connection is. Driving every link from
 * one slider, which is what this did until T-1.24 asked for the split, makes
 * those two failures impossible to tell apart: the one thing a tester most
 * needs to report precisely.
 */
import {
  type MoveConfig,
  type ProjectileDef,
  NetSim,
  type NetSimOptions,
  TICK_SECONDS,
  type Transport,
  createLoopbackPair,
} from '@sandline/shared';
import { type EnemySpawn, Session, type SessionOptions } from '@sandline/server/session';
import { type NavMesh, initNav, isNavReady } from '@sandline/server/nav';

export interface LinkConditions {
  latencyMs: number;
  jitterMs: number;
  lossRate: number;
}

export const DEFAULT_LINK: LinkConditions = {
  // Zero by default so the harness feels like the local one it replaces. The
  // sliders are the instrument; a hidden 80 ms would just look like a bug.
  latencyMs: 0,
  jitterMs: 0,
  lossRate: 0,
};

/** What the in-page session is built with beyond its link and tuning. */
export interface LocalServerOptions {
  /**
   * The world's navmesh, for anything that walks (T-3.08). Off by default:
   * the bake costs a few hundred kB of bundle (see `bakedNav.ts`), and only
   * the `?enemies` QA page (T-3.11) loads it, on demand.
   */
  navMesh?: NavMesh;
  /**
   * The tree the bot slots run, and the cover they take (T-3.29's `?squad`:
   * the committed `friendly` tree, so the in-page bots follow and take
   * orders). The committed idle tree and no cover by default.
   */
  brainTree?: SessionOptions['brainTree'];
  cover?: SessionOptions['cover'];
}

/** One client's link to the in-page session, tunable on its own. */
export interface ClientLink {
  readonly transport: Transport;
  /**
   * Live-tunable. NetSim reads its options on every send, so a change takes
   * effect on the next packet rather than the next reload.
   */
  setConditions(c: LinkConditions): void;
  /** Datagrams still in flight on this link, both directions. */
  readonly inFlight: number;
}

/**
 * Seeds are fixed per link rather than counted from one base, so attaching a
 * second client cannot change the first one's loss pattern. A harness that
 * patrols differently once someone else joins cannot be compared with itself.
 */
const LOCAL_SEEDS = { up: 0x51a7, down: 0x9e37 };
const PEER_SEEDS = { up: 0x1234, down: 0xabcd };
const PEER_SEED_STRIDE = 97;

export class LocalServer {
  /** The human's own transport. `LocalServer.setConditions` is its shorthand. */
  readonly transport: Transport;
  readonly local: ClientLink;
  private readonly session: Session;
  private readonly sims: NetSim[] = [];
  private readonly pairs: { settle: () => void }[] = [];
  private peers = 0;
  /**
   * The page clock at the session's first step. The session runs on its own
   * clock from there, starting at zero — the clock its connections were
   * registered on. Handing it the page's `performance.now()` directly meant
   * a connection registered at 0 and first stepped at, say, 8000 was judged
   * silent for eight seconds and dropped for a heartbeat timeout before its
   * Join was read: clicking "Practise here" more than five seconds after the
   * page loaded never joined (found in T-3.11's browser run).
   */
  private origin: number | null = null;
  private sessionNow = 0;

  /**
   * The way to make one: waits for the session's WASM (Recast, T-3.01) to
   * initialise in this page before a session exists to tick. The host awaits
   * the same promise in `SessionHost.start`.
   */
  static async create(conditions: LinkConditions = DEFAULT_LINK, moveConfig?: MoveConfig): Promise<LocalServer> {
    await initNav();
    return new LocalServer(conditions, moveConfig);
  }

  /** Throws unless `initNav()` has resolved; prefer `LocalServer.create`. */
  constructor(conditions: LinkConditions = DEFAULT_LINK, moveConfig?: MoveConfig, options: LocalServerOptions = {}) {
    if (!isNavReady()) throw new Error('LocalServer before initNav() resolved: use LocalServer.create()');
    // The page is its own host, so it allows AI debug (T-3.09): a report still
    // goes only to a client that asks for one.
    this.session = new Session(moveConfig, '', undefined, {
      aiDebug: true,
      ...(options.navMesh ? { navMesh: options.navMesh } : {}),
      ...(options.brainTree ? { brainTree: options.brainTree } : {}),
      ...(options.cover ? { cover: options.cover } : {}),
    });
    this.local = this.attach(conditions, LOCAL_SEEDS);
    this.transport = this.local.transport;
  }

  /**
   * Attach another client to the same session, on a link of its own.
   *
   * Used for the sparring partner, which exists so there is a remote entity
   * that actually MOVES. Five idle capsules exercise replication but say
   * nothing about interpolation, and interpolation is most of what a poor link
   * does to other players. On a LAN link (the default) they are also the only
   * way to see the interpolation delay at all.
   */
  connect(conditions: LinkConditions = DEFAULT_LINK): ClientLink {
    const index = this.peers++;
    return this.attach(conditions, {
      up: PEER_SEEDS.up + index * PEER_SEED_STRIDE,
      down: PEER_SEEDS.down + index * PEER_SEED_STRIDE,
    });
  }

  private attach(conditions: LinkConditions, seeds: { up: number; down: number }): ClientLink {
    const pair = createLoopbackPair();
    /**
     * Separate option objects per direction, sharing values but NOT seeds. One
     * shared object would give both directions the same RNG stream, so every
     * lost packet would be lost both ways at once — a link no real network
     * resembles, and a flattering one to reconcile against.
     */
    const up: NetSimOptions = { seed: seeds.up };
    const down: NetSimOptions = { seed: seeds.down };
    const serverSide = new NetSim(pair.a, up);
    const clientSide = new NetSim(pair.b, down);
    this.sims.push(serverSide, clientSide);
    this.pairs.push(pair);
    this.session.addConnection(serverSide, this.sessionNow);

    const link: ClientLink = {
      transport: clientSide,
      setConditions(c: LinkConditions): void {
        for (const opts of [up, down]) {
          opts.latencyMs = c.latencyMs;
          opts.jitterMs = c.jitterMs;
          opts.lossRate = c.lossRate;
        }
      },
      get inFlight(): number {
        return serverSide.inFlight + clientSide.inFlight;
      },
    };
    link.setConditions(conditions);
    return link;
  }

  /**
   * Put an enemy into the in-page session (T-3.10), for the QA page
   * (T-3.11). Nothing else spawns them until E-3.9's spawner.
   */
  spawnEnemy(archetype: string, at: EnemySpawn): number | null {
    return this.session.spawnEnemy(archetype, at);
  }

  /**
   * Retune a projectile for the in-page session (the projectile panel): the
   * server throws what the page predicts. A remote host keeps its own data.
   */
  tuneProjectile(index: number, def: Readonly<ProjectileDef>): void {
    this.session.tuneProjectile(index, def);
  }

  /** The row the in-page session throws for a projectile index, as tuned. */
  projectileDef(index: number): Readonly<ProjectileDef> | null {
    return this.session.projectileDef(index);
  }

  /** NetIds of the enemies in the session right now, corpses included. */
  get enemyNetIds(): number[] {
    return this.session.enemies.map((e) => e.netId);
  }

  /** Set the human's own link. Other clients keep whatever they were given. */
  setConditions(c: LinkConditions): void {
    this.local.setConditions(c);
  }

  /**
   * Move queued packets. Called every FRAME, not every tick: at 60 fps that
   * halves the time a packet sits waiting for the next pump, which would
   * otherwise read as latency the sliders did not ask for.
   */
  pump(nowMs: number): void {
    for (const sim of this.sims) sim.pump(nowMs);
    for (const pair of this.pairs) pair.settle();
  }

  /** Advance the authoritative simulation one tick. */
  step(nowMs: number): void {
    this.pump(nowMs);
    this.origin ??= nowMs;
    this.sessionNow = Math.max(this.sessionNow, nowMs - this.origin);
    this.session.step(this.sessionNow);
    this.pump(nowMs);
  }

  get tick(): number {
    return this.session.tick;
  }

  /** Server time the newest tick corresponds to, in ms. */
  get serverTimeMs(): number {
    return this.session.tick * TICK_SECONDS * 1000;
  }

  /**
   * Every link's queue. The HUD wants `local.inFlight` — the tester's own
   * packets — because a sparring partner parked on a 300 ms link would
   * otherwise inflate a number that reads as "my connection".
   */
  get inFlight(): number {
    return this.sims.reduce((n, s) => n + s.inFlight, 0);
  }
}

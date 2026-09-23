/**
 * The browser's networked client (T-1.14, T-1.15, T-1.16 finally in the page).
 *
 * Deliberately a sibling of BotClient rather than a reimplementation: same
 * predict/reconcile path from `shared`, same snapshot store, same reconcile
 * rule. The bot proves that path in CI; this one makes it visible. Anything
 * this file did differently would make the bot's evidence worthless.
 *
 * Two things it adds that the bot does not need: interpolation buffers for
 * remote entities (the bot has no renderer), and hit events (the bot does not
 * shoot).
 */
import {
  type BotOrder,
  type MissionView,
  type TargetMark,
  COMPONENT_IDS,
  suppressionFromWire,
  ClockSync,
  type DisconnectCode,
  type RosterEntry,
  InterpolationBuffer,
  type InterpResult,
  INTERPOLATION_DELAY_MS,
  type InputFrame,
  MAX_PRIOR_INPUTS,
  type Message,
  type MoveConfig,
  type MoveInput,
  type MoveState,
  PROTOCOL_VERSION,
  INPUT_BUTTONS,
  vaultFromLevels,
  POSITION,
  Predictor,
  SnapshotStore,
  TICK_SECONDS,
  type Transport,
  VELOCITY,
  decodeMessage,
  dequantize,
  encodeMessage,
  type Vitality,
  vitalityFromCode,
  type World,
  getWorld,
} from '@sandline/shared';

const T = COMPONENT_IDS.Transform;
const V = COMPONENT_IDS.Velocity;
const H = COMPONENT_IDS.Health;
const TICK_MS = TICK_SECONDS * 1000;

/** A projectile as this client currently sees it (T-2.32). */
export interface SeenProjectile {
  netId: number;
  /** Index into PROJECTILE_IDS. */
  kind: number;
  /** Squad slot that threw it, which is how a client recognises its own. */
  ownerSlot: number;
  x: number;
  y: number;
  z: number;
  /** Replicated velocity, for pointing a rocket along its flight. */
  vx: number;
  vy: number;
  vz: number;
}

/** A blast, released to the renderer when the render clock reaches its tick. */
/** What a remote soldier has in hand, from their replicated Weapon component. */
export interface RemoteWeapon {
  /** Index into WEAPON_IDS: the gun they carry, in hand or not. */
  index: number;
  reloadProgress: number;
  /** Index into PROJECTILE_IDS while a grenade or rocket is in hand; -1 while the gun is. */
  pouch: number;
}

/**
 * What makes a remote entity an enemy (T-3.11): its replicated `Enemy`
 * component, archetype (an ENEMY_IDS index) and side. Sent once, on the spawn.
 */
export interface RemoteEnemy {
  archetype: number;
  faction: number;
}

export interface ServerDetonation {
  netId: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  targets: readonly { netId: number; damage: number }[];
}

export interface ServerShot {
  shooterNetId: number;
  /** 0 when the shot hit nothing. */
  targetNetId: number;
  x: number;
  y: number;
  z: number;
  /** Where the shot left the barrel: the shooter's rewound eye position (B-01). */
  originX: number;
  originY: number;
  originZ: number;
  damage: number;
}

export interface NetStats {
  joined: boolean;
  netId: number;
  serverTick: number;
  snapshotsApplied: number;
  rejectedDeltas: number;
  missedBaselines: number;
  corrections: number;
  reconciles: number;
  lastDivergence: number;
  peakDivergence: number;
  remotes: number;
  /** Round trip from Ping/Pong, median over the sync window (T-1.10). */
  rttMs: number;
  /** Spread of snapshot inter-arrival times — what interpolation has to absorb. */
  jitterMs: number;
  /**
   * Fraction of snapshot ticks the client never got state for.
   *
   * NOT the injected packet loss, and reads higher than it on purpose. A
   * dropped delta usually takes the NEXT one with it, because that one's
   * baseline is now missing and it has to be rejected — so 5% packet loss
   * showed as 9.8% of ticks unaccounted for. This is the number the client
   * actually experiences, which is the one worth graphing; raw packet loss is
   * already on the slider that caused it.
   */
  snapshotGapRate: number;
  /** Mean bytes per snapshot, against the ADR-012 budget. */
  snapshotBytes: number;
  /**
   * Ticks of interpolation buffer still AHEAD of what is being rendered.
   *
   * Not the sample count, which sits pinned at the ring's capacity forever and
   * says nothing. This is how much runway interpolation has left: it falls
   * toward zero as snapshots stop arriving, and zero is the moment remote
   * entities start extrapolating and then freeze (T-1.16).
   */
  interpAheadTicks: number;
  /**
   * Ticks between the client's running estimate of server time and the newest
   * tick actually received. Grows when snapshots stop arriving.
   */
  tickDrift: number;
  health: number;
  maxHealth: number;
  /** Alive, downed (immobile, bleeding out) or dead (waiting to respawn). */
  vitality: Vitality;
  /** Whole seconds left of the bleed-out or the respawn, from the server. */
  vitalTimer: number;
  reviveProgress: number;
  reviverSlot: number;
}

export class NetClient {
  private readonly store = new SnapshotStore();
  private predictor: Predictor | null = null;
  private readonly buffers = new Map<number, InterpolationBuffer>();
  private netIdValue = -1;
  private slotValue = -1;
  private joinedFlag = false;
  /**
   * Why the host closed the connection, when it said (T-1.5.02).
   *
   * Previously dropped on the floor: on a loopback pair the only sender was
   * this page, so the message carried nothing a tester could act on. On a real
   * socket it is the one thing that distinguishes "the session is full" from
   * "the host went away" from "your build is too old to speak to it" — three
   * situations with three different responses, which look identical from a
   * frozen screen.
   */
  private disconnectReasonValue: string | null = null;
  private disconnectCodeValue: DisconnectCode | null = null;
  private roomValue = '';
  /**
   * The session's named world, built from `JoinAck`'s id by the same function
   * the server used (T-3.02). Null until joined. Prediction collides with it
   * and the renderer draws it.
   */
  private worldValue: World | null = null;
  /**
   * Who is in the six slots, as the host last said (T-1.5.04). Empty until
   * seated; six entries after. The lobby's roster is drawn from this.
   */
  private rosterValue: RosterEntry[] = [];

  private snapshotsApplied = 0;
  private rejectedDeltas = 0;
  private reconciles = 0;
  /**
   * Counted from `result.corrected`, NOT from `Predictor.corrections`.
   *
   * Those two disagree. `Predictor.reconcile` increments its own counter only
   * on the replay path; when the acknowledged tick has aged out of history it
   * snaps straight to authority, returns `corrected: true`, and never counts
   * it. That is the most violent correction there is, so a netgraph fed from
   * the internal counter would under-report precisely the worst case. Raised
   * for T-1.23 rather than changed here: the same counter feeds T-1.22's exit
   * gate, and moving a gate's metric is not a side effect of a client change.
   */
  private correctionCount = 0;
  private lastDivergence = 0;
  private peakDivergence = 0;
  private newestServerMs = 0;
  /**
   * Local estimate of the server's clock, advanced by frame time and pulled
   * forward whenever a fresher snapshot lands. Remote entities render at
   * `this - INTERPOLATION_DELAY_MS` (T-1.16); without a clock that keeps
   * running between snapshots they would step once per arrival instead of
   * moving smoothly.
   */
  private serverClockMs = 0;
  private healthValue = 0;
  private maxHealthValue = 0;
  /** T-3.16: the server's word on how suppressed this player is, 0..1. */
  private suppressionValue = 0;
  /**
   * Replicated with the health (T-2.13). Vitality is gameplay, not cosmetic:
   * the predictor needs it to hold still when the server does (B-05), and the
   * timer is the server's count rather than one started when a zero was
   * first seen.
   */
  private vitalityValue: Vitality = 'alive';
  private vitalTimerValue = 0;
  /** 0..100 authoritative revive hold progress for the local soldier. */
  private reviveProgressValue = 0;
  /** NetId of the teammate currently reviving the local soldier, or 0. */
  private reviverSlotValue = -1;
  /** Each remote soldier's vitality from its newest snapshot, for the pose (T-2.14). */
  private readonly remoteVitalities = new Map<number, Vitality>();
  private readonly remoteReviveProgressValues = new Map<number, number>();
  /** Each remote's weapon index and reload progress 0..1, for the body (T-2.26). */
  private readonly remoteWeapons = new Map<number, RemoteWeapon>();
  /**
   * Projectiles in flight (T-2.32), kept apart from the soldiers.
   *
   * Same interpolation, different list: they are rendered at the same delay as
   * everything else replicated, but a caller asking for "the other players"
   * must not be handed a grenade — `remotes()` builds a soldier's mesh, a pose
   * driver and a foot solver for everything it returns.
   */
  private readonly projectileBuffers = new Map<number, InterpolationBuffer>();
  private readonly projectileInfo = new Map<number, { kind: number; ownerSlot: number; vx: number; vy: number; vz: number }>();
  /** Server time a projectile was last in a snapshot, for retiring its buffer. */
  private readonly projectileGoneAt = new Map<number, number>();
  /**
   * Blasts that have arrived and are not yet due (T-2.33).
   *
   * A Detonation names the tick it happened on, and projectiles are drawn a
   * hundred milliseconds behind server time like every other replicated thing.
   * Drawing the blast on arrival would put it a tenth of a second in front of
   * a grenade the player can still see in the air, so it waits here until the
   * render clock reaches its tick.
   */
  private readonly pendingDetonations: { dueAtMs: number; event: ServerDetonation }[] = [];
  private readonly remoteReviverSlots = new Map<number, number>();
  private readonly remoteSlots = new Map<number, number>();
  /**
   * Remotes carrying an `Enemy` component (T-3.11). An enemy is interpolated
   * and drawn exactly as a remote soldier is — same buffer, same rig — so it
   * lives in the same list; this is what tells the renderer to paint it as
   * the other side, and what keeps it out of anything keyed by slot. It never
   * gets a `remoteSlots` entry: enemies carry no PlayerSlot.
   */
  private readonly remoteEnemies = new Map<number, RemoteEnemy>();
  /**
   * Every bot's current order and every standing mark, as the host last
   * broadcast them whole (T-3.27). What this client sent is not here until
   * the host says so: the markers show what the squad is doing, not what it
   * was asked (T-3.29).
   */
  private ordersValue: readonly BotOrder[] = [];
  private marksValue: readonly TargetMark[] = [];
  /** T-3.34: where the mission stands, as the host last said; null with none. */
  private missionValue: MissionView | null = null;
  /**
   * Server time a remote soldier or enemy was last in a snapshot (T-3.11).
   * The six slots never leave, but an enemy's corpse despawns, and T-3.12's
   * relevance radius will take entities in and out of view. Like a
   * projectile, it is drawn until the render clock catches up with the last
   * place the server put it, and forgotten a while after.
   */
  private readonly remoteGoneAt = new Map<number, number>();
  /** Local time the newest snapshot landed, for anchoring the server clock. */
  private lastArrivalAt = 0;

  /* -- Link health, for the netgraph (T-1.23) ----------------------------- */
  private readonly clock = new ClockSync();
  private lastPingAt = 0;
  private rttEstimate = 0;
  /** Arrival times of recent snapshots, for inter-arrival jitter. */
  private readonly arrivals: number[] = [];
  private jitterEstimate = 0;
  private bytesTotal = 0;
  private snapshotsForBytes = 0;
  /** Newest tick seen, and how many ticks were skipped, for a loss estimate. */
  private highestTick = -1;
  private ticksExpected = 0;
  private ticksMissing = 0;

  /**
   * The last few inputs sent, newest first, resent in each packet so a dropped
   * one costs nothing (see the Fire/Input protocol notes).
   */
  private readonly recentInputs: InputFrame[] = [];

  /** Authoritative shot outcomes. Set by the renderer to draw tracers. */
  onShot: ((shot: ServerShot) => void) | null = null;
  /**
   * A blast, at the moment the render clock reaches the tick it happened on.
   * Never at the moment it arrives — see `pendingDetonations`.
   */
  onDetonation: ((event: ServerDetonation) => void) | null = null;
  /** Seated in a slot. Remote sessions surface this in the HUD (T-1.5.02). */
  onJoined: ((slot: number, room: string) => void) | null = null;
  /** The host said goodbye, and why — typed, so the UI can act on it. */
  onDisconnect: ((reason: string, code: DisconnectCode) => void) | null = null;
  /** The squad changed. */
  onRoster: ((slots: RosterEntry[]) => void) | null = null;
  /** T-3.09: an AI debug report, from a host that allows them, after `requestAiDebug(true)`. */
  onAiDebug: ((report: Extract<Message, { kind: 'AiDebug' }>) => void) | null = null;
  private aiDebugWanted = false;

  constructor(
    private readonly transport: Transport,
    private readonly name: string,
    /**
     * Shared with the server's session by reference, so the movement tuning
     * panel cannot move one without the other. Two configs that drifted would
     * mispredict every tick.
     */
    private readonly moveConfig?: MoveConfig,
  ) {
    transport.onMessage((bytes) => this.handle(bytes));
  }

  get netId(): number {
    return this.netIdValue;
  }

  /** Squad slot the host seated us in, or -1. ADR-001: always 0..5. */
  get slot(): number {
    return this.slotValue;
  }

  get disconnectReason(): string | null {
    return this.disconnectReasonValue;
  }

  get disconnectCode(): DisconnectCode | null {
    return this.disconnectCodeValue;
  }

  /** The room code the host seated us in; empty on an in-page session. */
  /** The world the host named in `JoinAck`, or null before a join. */
  get world(): World | null {
    return this.worldValue;
  }

  get room(): string {
    return this.roomValue;
  }

  get roster(): readonly RosterEntry[] {
    return this.rosterValue;
  }

  /** Every bot's current order, from the host's last `Orders` broadcast. */
  get orders(): readonly BotOrder[] {
    return this.ordersValue;
  }

  /** T-3.34: the mission, from the host's last `Mission` message; null when it has none. */
  get mission(): MissionView | null {
    return this.missionValue;
  }

  /** Every standing mark, from the host's last `Marks` broadcast. */
  get marks(): readonly TargetMark[] {
    return this.marksValue;
  }

  get joined(): boolean {
    return this.joinedFlag;
  }

  get stats(): NetStats {
    return {
      joined: this.joinedFlag,
      netId: this.netIdValue,
      serverTick: Math.round(this.newestServerMs / TICK_MS),
      snapshotsApplied: this.snapshotsApplied,
      rejectedDeltas: this.rejectedDeltas,
      missedBaselines: this.store.missedBaselines,
      corrections: this.correctionCount,
      reconciles: this.reconciles,
      lastDivergence: this.lastDivergence,
      peakDivergence: this.peakDivergence,
      remotes: this.buffers.size,
      rttMs: this.rttEstimate,
      jitterMs: this.jitterEstimate,
      snapshotGapRate: this.ticksExpected === 0 ? 0 : this.ticksMissing / this.ticksExpected,
      snapshotBytes: this.snapshotsForBytes === 0 ? 0 : this.bytesTotal / this.snapshotsForBytes,
      interpAheadTicks: this.interpAhead(),
      tickDrift: Math.max(0, Math.round(this.serverClockMs / TICK_MS) - this.highestTick),
      health: this.healthValue,
      maxHealth: this.maxHealthValue,
      vitality: this.vitalityValue,
      vitalTimer: this.vitalTimerValue,
      reviveProgress: this.reviveProgressValue,
      reviverSlot: this.reviverSlotValue,
    };
  }

  /** On their feet, downed and immobile, or waiting to respawn — the server's word. */
  get vitality(): Vitality {
    return this.vitalityValue;
  }

  /** How suppressed the server says this player is, 0..1, as replicated (T-3.16). */
  get suppression(): number {
    return this.suppressionValue;
  }

  get reviveProgress(): number {
    return this.reviveProgressValue;
  }

  get reviverSlot(): number {
    return this.reviverSlotValue;
  }

  remoteSlot(netId: number): number {
    return this.remoteSlots.get(netId) ?? -1;
  }

  /** The remote's `Enemy` component, or null for anything that is not an enemy — every slot included (T-3.11). */
  remoteEnemy(netId: number): RemoteEnemy | null {
    return this.remoteEnemies.get(netId) ?? null;
  }

  remoteReviveProgress(netId: number): number {
    return this.remoteReviveProgressValues.get(netId) ?? 0;
  }

  /** The weapon a remote holds and how far through a reload it is (T-2.26). */
  remoteWeapon(netId: number): RemoteWeapon {
    return this.remoteWeapons.get(netId) ?? { index: 0, reloadProgress: 0, pouch: -1 };
  }

  /** NetId of the downed teammate this client is currently reviving, or 0. */
  get reviveTargetNetId(): number {
    let best = 0;
    let progress = 0;
    for (const [netId, reviverSlot] of this.remoteReviverSlots) {
      // Nobody revives an enemy (T-3.11): it never goes down, and it is not
      // a teammate for the HUD's revive prompt to name.
      if (reviverSlot !== this.slotValue || this.remoteEnemies.has(netId)) continue;
      const p = this.remoteReviveProgressValues.get(netId) ?? 0;
      if (p >= progress) {
        progress = p;
        best = netId;
      }
    }
    return best;
  }

  /** Handshake. An empty room asks the host to create one (T-1.5.04). */
  join(room = '', key = ''): void {
    this.transport.send(
      encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: this.name, room, ...(key === '' ? {} : { key }) }),
    );
  }

  /**
   * Say goodbye rather than just closing the socket, so the host frees the
   * slot on the spot instead of after the heartbeat timeout — a leaving
   * player's row in everyone else's roster flips back to bot immediately.
   */
  /** End the connection from this side with a typed reason the UI can act on. */
  private refuse(code: DisconnectCode, reason: string): void {
    if (this.transport.isOpen) this.transport.send(encodeMessage({ kind: 'Disconnect', code, reason }));
    this.joinedFlag = false;
    this.disconnectReasonValue = reason;
    this.disconnectCodeValue = code;
    this.onDisconnect?.(reason, code);
    this.transport.close(code);
  }

  leave(): void {
    if (this.transport.isOpen) {
      this.transport.send(encodeMessage({ kind: 'Disconnect', code: 'left', reason: 'left' }));
    }
    this.joinedFlag = false;
    this.transport.close('left');
  }

  /**
   * Forget everything about the last connection, before handshaking again.
   *
   * A reconnect is not a resumption. The host hands a dropped player's entity
   * back to a bot the moment the socket closes, so a returning client gets a
   * NEW slot and a NEW NetId — and every piece of state below is about the old
   * one. Keeping the predictor would reconcile our position against a soldier
   * that now belongs to somebody else; keeping the snapshot store would decode
   * the first delta against a baseline from a session we are no longer in,
   * producing world state that is plausible and wrong, which is the one failure
   * mode `SnapshotStore` exists to refuse (see its missed-baseline path).
   *
   * Link-health counters are deliberately NOT reset: RTT, jitter and the
   * snapshot gap rate describe the network between here and the host, and that
   * did not change because a socket did. A tester watching the netgraph through
   * a drop wants the trend, not a fresh graph.
   */
  resetForRejoin(): void {
    this.store.reset();
    this.predictor = null;
    this.buffers.clear();
    this.netIdValue = -1;
    this.slotValue = -1;
    this.joinedFlag = false;
    this.disconnectReasonValue = null;
    this.disconnectCodeValue = null;
    this.roomValue = '';
    this.worldValue = null;
    this.rosterValue = [];
    this.healthValue = 0;
    this.maxHealthValue = 0;
    this.suppressionValue = 0;
    this.vitalityValue = 'alive';
    this.vitalTimerValue = 0;
    this.reviveProgressValue = 0;
    this.reviverSlotValue = -1;
    this.remoteVitalities.clear();
    this.remoteReviveProgressValues.clear();
    this.remoteWeapons.clear();
    this.projectileBuffers.clear();
    this.projectileInfo.clear();
    this.projectileGoneAt.clear();
    this.pendingDetonations.length = 0;
    this.remoteReviverSlots.clear();
    this.remoteSlots.clear();
    this.remoteEnemies.clear();
    this.remoteGoneAt.clear();
    this.ordersValue = [];
    this.marksValue = [];
    this.missionValue = null;
    this.recentInputs.length = 0;
    this.newestServerMs = 0;
    this.serverClockMs = 0;
    this.highestTick = -1;
  }

  /** Predict one tick locally and send the input. Unreliable: a lost input is
   *  covered by the server's repeat-then-idle rule, and resending stale input
   *  would be worse than dropping it. */
  tick(tickNumber: number, input: MoveInput, pitch: number): void {
    if (!this.joinedFlag || !this.predictor) return;
    // The server holds a downed soldier still whatever buttons arrive; predict
    // the same, or every tick down is a correction (T-2.13, B-05).
    const predicted = this.vitalityValue === 'downed' ? { ...input, downed: true } : input;
    this.predictor.predict(tickNumber, predicted);
    const buttons =
      (input.jump ? INPUT_BUTTONS.jump : 0) |
      (input.sprint ? INPUT_BUTTONS.sprint : 0) |
      (input.crouch ? INPUT_BUTTONS.crouch : 0) |
      (input.interact ? INPUT_BUTTONS.interact : 0) |
      (input.firing ? INPUT_BUTTONS.fire : 0) |
      (input.prone ? INPUT_BUTTONS.prone : 0);
    this.transport.send(
      encodeMessage({
        kind: 'Input',
        tick: tickNumber,
        moveX: input.moveX,
        moveY: input.moveY,
        yaw: input.yaw,
        pitch,
        buttons,
        prior: this.recentInputs.slice(0, MAX_PRIOR_INPUTS),
      }),
      'unreliable',
    );
    this.recentInputs.unshift({
      tick: tickNumber,
      moveX: input.moveX,
      moveY: input.moveY,
      yaw: input.yaw,
      pitch,
      buttons,
    });
    if (this.recentInputs.length > MAX_PRIOR_INPUTS) this.recentInputs.length = MAX_PRIOR_INPUTS;
  }

  /**
   * Pull the trigger. Reliable: a dropped shot is a shot the player took and
   * never got, which is far more noticeable than a dropped movement input.
   *
   * `renderTimeMs` is what the server rewinds hitboxes to, so it must be the
   * time this client was actually RENDERING — the interpolated past, not now.
   */
  fire(tick: number, yaw: number, pitch: number, weapon: number, ads: boolean): void {
    if (!this.joinedFlag) return;
    this.transport.send(
      encodeMessage({
        kind: 'Fire',
        tick,
        yaw,
        pitch,
        renderTimeMs: Math.max(0, Math.round(this.serverClockMs - INTERPOLATION_DELAY_MS)),
        weapon,
        ads,
      }),
      'reliable',
    );
  }

  /**
   * Throw a projectile (T-2.32). Reliable, like Fire, and for the same reason:
   * a dropped throw is a grenade the player spent and never got.
   *
   * No render time. The server does not rewind a projectile's spawn — see the
   * Throw message's note — so there is nothing to claim about when we were.
   */
  throwProjectile(tick: number, yaw: number, pitch: number, projectile: number): void {
    if (!this.joinedFlag) return;
    this.transport.send(encodeMessage({ kind: 'Throw', tick, yaw, pitch, projectile }), 'reliable');
  }

  /**
   * Say what is in the hands: a loadout index, guns first and then the pouch.
   * Reliable, and once per switch — it is what the rest of the squad sees
   * held, and a lost one would leave them watching the wrong weapon.
   */
  equip(item: number): void {
    if (!this.joinedFlag) return;
    this.transport.send(encodeMessage({ kind: 'Equip', item }), 'reliable');
  }

  /**
   * Ask for AI debug reports, or stop them (T-3.09). Reliable: a lost request
   * would leave the overlay blank, or the host sending to a client that no
   * longer draws it. A host without `AI_DEBUG=1` ignores it.
   *
   * The wish outlives the connection: asked before seating, or across a
   * rejoin, it is sent on the next JoinAck, since a host forgets a client's
   * request with its slot.
   */
  requestAiDebug(on: boolean): void {
    this.aiDebugWanted = on;
    if (!this.joinedFlag) return;
    this.transport.send(encodeMessage({ kind: 'AiDebugRequest', on }), 'reliable');
  }

  /**
   * Give an order (T-3.29), built by the wheel. Reliable: a lost order is a
   * squad that never moved. The host decides whether it stands and says so
   * in `Orders`.
   */
  order(msg: Extract<Message, { kind: 'Order' }>): void {
    if (!this.joinedFlag) return;
    this.transport.send(encodeMessage(msg), 'reliable');
  }

  /** T-3.34: ask the host to start the mission again. It does so once the mission is over. */
  restartMission(): void {
    if (!this.joinedFlag) return;
    this.transport.send(encodeMessage({ kind: 'MissionRestart' }), 'reliable');
  }

  /** Mark a point or an enemy (T-3.29). Reliable, like an order. */
  mark(msg: Extract<Message, { kind: 'Mark' }>): void {
    if (!this.joinedFlag) return;
    this.transport.send(encodeMessage(msg), 'reliable');
  }

  /** Every projectile in flight, sampled at the interpolation delay. */
  projectiles(): SeenProjectile[] {
    const out: SeenProjectile[] = [];
    const renderAt = this.serverClockMs - INTERPOLATION_DELAY_MS;
    for (const [netId, buffer] of this.projectileBuffers) {
      // Gone from the world: keep drawing it only until the render clock has
      // caught up with the last place the server put it.
      const goneAt = this.projectileGoneAt.get(netId);
      if (goneAt !== undefined && renderAt > goneAt) continue;
      const sample = buffer.sample(renderAt);
      const info = this.projectileInfo.get(netId);
      if (!sample || !info) continue;
      out.push({
        netId,
        kind: info.kind,
        ownerSlot: info.ownerSlot,
        x: sample.x,
        y: sample.y,
        z: sample.z,
        vx: info.vx,
        vy: info.vy,
        vz: info.vz,
      });
    }
    return out;
  }

  /**
   * Send a heartbeat if one is due. Once a second is plenty for a median over
   * sixteen samples, and it doubles as the keep-alive the server's timeout
   * expects.
   */
  private maybePing(nowMs: number): void {
    // Four a second. A sixteen-sample median at 1 Hz takes sixteen seconds to
    // follow a change, which for an instrument you are watching while dragging
    // a slider is useless; at 250 ms it settles in about four.
    if (nowMs - this.lastPingAt < 250) return;
    this.lastPingAt = nowMs;
    const ping = this.clock.beginPing(nowMs);
    this.transport.send(
      encodeMessage({ kind: 'Ping', id: ping.id, clientTime: ping.clientTime }),
      'unreliable',
    );
  }

  /** Advance the local view of server time. Call once per frame. */
  advanceClock(frameMs: number): void {
    const now = performance.now();
    this.maybePing(now);

    /**
     * Server time is ANCHORED ON ARRIVALS: the newest tick we have heard about,
     * plus however long ago we heard it.
     *
     * Two wrong versions preceded this. The first free-ran — advanced every
     * frame, snapped forward on a fresher snapshot, and had nothing able to
     * pull it back, so it drifted steadily ahead of the data and dragged the
     * interpolation render time past the newest buffered sample. Remote players
     * then extrapolated continuously instead of interpolating, which is the
     * failure T-1.16's extrapolation cap exists to BOUND, not a state to live
     * in.
     *
     * The second tried to use the clock sync's offset, which is wrong for a
     * subtler reason worth writing down: that offset estimates the server's
     * `performance.now()`, while snapshot times are `tick * TICK_MS` counting
     * from zero. Same rate, different origins, so the estimate sat a whole
     * startup-offset ahead and the symptom did not change at all. Clock sync is
     * the right tool for round-trip time and the wrong one for this.
     *
     * Re-anchoring on every arrival cannot drift, because the only thing it
     * extrapolates is the gap since the last packet — which is exactly the
     * quantity that SHOULD eat into interpolation runway when snapshots stop.
     */
    if (this.lastArrivalAt > 0) {
      this.serverClockMs = this.newestServerMs + (now - this.lastArrivalAt);
    } else {
      this.serverClockMs += frameMs;
    }

    this.flushDetonations();
    this.forgetStaleProjectiles();
    this.forgetStaleRemotes();
  }

  /** Release every blast the render clock has now reached, oldest first. */
  private flushDetonations(): void {
    if (this.pendingDetonations.length === 0) return;
    const renderAt = this.serverClockMs - INTERPOLATION_DELAY_MS;
    let i = 0;
    while (i < this.pendingDetonations.length) {
      const pending = this.pendingDetonations[i];
      if (pending === undefined || pending.dueAtMs > renderAt) {
        i += 1;
        continue;
      }
      this.pendingDetonations.splice(i, 1);
      this.onDetonation?.(pending.event);
    }
  }

  /**
   * Drop the buffers of projectiles that left the world a while ago. Held past
   * the render clock rather than deleted on the spot, because the snapshot that
   * removes one arrives an interpolation delay before it stops being drawn.
   */
  private forgetStaleProjectiles(): void {
    if (this.projectileGoneAt.size === 0) return;
    const horizon = this.serverClockMs - INTERPOLATION_DELAY_MS * 4;
    for (const [netId, goneAt] of this.projectileGoneAt) {
      if (goneAt > horizon) continue;
      this.projectileGoneAt.delete(netId);
      this.projectileBuffers.delete(netId);
      this.projectileInfo.delete(netId);
    }
  }

  /**
   * Drop everything held about a remote that left the world a while ago
   * (T-3.11): its buffer and every per-entity state beside it, so a despawned
   * enemy leaves nothing behind in this client. Same horizon as projectiles.
   */
  private forgetStaleRemotes(): void {
    if (this.remoteGoneAt.size === 0) return;
    const horizon = this.serverClockMs - INTERPOLATION_DELAY_MS * 4;
    for (const [netId, goneAt] of this.remoteGoneAt) {
      if (goneAt > horizon) continue;
      this.remoteGoneAt.delete(netId);
      this.buffers.delete(netId);
      this.remoteVitalities.delete(netId);
      this.remoteReviveProgressValues.delete(netId);
      this.remoteReviverSlots.delete(netId);
      this.remoteWeapons.delete(netId);
      this.remoteSlots.delete(netId);
      this.remoteEnemies.delete(netId);
    }
  }

  /** How many remotes this client holds any state for, drawn or not. Tests watch it drain. */
  get remotesHeld(): number {
    return this.buffers.size;
  }

  /** Smoothed local position, or null before the first authoritative state. */
  renderPosition(frameMs: number): { x: number; y: number; z: number } | null {
    return this.predictor ? this.predictor.renderPosition(frameMs) : null;
  }

  get simulated(): MoveState | null {
    return this.predictor?.simulated ?? null;
  }

  /** A remote soldier's vitality, as of their newest snapshot. Not interpolated: a state, not a position. */
  remoteVitality(netId: number): Vitality {
    return this.remoteVitalities.get(netId) ?? 'alive';
  }

  /**
   * Every remote soldier and enemy, sampled at the interpolation delay. One
   * that has left the world is still returned until the render clock passes
   * the last snapshot that had it, and never after (T-3.11).
   */
  remotes(): Map<number, InterpResult> {
    const out = new Map<number, InterpResult>();
    const renderAt = this.serverClockMs - INTERPOLATION_DELAY_MS;
    for (const [netId, buffer] of this.buffers) {
      const goneAt = this.remoteGoneAt.get(netId);
      if (goneAt !== undefined && renderAt > goneAt) continue;
      const sample = buffer.sample(renderAt);
      if (sample) out.set(netId, sample);
    }
    return out;
  }

  private handle(bytes: Uint8Array): void {
    let msg: Message;
    try {
      msg = decodeMessage(bytes);
    } catch {
      this.rejectedDeltas++;
      return;
    }

    switch (msg.kind) {
      case 'JoinAck': {
        const world = getWorld(msg.world);
        if (!world) {
          // A world this build does not have: refuse, typed, rather than draw
          // the wrong scenery and predict against boxes the server does not
          // collide with. Never counted as joined.
          this.refuse('unknown world', `host named world '${msg.world}', which this build does not have — reload for a newer build`);
          break;
        }
        this.worldValue = world;
        this.netIdValue = msg.netId;
        this.slotValue = msg.slot;
        this.roomValue = msg.room;
        this.joinedFlag = true;
        if (this.aiDebugWanted) this.transport.send(encodeMessage({ kind: 'AiDebugRequest', on: true }), 'reliable');
        this.onJoined?.(msg.slot, msg.room);
        // The predictor is NOT created here, for the reason BotClient gives:
        // JoinAck does not say where we spawned, and assuming the origin
        // guarantees a large bogus correction on the first snapshot.
        break;
      }

      case 'Delta': {
        const result = this.store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
        if (!result.ok || !result.snapshot) {
          this.rejectedDeltas++;
          return;
        }
        this.snapshotsApplied++;
        this.bytesTotal += bytes.length;
        this.snapshotsForBytes += 1;
        this.observeArrival(msg.tick, performance.now());
        this.transport.send(encodeMessage({ kind: 'Ack', tick: msg.tick }), 'unreliable');

        const serverMs = msg.tick * TICK_MS;
        if (serverMs > this.newestServerMs) {
          this.newestServerMs = serverMs;
          this.lastArrivalAt = performance.now();
        }
        this.ingest(result.snapshot.entities, msg.tick, serverMs, msg.lastProcessedInputTick);
        break;
      }

      case 'Pong': {
        const sample = this.clock.acceptPong(msg.id, msg.serverTime, performance.now());
        // The MEDIAN over the window, not this sample: one late pong on a
        // jittery link should not make the graph jump.
        if (sample) this.rttEstimate = this.clock.rtt;
        break;
      }

      case 'Disconnect':
        this.disconnectReasonValue = msg.reason;
        this.disconnectCodeValue = msg.code;
        this.joinedFlag = false;
        this.onDisconnect?.(msg.reason, msg.code);
        break;

      case 'Roster':
        this.rosterValue = msg.slots;
        this.onRoster?.(msg.slots);
        break;

      case 'Detonation':
        // Queued, not drawn: the tick it names is in the future of what this
        // client is currently rendering (T-2.33).
        this.pendingDetonations.push({
          dueAtMs: msg.tick * TICK_MS,
          event: {
            netId: msg.netId,
            kind: msg.projectile,
            x: msg.x,
            y: msg.y,
            z: msg.z,
            targets: msg.targets,
          },
        });
        break;

      case 'AiDebug':
        this.onAiDebug?.(msg);
        break;

      case 'Orders':
        this.ordersValue = msg.orders;
        break;

      case 'Marks':
        this.marksValue = msg.marks;
        break;

      case 'Mission': {
        const { kind: _kind, ...view } = msg;
        this.missionValue = view;
        break;
      }

      case 'HitEvent':
        this.onShot?.({
          shooterNetId: msg.shooterNetId,
          targetNetId: msg.targetNetId,
          x: msg.x,
          y: msg.y,
          z: msg.z,
          originX: msg.originX,
          originY: msg.originY,
          originZ: msg.originZ,
          damage: msg.damage,
        });
        break;

      default:
        break;
    }
  }

  /**
   * Track snapshot arrival for jitter and loss.
   *
   * Loss is inferred from GAPS IN TICK NUMBERS, not from a counter the server
   * sends: the server has no idea what failed to arrive, and a client that
   * trusted it would report a perfect link on a broken one. Jitter is the mean
   * absolute deviation of inter-arrival times from the tick period — the
   * quantity interpolation actually has to absorb, rather than the variation in
   * round trip that a ping measures.
   */
  /** Buffer runway: newest buffered tick minus the tick being rendered. */
  private interpAhead(): number {
    if (this.buffers.size === 0) return 0;
    const renderTick = (this.serverClockMs - INTERPOLATION_DELAY_MS) / TICK_MS;
    let best = 0;
    for (const buffer of this.buffers.values()) {
      const ahead = buffer.newestTick - renderTick;
      if (ahead > best) best = ahead;
    }
    return Math.round(best);
  }

  private observeArrival(tick: number, atMs: number): void {
    if (this.highestTick >= 0 && tick > this.highestTick) {
      const skipped = tick - this.highestTick - 1;
      this.ticksExpected += skipped + 1;
      this.ticksMissing += skipped;
    } else if (this.highestTick < 0) {
      this.ticksExpected += 1;
    }
    if (tick > this.highestTick) this.highestTick = tick;

    this.arrivals.push(atMs);
    if (this.arrivals.length > 32) this.arrivals.shift();
    if (this.arrivals.length >= 3) {
      let total = 0;
      for (let i = 1; i < this.arrivals.length; i += 1) {
        total += Math.abs((this.arrivals[i] as number) - (this.arrivals[i - 1] as number) - TICK_MS);
      }
      this.jitterEstimate = total / (this.arrivals.length - 1);
    }
  }

  private ingest(
    entities: readonly { netId: number; components: Record<number, readonly number[]> }[],
    tick: number,
    serverMs: number,
    lastProcessedInputTick: number,
  ): void {
    const projectilesSeen = new Set<number>();
    const remotesSeen = new Set<number>();
    for (const entity of entities) {
      const transform = entity.components[T];
      if (!transform) continue;

      const x = dequantize(transform[0] as number, POSITION);
      const y = dequantize(transform[1] as number, POSITION);
      const z = dequantize(transform[2] as number, POSITION);

      /**
       * A projectile, not a soldier (T-2.32). Branching on the component is
       * what makes a grenade a grenade here: netIds are opaque, and an entity
       * that fell into the remote list would be handed a humanoid mesh, a pose
       * driver and a foot solver by the renderer.
       */
      const projectile = entity.components[COMPONENT_IDS.Projectile];
      if (projectile) {
        projectilesSeen.add(entity.netId);
        this.projectileGoneAt.delete(entity.netId);
        let buffer = this.projectileBuffers.get(entity.netId);
        if (!buffer) {
          buffer = new InterpolationBuffer();
          this.projectileBuffers.set(entity.netId, buffer);
        }
        buffer.push({ tick, serverTimeMs: serverMs, x, y, z, yaw: 0, crouched: false, prone: false });
        const velocity = entity.components[V];
        this.projectileInfo.set(entity.netId, {
          kind: (projectile[0] as number | undefined) ?? 0,
          ownerSlot: (projectile[1] as number | undefined) ?? 0,
          vx: velocity ? dequantize(velocity[0] as number, VELOCITY) : 0,
          vy: velocity ? dequantize(velocity[1] as number, VELOCITY) : 0,
          vz: velocity ? dequantize(velocity[2] as number, VELOCITY) : 0,
        });
        continue;
      }

      const playerSlot = entity.components[COMPONENT_IDS.PlayerSlot];
      const crouch = entity.components[COMPONENT_IDS.Crouch];
      if (playerSlot) this.remoteSlots.set(entity.netId, playerSlot[0] as number);

      if (entity.netId === this.netIdValue) {
        const health = entity.components[H];
        if (health) {
          this.healthValue = health[0] as number;
          this.maxHealthValue = health[1] as number;
          this.vitalityValue = vitalityFromCode((health[2] as number | undefined) ?? 0);
          this.vitalTimerValue = (health[3] as number | undefined) ?? 0;
          this.reviveProgressValue = (health[4] as number | undefined) ?? 0;
          const encodedReviverSlot = (health[5] as number | undefined) ?? 0;
          this.reviverSlotValue = encodedReviverSlot === 0 ? -1 : encodedReviverSlot - 1;
        }
        const suppression = entity.components[COMPONENT_IDS.Suppression];
        if (suppression) this.suppressionValue = suppressionFromWire((suppression[0] as number | undefined) ?? 0);
        const velocity = entity.components[V];
        this.reconcile(
          {
            x,
            y,
            z,
            vy: velocity ? dequantize(velocity[1] as number, VELOCITY) : 0,
            // Derived rather than replicated, as in BotClient: height already
            // answers the question and a dedicated bit would not pay for itself.
            grounded: y <= 0.001,
            crouched: (crouch?.[0] as number | undefined) === 1,
            prone: (crouch?.[1] as number | undefined) === 1,
            // Mid-vault the authoritative state is airborne with no velocity;
            // without the vault itself a replay would drop out of it (T-2.21).
            vault: vaultFromLevels(entity.components[COMPONENT_IDS.Vault]),
          },
          lastProcessedInputTick,
        );
        continue;
      }

      remotesSeen.add(entity.netId);
      this.remoteGoneAt.delete(entity.netId);
      const enemy = entity.components[COMPONENT_IDS.Enemy];
      if (enemy) {
        this.remoteEnemies.set(entity.netId, {
          archetype: (enemy[0] as number | undefined) ?? 0,
          faction: (enemy[1] as number | undefined) ?? 0,
        });
      }
      let buffer = this.buffers.get(entity.netId);
      if (!buffer) {
        buffer = new InterpolationBuffer();
        this.buffers.set(entity.netId, buffer);
      }
      buffer.push({
        tick,
        serverTimeMs: serverMs,
        x,
        y,
        z,
        yaw: (transform[3] as number) & 0x3ff,
        // The aim pitch the server traces their shots along, for the body to
        // point its rifle the same way (T-2.25).
        pitch: ((transform[4] as number | undefined) ?? 0) & 0x3ff,
        crouched: (crouch?.[0] as number | undefined) === 1,
        prone: (crouch?.[1] as number | undefined) === 1,
        // The same replicated vault the local predictor continues from, so a
        // remote's vault pose runs on the state its position does (T-2.23).
        vaultElapsed: vaultFromLevels(entity.components[COMPONENT_IDS.Vault])?.elapsed ?? null,
      });
      const weapon = entity.components[COMPONENT_IDS.Weapon];
      if (weapon) {
        this.remoteWeapons.set(entity.netId, {
          index: (weapon[0] as number | undefined) ?? 0,
          reloadProgress: ((weapon[1] as number | undefined) ?? 0) / 100,
          pouch: ((weapon[2] as number | undefined) ?? 0) - 1,
        });
      }
      const health = entity.components[H];
      if (health) {
        this.remoteVitalities.set(entity.netId, vitalityFromCode((health[2] as number | undefined) ?? 0));
        this.remoteReviveProgressValues.set(entity.netId, (health[4] as number | undefined) ?? 0);
        const encodedReviverSlot = (health[5] as number | undefined) ?? 0;
        this.remoteReviverSlots.set(entity.netId, encodedReviverSlot === 0 ? -1 : encodedReviverSlot - 1);
      }
    }

    /**
     * Anything that was a projectile and is no longer in the world has gone
     * off. Note WHEN rather than forgetting it: it is still being drawn, a
     * hundred milliseconds behind, and the blast that replaces it is waiting
     * on the same clock.
     */
    for (const netId of this.projectileBuffers.keys()) {
      if (projectilesSeen.has(netId) || this.projectileGoneAt.has(netId)) continue;
      this.projectileGoneAt.set(netId, serverMs);
    }
    // The same for a remote soldier or enemy: a despawned corpse (T-3.11).
    for (const netId of this.buffers.keys()) {
      if (remotesSeen.has(netId) || this.remoteGoneAt.has(netId)) continue;
      this.remoteGoneAt.set(netId, serverMs);
    }
  }

  private reconcile(authoritative: MoveState, lastProcessedInputTick: number): void {
    if (!this.predictor) {
      this.predictor = new Predictor(authoritative, this.moveConfig, undefined, this.worldValue?.boxes);
      return;
    }
    if (lastProcessedInputTick < 0) return;
    const result = this.predictor.reconcile(lastProcessedInputTick, authoritative);
    this.reconciles++;
    if (result.corrected) this.correctionCount++;
    this.lastDivergence = result.error;
    if (result.error > this.peakDivergence) this.peakDivergence = result.error;
  }
}

/**
 * Authoritative session and tick loop (T-1.13, ADR-012).
 *
 * Fixed 30 Hz: drain inputs, step the simulation, build a per-client delta
 * against that client's last acknowledged tick, broadcast. What each client is
 * sent is the part of the world within its relevance radius (T-3.12,
 * `relevance.ts`), and its baselines are the views it was sent.
 *
 * ADR-001: six slots, always. Unfilled slots are bots, so a joining player
 * takes over an existing entity rather than spawning a new one, and a leaving
 * player hands theirs back. The world never changes shape, which is what makes
 * drop-in/drop-out an entity swap instead of a session rebuild.
 *
 * Time is injected, never read, so the whole loop is testable without timers.
 */
import {
  BitWriter,
  COMPONENT_IDS,
  DEFAULT_MOVE_CONFIG,
  ESCORT_SPECTATE_SLOT,
  MAX_SLOTS,
  type MoveConfig,
  RANGE_TARGETS,
  type Message,
  type XpEvent,
  type MoveInput,
  type MoveState,
  POSITION,
  type RosterEntry,
  ServerConnection,
  VELOCITY,
  TICK_SECONDS,
  type Transport,
  type WorldSnapshot,
  WEAPON_IDS,
  type WeaponDef,
  type WeaponState,
  type Shot,
  DEFAULT_WORLD_ID,
  type World,
  requireWorld,
  FIRST_PROJECTILE_NET_ID,
  FIRST_PICKUP_NET_ID,
  PICKUPS,
  PICKUP_AMMO_BITS,
  pickupProjectile,
  PICKUP_NET_ID_LIMIT,
  PROJECTILE_IDS,
  POUCH_COUNT_MAX,
  AMMO_MAX,
  type ProjectileDef,
  type ProjectileState,
  type ProjectileWorld,
  blastDamageOn,
  createProjectileState,
  getProjectile,
  dirFromYawPitch,
  rayWorld,
  projectileByIndex,
  stepProjectile,
  tableToWire,
  WIRE_TO_TABLE_SHIFT,
  type EmplacementDef,
  type HeatState,
  type PlacedEmplacement,
  canFireHot,
  clampPitch,
  clampYawToArc,
  coolHeat,
  createHeat,
  emplacementFacing,
  emplacementIndex,
  getEmplacement,
  gunMuzzle,
  gunnerPlace,
  heatShot,
  heatToWire,
  signedWire,
  withinArc,
  sin,
  cos,
  type Hea…65469 tokens truncated….
      let target: Slot | null = null;
      let point: { x: number; y: number; z: number } | null = null;
      if (enemy.tell) {
        const locked = this.slots.find((s) => s.netId === enemy.tell!.netId);
        if (locked && isAlive(locked.health)) {
          target = locked;
          point = enemy.tell.point;
        } else enemy.tell = null;
      }
      if (!target) {
        let bestD = cannon.rangeM * cannon.rangeM;
        for (const slot of this.slots) {
          if (!isAlive(slot.health)) continue;
          const d = (slot.state.x - enemy.state.x) ** 2 + (slot.state.z - enemy.state.z) ** 2;
          if (d >= bestD) continue;
          const seen = visibleAimPoint(eye, aimPoints(slot.state, slot.state.crouched, slot.state.prone, DEFAULT_HITBOX, lyingPose(slot)), this.collisionBoxes);
          if (!seen) continue;
          bestD = d;
          target = slot;
          point = seen;
        }
      }

      // The turret: onto the target's bearing, or back to the hull's.
      const wantYaw = point ? tableToWire(aimAngles(eye, point).yaw) : enemy.yaw;
      const rate = Math.max(1, Math.round(((vehicle.turretTurnDegPerSec / 360) * 1024) * TICK_SECONDS));
      const off = ((wantYaw - enemy.turretYaw + 1536) & 1023) - 512;
      enemy.turretYaw = (enemy.turretYaw + Math.max(-rate, Math.min(rate, off)) + 1024) & 1023;
      const remaining = Math.abs(((wantYaw - enemy.turretYaw + 1536) & 1023) - 512);
      const aligned = (deg: number): boolean => remaining <= (deg / 360) * 1024;

      const steady = enemy.speed <= vehicle.fireMaxSpeedMps;
      if (!target || !point || !steady) {
        if (!steady) enemy.tell = null;
        enemy.aim = null;
        continue;
      }
      if (!enemy.aim || enemy.aim.netId !== target.netId) enemy.aim = { netId: target.netId, since: nowSeconds };
      const range = Math.sqrt((point.x - eye.x) ** 2 + (point.y - eye.y) ** 2 + (point.z - eye.z) ** 2);

      // The cannon: lock, hold, fire at the locked point, wait.
      if (enemy.tell) {
        if (nowSeconds >= enemy.tell.until) {
          this.fireShell(enemy, vehicle, enemy.tell.point);
          enemy.tell = null;
          enemy.cannonReadyAt = nowSeconds + cannon.intervalSeconds;
        }
      } else if (nowSeconds >= enemy.cannonReadyAt && aligned(cannon.alignDeg)) {
        enemy.tell = { until: nowSeconds + cannon.tellSeconds, netId: target.netId, point: { ...point } };
      }

      // The machine gun: bursts on sight inside its range, the turret on the bearing.
      if (range <= vehicle.machineGun.rangeM && aligned(vehicle.machineGun.alignDeg)) this.fireTankGun(enemy, vehicle, target, eye, point, range, nowSeconds);
    }
  }

  /** U-068: one tick of a tank's coaxial gun, by the archetype's burst discipline and aim error (as `aiShoot`, but the hull does not turn to it). */
  private fireTankGun(enemy: EnemyEntity, vehicle: EnemyVehicle, target: Slot, eye: { x: number; y: number; z: number }, point: { x: number; y: number; z: number }, range: number, nowSeconds: number): void {
    const accuracy = enemy.def.accuracy;
    const ws = enemy.weaponState;
    finishReload(enemy.weapon, ws, nowSeconds);
    if (ws.ammo === 0) startReload(enemy.weapon, ws, nowSeconds);
    if (ws.bloomUnits > degToAngle(accuracy.holdBloomDeg) || nowSeconds < enemy.burst.pauseUntil) return;
    const line = aimAngles(eye, point);
    const cone = aimConeDeg(accuracy, {
      distanceM: range,
      targetSpeedMps: this.slotSpeed[target.index] ?? 0,
      suppression: suppressionLevel(enemy.suppression, nowSeconds),
      timeOnTargetSeconds: nowSeconds - (enemy.aim?.since ?? nowSeconds),
    });
    const aimed = aimError(line.yaw, line.pitch, cone, aimSeed(this.currentTick, enemy.netId, ws.shotIndex));
    const shot = tryFire(enemy.weapon, ws, nowSeconds, true, false);
    if (shot === null) return;
    if (++enemy.burst.rounds >= accuracy.burstRounds) {
      enemy.burst.rounds = 0;
      enemy.burst.pauseUntil = nowSeconds + accuracy.burstPauseSeconds;
    }
    this.enemyFiredTick.set(enemy.netId, this.currentTick);
    this.traceShot(enemy.netId, enemy.weapon, shot, this.currentTick, eye, aimed.yaw, aimed.pitch, this.nowMs);
    if (ws.ammo === 0) startReload(enemy.weapon, ws, nowSeconds);
  }

  /** U-068: the cannon's shell leaves the barrel for a point, with the projectile row's look and the tank's own numbers. */
  private fireShell(enemy: EnemyEntity, vehicle: EnemyVehicle, at: { x: number; y: number; z: number }): void {
    const cannon = vehicle.cannon;
    const index = (PROJECTILE_IDS as readonly string[]).indexOf(cannon.projectile);
    const base = this.projectileDefs[index];
    if (!base || this.projectiles.length >= MAX_PROJECTILES) return;
    const def: ProjectileDef = { ...base, speedMPerSec: cannon.speedMPerSec, blastDamage: cannon.blastDamage, blastRadiusM: cannon.blastRadiusM };
    const origin = this.turretPoint(enemy, cannon.muzzle);
    const dx = at.x - origin.x;
    const dz = at.z - origin.z;
    const flat = Math.sqrt(dx * dx + dz * dz);
    // Aim high by the drop over the flight, so the shell arrives where the barrel was laid.
    const seconds = flat / cannon.speedMPerSec;
    const dy = at.y + 0.5 * def.gravity * seconds * seconds - origin.y;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length <= 1e-6) return;
    const v = cannon.speedMPerSec / length;
    this.projectiles.push({
      netId: this.nextProjectileNetId++,
      def,
      kind: index,
      ownerSlot: NO_SLOT,
      ownerNetId: enemy.netId,
      xpPlayerId: null,
      state: createProjectileState(origin, { x: dx * v, y: dy * v, z: dz * v }),
    });
    this.stimuli.push({ kind: 'shot', at: origin, sourceNetId: enemy.netId });
  }

  /**
   * AI trigger pulls (T-3.15), every tick, for every living enemy whose brain
   * names someone to shoot.
   *
   * It fires through the human path: the archetype's `WeaponDef`, `tryFire`'s
   * cadence, magazine and reload, the weapon's bloom and aimed cone, and
   * `traceShot`'s damage and `HitEvent` — with no rewind, since it sees the
   * present. What it adds is the aim: a point on the target it can see (never
   * one behind a wall), the true line to it, and the archetype's aim error
   * around that line. Losing sight, or changing target, starts time on target
   * again. An empty magazine starts a reload the moment it empties, whether
   * or not it goes on shooting.
   */
  private fireEnemies(nowSeconds: number): void {
    for (const enemy of this.enemyList) {
      if (isDead(enemy.health)) continue;
      // U-068: a tank fights with its own turret (`fireTanks`), not a soldier's hands.
      if (enemy.def.vehicle) continue;
      // T-4.29: a mounted gun is deployed by nature, and fires with the gun's numbers from the gun's muzzle.
      if (this.aiShoot(enemy, enemy.def.accuracy, enemy.mounted !== null || this.deployed(enemy, nowSeconds), false, nowSeconds, enemy.mounted)) this.enemyFiredTick.set(enemy.netId, this.currentTick);
    }
    // T-3.26: friendly bots fire by the same path, holding fire while a squadmate is on the line.
    if (!this.botsDriven) return;
    for (const slot of this.slots) {
      if (!this.autonomous(slot) || !slot.brain || !isAlive(slot.health)) continue;
      if (this.aiShoot(slot, BOT_ARCHETYPE.accuracy, true, true, nowSeconds)) this.lastFiredTick[slot.index] = this.currentTick;
    }
  }

  /**
   * One AI soldier's trigger this tick (`fireEnemies`); true when a round left
   * the gun. `mayFire` false aims without firing (an MG not yet deployed);
   * `spareFriends` holds fire while a squadmate's capsule, grown by
   * `bot.friendlyMarginM`, is on the line to the aim point (T-3.26).
   */
  private aiShoot(shooter: AiBody, accuracy: EnemyAccuracy, mayFire: boolean, spareFriends: boolean, nowSeconds: number, gun: EmplacementEntity | null = null): boolean {
    // T-4.29: on a gun, the gun's weapon, belt and muzzle; the shooter's own otherwise.
    const weapon = gun ? gun.weapon : shooter.weapon;
    const ws = gun ? gun.weaponState : shooter.weaponState;
    finishReload(weapon, ws, nowSeconds);
    if (ws.ammo === 0) startReload(weapon, ws, nowSeconds);

    // Mid-vault both hands are on the wall, for an AI as for a player (T-2.21).
    if (shooter.state.vault) return false;
    // Its own eye in its own stance: crouched behind low cover it sees (and
    // shoots) over nothing a crouched head would not (T-3.20).
    const eye = gun ? gun.muzzle : soldierEye(shooter.state);
    const targetId = shooter.brain?.fireAt ?? null;
    const target = targetId === null ? null : this.soldier(targetId);
    // U-031: nor at a soldier who is down, even if the brain still names it before its next think.
    const shootable = target && target.netId !== shooter.netId && isAlive(target.health) ? target : null;
    let point = shootable ? visibleAimPoint(eye, aimPoints(shootable.state, shootable.state.crouched, shootable.state.prone, DEFAULT_HITBOX, lyingPose(shootable)), this.collisionBoxes) : null;
    let aimAt = shootable?.netId ?? SUPPRESSIVE_AIM;
    // No line of sight, no shot — except suppressive fire (T-3.21): a brain
    // with nobody to shoot at but a point to keep heads down at fires there,
    // through whatever is in the way, by every other rule a shot follows.
    if (!point && targetId === null) {
      point = shooter.brain?.read('suppressAt') ?? null;
      aimAt = SUPPRESSIVE_AIM;
    }
    if (!point) {
      shooter.aim = null;
      return false;
    }
    if (!shooter.aim || shooter.aim.netId !== aimAt) shooter.aim = { netId: aimAt, since: nowSeconds };

    const line = aimAngles(eye, point);
    /**
     * T-4.29: a mounted gun traverses and elevates only so far. A target
     * outside the arc is not shot at: the gun is laid on the nearer stop, and
     * an AI gunner whose target stays outside the arc for the data's seconds
     * gets off the gun and fights on foot.
     */
    if (gun) {
      const yawWire = tableToWire(line.yaw);
      const pitchWire = tableToWire(line.pitch);
      const inArc = withinArc(gun.facing, yawWire, gun.def.traverseDeg) && clampPitch(pitchWire, gun.def) === signedWire(pitchWire);
      if (inArc) gun.outOfArcSince = null;
      else {
        gun.outOfArcSince ??= nowSeconds;
        gun.yaw = clampYawToArc(gun.facing, yawWire, gun.def.traverseDeg);
        gun.pitch = clampPitch(pitchWire, gun.def) & 0x3ff;
        shooter.yaw = gun.yaw;
        shooter.input.yaw = gun.yaw;
        shooter.pitch = gun.pitch;
        if (nowSeconds - gun.outOfArcSince >= gun.def.ai.leaveAfterSeconds) {
          const gunner = this.enemyList.find((e) => e.mounted === gun);
          if (gunner) this.dismountEnemy(gunner);
        }
        return false;
      }
    }
    // It faces what it shoots at, and the snapshot says so.
    shooter.yaw = tableToWire(line.yaw);
    shooter.input.yaw = shooter.yaw;
    shooter.pitch = tableToWire(line.pitch);

    // T-3.23: a gun that deploys is aimed but not fired until it has been still its deploy time.
    if (!mayFire) return false;
    // T-3.26: never through a squadmate.
    if (spareFriends && this.friendOnLine(shooter.netId, eye, point)) return false;
    // Trigger discipline: a burst, then wait for the gun to settle — and a
    // burst of the archetype's length, then a pause (T-3.23).
    if (ws.bloomUnits > degToAngle(accuracy.holdBloomDeg)) return false;
    if (nowSeconds < shooter.burst.pauseUntil) return false;
    const dx = point.x - eye.x;
    const dy = point.y - eye.y;
    const dz = point.z - eye.z;
    const range = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const cone = aimConeDeg(accuracy, {
      distanceM: range,
      targetSpeedMps: aimAt === SUPPRESSIVE_AIM ? 0 : (shootable?.speed ?? 0),
      suppression: suppressionLevel(shooter.suppression, nowSeconds),
      timeOnTargetSeconds: nowSeconds - shooter.aim.since,
    });
    // The round's own aim error, drawn from the seed the shot about to go will carry.
    const aimed = aimError(line.yaw, line.pitch, cone, aimSeed(this.currentTick, shooter.netId, ws.shotIndex));
    // Nor a round the aim error would throw into one: that round is held, and
    // the next tick draws another.
    if (spareFriends && this.friendOnLine(shooter.netId, eye, along(eye, aimed, range))) return false;
    // T-4.29: an overheated gun does not fire, whoever is on it.
    if (gun && !canFireHot(gun.heat)) return false;
    const shot = tryFire(weapon, ws, nowSeconds, true, gun ? false : shooter.state.prone);
    if (shot === null) return false;
    if (gun) {
      heatShot(gun.def, gun.heat);
      gun.yaw = clampYawToArc(gun.facing, tableToWire(aimed.yaw), gun.def.traverseDeg);
      gun.pitch = clampPitch(tableToWire(aimed.pitch), gun.def) & 0x3ff;
    }
    if (++shooter.burst.rounds >= accuracy.burstRounds) {
      shooter.burst.rounds = 0;
      shooter.burst.pauseUntil = nowSeconds + accuracy.burstPauseSeconds;
    }

    this.traceShot(shooter.netId, weapon, shot, this.currentTick, eye, aimed.yaw, aimed.pitch, this.nowMs);
    // The last round out starts the reload on the same tick.
    if (ws.ammo === 0) startReload(weapon, ws, nowSeconds);
    return true;
  }

  /** Whether a living squadmate's capsule, grown by `bot.friendlyMarginM`, crosses the segment `eye` → `point` (T-3.26). */
  friendOnLine(shooterNetId: number, eye: { x: number; y: number; z: number }, point: { x: number; y: number; z: number }): boolean {
    const dx = point.x - eye.x;
    const dy = point.y - eye.y;
    const dz = point.z - eye.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-6) return false;
    const ray = { origin: eye, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: length };
    for (const slot of this.slots) {
      if (slot.netId === shooterNetId || isDead(slot.health)) continue;
      // Cautious: the posed body where the friend is drawn, and the upright
      // capsule round where they stand, each grown by the margin. A bot holds
      // fire for either.
      const margin = SQUAD_CONFIG.bot.friendlyMarginM;
      const parts = bodyParts(DEFAULT_HITBOX, bodyStance(slot.state.crouched, slot.state.prone, lyingPose(slot).lying), slot.state, slot.yaw);
      if (rayBody(ray, parts, margin) !== null) return true;
      const capsule = soldierCapsule(slot.state);
      if (rayCapsule(ray, capsule.centre, capsule.radius + margin, capsule.halfHeight + margin) !== null) return true;
    }
    return false;
  }

  /** Whether an enemy may fire as far as deploying goes (T-3.23): always, for an archetype that does not deploy. */
  deployed(enemy: EnemyEntity, nowSeconds = this.nowMs / 1000): boolean {
    const deploy = enemy.def.deploy;
    return !deploy || (enemy.deployedAt !== null && nowSeconds - enemy.deployedAt >= deploy.seconds - 1e-9);
  }

  /** A slot or an enemy by netId, as much of it as a shooter aims with. */
  private soldier(netId: number): { netId: number; state: MoveState; health: HealthState; speed: number; yaw: number } | null {
    const slot = this.slots.find((s) => s.netId === netId);
    if (slot) return { netId, state: slot.state, health: slot.health, speed: this.slotSpeed[slot.index] ?? 0, yaw: slot.yaw };
    const enemy = this.enemyList.find((e) => e.netId === netId);
    return enemy ? { netId, state: enemy.state, health: enemy.health, speed: enemy.speed, yaw: enemy.yaw } : null;
  }

  /**
   * 10 Hz brains (T-3.08): each on the tick its netId's phase names, so the
   * six are spread two to a tick rather than all landing on one.
   */
  private thinkBrains(): void {
    for (const slot of this.slots) {
      if (slot.brain?.due(this.currentTick)) {
        // U-053: holding a kit's use is asked afresh each think, so a branch that pre-empts the heal lets go of it.
        slot.brain.take('useKit');
        slot.brain.think(this.currentTick);
      }
    }
    // Enemies' netIds are consecutive, so they spread over the phases too.
    for (const enemy of this.enemyList) {
      // However it died, a dead enemy's brain is stopped before it can think.
      if (isDead(enemy.health)) {
        if (enemy.brain && !enemy.brain.isStopped) this.killEnemy(enemy);
        continue;
      }
      if (enemy.brain?.due(this.currentTick)) enemy.brain.think(this.currentTick);
    }
  }

  /**
   * U-067: one tick of a tank's driving (`stepDrive`). It may stand only where the hull clears every wall and every
   * script blocker (three footprints along its length), and not on a living soldier: it waits for either to go and
   * does not push through or run anyone over.
   */
  private driveTank(enemy: EnemyEntity, drive: VehicleDrive, vehicle: EnemyVehicle): void {
    const clear = (x: number, z: number, forward: { x: number; z: number }): boolean => {
      const half = vehicle.hull.radius + 0.1;
      const reach = Math.abs(vehicle.hull.to[2] - vehicle.hull.from[2]) / 2;
      for (const along of [0, reach, -reach]) {
        if (blockedAt(x + forward.x * along, z + forward.z * along, half, enemy.state.y, this.moveConfig.stepHeight, VEHICLE_CLEARANCE_M, this.collisionBoxes)) return false;
      }
      const margin = vehicle.radiusM + 0.4;
      return !this.slots.some((s) => !isDead(s.health) && (s.state.x - x) ** 2 + (s.state.z - z) ** 2 < margin * margin);
    };
    const to = stepDrive({ x: enemy.state.x, z: enemy.state.z }, drive, vehicle, TICK_SECONDS, clear);
    enemy.state = { ...enemy.state, x: to.x, z: to.z };
    enemy.yaw = driveYawWire(drive);
    enemy.input = { ...enemy.input, yaw: enemy.yaw, moveX: 0, moveY: 0 };
  }

  /**
   * Step every living enemy through `stepCharacter` with the input its brain's
   * intent produced (or an idle one), and take away corpses whose time is up.
   * A corpse is not stepped: like a dead slot it lies where it fell.
   */
  private stepEnemies(nowSeconds: number): void {
    let expired = false;
    for (const enemy of this.enemyList) {
      if (isDead(enemy.health)) {
        if (nowSeconds - (enemy.health.diedAt as number) >= enemy.def.corpseSeconds) expired = true;
        continue;
      }
      enemy.input.downed = false;
      const fromX = enemy.state.x;
      const fromZ = enemy.state.z;
      // U-067: a tank drives its path; it does not walk on a soldier's controller.
      if (enemy.drive && enemy.def.vehicle) {
        this.driveTank(enemy, enemy.drive, enemy.def.vehicle);
        enemy.speed = Math.sqrt((enemy.state.x - fromX) ** 2 + (enemy.state.z - fromZ) ** 2) / TICK_SECONDS;
        decayBloom(enemy.weapon, enemy.weaponState, TICK_SECONDS);
        // U-069: a withdrawing tank that has driven out is gone — not a corpse, not a wreck.
        if (enemy.drive.withdrawing && enemy.drive.phase === 'arrived') {
          enemy.departed = true;
          expired = true;
        }
        continue;
      }
      // T-4.29: a gunner stays on its gun, crouched behind it, whatever its brain's feet want.
      if (enemy.mounted) enemy.input = { ...enemy.input, moveX: 0, moveY: 0, jump: false, sprint: false, crouch: true, prone: false, yaw: enemy.yaw };
      enemy.state = stepCharacter(enemy.state, enemy.input, TICK_SECONDS, this.moveConfig, this.collisionBoxes);
      if (enemy.mounted) {
        enemy.state.x = enemy.mounted.place.x;
        enemy.state.z = enemy.mounted.place.z;
      }
      enemy.speed = Math.sqrt((enemy.state.x - fromX) ** 2 + (enemy.state.z - fromZ) ** 2) / TICK_SECONDS;
      // T-3.23: a gun that deploys packs up the moment it moves, and settles again only standing still.
      const deploy = enemy.def.deploy;
      if (deploy) enemy.deployedAt = enemy.speed > deploy.movingSpeedMps || enemy.state.vault ? null : (enemy.deployedAt ?? nowSeconds);
      enemy.yaw = enemy.input.yaw;
      // Its gun recovers as a slot's does (T-3.15): firing adds bloom, only this takes it away.
      decayBloom(enemy.weapon, enemy.weaponState, TICK_SECONDS);
    }
    if (!expired) return;
    const kept = this.enemyList.filter((enemy) => {
      const gone = enemy.departed || (isDead(enemy.health) && nowSeconds - (enemy.health.diedAt as number) >= enemy.def.corpseSeconds);
      // Out of the history too, or a rewound shot could still find the corpse.
      if (gone) this.hitboxes.forget(enemy.netId);
      return !gone;
    });
    this.enemyList.length = 0;
    for (const enemy of kept) this.enemyList.push(enemy);
  }

  /**
   * 30 Hz locomotion: every bot whose brain wants to go somewhere has its
   * latest intent walked by path following, then steered round everyone else.
   * A bot whose brain wants nothing, and never has since it last stood still,
   * keeps whatever input it has — an idle one — exactly as before brains.
   */
  private driveBots(): void {
    const mesh = this.navMesh;
    if (!mesh) return;
    const inputs: (MoveInput | null)[] = this.slots.map(() => null);
    for (const slot of this.slots) {
      const brain = slot.brain;
      if (!this.autonomous(slot) || !brain) continue;
      const intent = brain.intent;
      let follower = this.followers[slot.index] ?? null;
      if (!follower) {
        if (!intent) continue;
        follower = this.followers[slot.index] = new PathFollower(mesh, this.collisionBoxes, undefined, this.moveConfig);
      }
      inputs[slot.index] = follower.step(slot.state, intent, slot.yaw).input;
      // Stood still again: its input is the idle one just made, and stays so.
      if (!intent) this.followers[slot.index] = null;
    }
    // Living enemies walk their brains' intents the same way (T-3.10). A
    // corpse is out of the crowd altogether: nobody steers round the dead.
    const living = this.enemyList.filter((e) => !isDead(e.health));
    const enemyInputs: (MoveInput | null)[] = living.map((enemy) => {
      // T-4.29: a gunner's brain may want to go somewhere; its feet stay on the gun.
      const intent = enemy.mounted ? null : (enemy.brain?.intent ?? null);
      if (!enemy.follower) {
        if (!intent) return null;
        enemy.follower = new PathFollower(mesh, this.collisionBoxes, undefined, this.moveConfig);
      }
      const stepped = enemy.follower.step(enemy.state, intent, enemy.yaw);
      enemy.pathStatus = stepped.status;
      const input = stepped.input;
      if (!intent) enemy.follower = null;
      return input;
    });
    if (!this.avoidance) {
      if (inputs.every((i) => !i) && enemyInputs.every((i) => !i)) return;
      this.avoidance = new Avoidance(mesh, MAX_SLOTS + MAX_ENEMIES, undefined, this.moveConfig);
    }
    const entries: AvoidanceEntry[] = this.slots.map((slot) => ({
      id: slot.netId,
      state: slot.state,
      input: inputs[slot.index] ?? null,
      hold: this.followers[slot.index]?.onVault ?? false,
    }));
    living.forEach((enemy, i) => {
      entries.push({ id: enemy.netId, state: enemy.state, input: enemyInputs[i] ?? null, hold: enemy.follower?.onVault ?? false });
    });
    const steered = this.avoidance.step(entries);
    for (const slot of this.slots) {
      const input = steered[slot.index];
      if (inputs[slot.index] && input) slot.input = input;
    }
    living.forEach((enemy, i) => {
      const input = steered[this.slots.length + i];
      if (enemyInputs[i] && input) enemy.input = input;
    });
  }

  /** Clear all revive state owned by, or stored on, a reused slot. */
  private clearReviveStateForSlot(slotIndex: number): void {
    const slot = this.slots[slotIndex];
    if (slot) {
      slot.reviveBySlot = -1;
      slot.reviveProgressSeconds = 0;
    }
    for (const target of this.slots) {
      if (target.reviveBySlot === slotIndex) {
        target.reviveBySlot = -1;
        target.reviveProgressSeconds = 0;
      }
    }
  }

  /**
   * T-2.15: resolve the held-E revive interaction authoritatively.
   *
   * A downed target owns its reviver lock. Once a living human has started
   * within range, another player cannot steal the interaction until the first
   * player releases E, leaves range, becomes downed/dead, or the target stops
   * being downed. This makes simultaneous attempts deterministic and matches
   * the requested "first to start holds it" rule.
   */
  private updateRevives(): void {
    const rangeSq = DAMAGE.downed.reviveRangeM * DAMAGE.downed.reviveRangeM;

    // First, invalidate locks whose reviver is no longer actively holding E.
    for (const target of this.slots) {
      if (!isDowned(target.health)) {
        target.reviveBySlot = -1;
        target.reviveProgressSeconds = 0;
        continue;
      }
      if (target.reviveBySlot < 0) {
        target.reviveProgressSeconds = 0;
        continue;
      }
      const reviver = target.reviveBySlot >= 0 ? this.slots[target.reviveBySlot] : undefined;
      if (
        !reviver ||
        !isAlive(reviver.health) ||
        !this.holdingInteract(reviver) ||
        this.distanceSq(reviver, target) > rangeSq
      ) {
        target.reviveBySlot = -1;
        target.reviveProgressSeconds = 0;
      }
    }

    // Then allow unclaimed targets to be claimed in stable slot/netId order.
    // One soldier at a time: a reviver already holding a lock takes no second
    // target, however many downed teammates are in reach. The next one is
    // claimed the tick after the first revive completes and frees the reviver.
    for (const reviver of this.slots) {
      if (!isAlive(reviver.health) || !this.holdingInteract(reviver)) continue;
      if (this.slots.some((t) => t.reviveBySlot === reviver.index)) continue;
      let best: Slot | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const target of this.slots) {
        if (target === reviver || !isDowned(target.health) || target.reviveBySlot >= 0) continue;
        const d = this.distanceSq(reviver, target);
        if (d <= rangeSq && d < bestDistance) {
          best = target;
          bestDistance = d;
        }
      }
      if (best) {
        best.reviveBySlot = reviver.index;
        best.reviveProgressSeconds = 0;
      }
    }

    // Advance every active interaction and complete it at the configured hold time.
    for (const target of this.slots) {
      if (!isDowned(target.health) || target.reviveBySlot < 0) continue;
      target.reviveProgressSeconds += TICK_SECONDS;
      if (target.reviveProgressSeconds >= this.reviveSeconds(target.reviveBySlot)) {
        this.awardXp(target.reviveBySlot, 'revive');
        this.bumpStat(target.reviveBySlot, 'revives');
        revive(target.health);
        target.reviveBySlot = -1;
        target.reviveProgressSeconds = 0;
        target.queue.length = 0;
      }
    }
  }

  /**
   * Holding E as of the newest real input, and not silent past the repeat
   * window — or, for a bot (T-3.26), its brain asking to: the same lock, range
   * and timer a human's held E gets.
   */
  private holdingInteract(slot: Slot): boolean {
    if (this.autonomous(slot)) return slot.brain?.read('interact') ?? false;
    return slot.interactHeld && slot.staleTicks <= MAX_INPUT_REPEAT;
  }

  private distanceSq(a: Slot, b: Slot): number {
    const dx = a.state.x - b.state.x;
    const dy = a.state.y - b.state.y;
    const dz = a.state.z - b.state.z;
    return dx * dx + dy * dy + dz * dz;
  }

  private buildSnapshot(): WorldSnapshot {
    const entities: WorldSnapshot['entities'] = this.slots.map((s) => ({
        netId: s.netId,
        components: {
          [T]: [
            quantize(s.state.x, POSITION),
            quantize(s.state.y, POSITION),
            quantize(s.state.z, POSITION),
            s.yaw & 0x3ff,
            s.pitch & 0x3ff,
          ],
          // Vertical velocity must replicate or a client reconciling mid-jump
          // snaps to the right height with the wrong momentum and diverges again
          // on the very next tick.
          [V]: [quantize(0, VELOCITY), quantize(s.state.vy, VELOCITY), quantize(0, VELOCITY)],
          // Replicated, never predicted: §2.3 puts damage firmly on the
          // server's side of the line. The vitality and its timer ride along
          // (T-2.13) so the HUD counts what the server counts.
          [H]: [
            Math.round(s.health.current),
            Math.round(s.health.max),
            vitalityCode(vitality(s.health)),
            Math.min(63, Math.ceil(vitalTimer(s.health, this.nowMs / 1000))),
            Math.min(100, Math.round((s.reviveProgressSeconds / this.reviveSeconds(s.reviveBySlot)) * 100)),
            s.reviveBySlot < 0 ? 0 : s.reviveBySlot + 1,
          ],
          [COMPONENT_IDS.PlayerSlot]: [s.index, s.isBot ? 1 : 0],
          // Replicate the authoritative stance so remote presentation matches the hitbox.
          [C]: [s.state.crouched ? 1 : 0, s.state.prone ? 1 : 0],
          // A vault in progress, whole (T-2.21): a predictor reconciling
          // mid-vault continues the same traversal instead of falling out of it.
          [COMPONENT_IDS.Vault]: vaultToLevels(s.state.vault),
          // The weapon in hand and its reload, for the body (T-2.26): the
          // host's own reload, which since U-028 includes a player's manual
          // one (a Reload from the page).
          [COMPONENT_IDS.Weapon]: [
            Math.max(0, (WEAPON_IDS as readonly string[]).indexOf(s.weapon.id)),
            Math.min(100, Math.round(reloadProgress(s.weapon, s.weaponState, this.nowMs / 1000) * 100)),
            s.heldProjectile + 1,
            // U-024: what is left in the pouch, for the page's own count to follow.
            ...PROJECTILE_IDS.map((_, i) => Math.min(POUCH_COUNT_MAX, s.pouch[i] ?? 0)),
            // U-028: and the rounds in the magazine.
            Math.min(AMMO_MAX, s.weaponState.ammo),
            // U-018: and what key 1 draws.
            s.primary === null ? NO_SECONDARY : Math.max(0, (WEAPON_IDS as readonly string[]).indexOf(s.primary)),
            // U-022: and the second primary, if the soldier carries one.
            s.secondary === null ? NO_SECONDARY : Math.max(0, (WEAPON_IDS as readonly string[]).indexOf(s.secondary)),
            // U-029: and whether the pistol has been put down.
            s.noPistol ? 1 : 0,
            // U-047: and the kits left, and how far through applying one.
            Math.min(7, s.kits),
            s.kitProgress > 0 ? Math.min(100, Math.floor((100 * s.kitProgress) / this.kitSeconds(s))) : 0,
            // U-048: and the equipment in slot 5, an index plus one.
            s.equipment + 1,
          ],
          // T-3.16: how suppressed, so the page can show it and widen its cone to match.
          [COMPONENT_IDS.Suppression]: [suppressionToWire(suppressionLevel(s.suppression, this.nowMs / 1000))],
        },
      }));

    /**
     * Enemies (T-3.10): a soldier's Transform, Velocity, Health and Crouch,
     * and an Enemy saying which archetype and whose side — what tells a client
     * this soldier is not a squadmate. No PlayerSlot, no Vault, no Weapon.
     * A corpse's Health timer counts down to its despawn.
     */
    for (const e of this.enemyList) {
      const corpseLeft = isDead(e.health)
        ? Math.max(0, e.def.corpseSeconds - (this.nowMs / 1000 - (e.health.diedAt as number)))
        : 0;
      entities.push({
        netId: e.netId,
        components: {
          [T]: [
            quantize(e.state.x, POSITION),
            quantize(e.state.y, POSITION),
            quantize(e.state.z, POSITION),
            e.yaw & 0x3ff,
            e.pitch & 0x3ff,
          ],
          [V]: [quantize(0, VELOCITY), quantize(e.state.vy, VELOCITY), quantize(0, VELOCITY)],
          [H]: [
            Math.round(e.health.current),
            Math.round(e.health.max),
            vitalityCode(vitality(e.health)),
            Math.min(63, Math.ceil(corpseLeft)),
            // U-010: how far through pulling the lever it is, percent — the slot a squadmate's revive uses.
            this.leverUse?.enemy === e ? this.leverPercent() : 0,
            0,
          ],
          [C]: [e.state.crouched ? 1 : 0, e.state.prone ? 1 : 0],
          // U-066: a tank's turret faces its own way; a soldier's is 0. U-068: and 1 while its cannon is locked on a point.
          [COMPONENT_IDS.Enemy]: [e.archetype, e.faction, e.def.vehicle ? e.turretYaw & 0x3ff : 0, e.tell ? 1 : 0],
        },
      });
    }

    /**
     * Projectiles are entities like any other, and were the first to come and
     * go (enemies, above, are the second): they carry a Transform and a
     * Velocity — the velocity so a client can point a rocket along its flight
     * and smooth between samples — and a
     * Projectile saying which kind and whose. No health, no stance, nothing
     * a soldier needs. They cost their component mask and about a hundred bits
     * a tick each while they are in the air, and nothing at all once they are
     * not (T-1.04's despawn).
     */
    for (const p of this.projectiles) {
      entities.push({
        netId: p.netId,
        components: {
          [T]: [
            quantize(p.state.x, POSITION),
            quantize(p.state.y, POSITION),
            quantize(p.state.z, POSITION),
            0,
            0,
          ],
          [V]: [
            quantize(p.state.vx, VELOCITY),
            quantize(p.state.vy, VELOCITY),
            quantize(p.state.vz, VELOCITY),
          ],
          [COMPONENT_IDS.Projectile]: [p.kind, p.ownerSlot],
        },
      });
    }

    /**
     * Emplacements (T-4.29): a Transform — the gun's place and the way it is
     * laid — and an Emplacement saying which kind, who is on it and how hot it
     * is. Static and few; a delta carries nothing for one nobody has touched.
     */
    /** U-017: pickups — where each lies, which way, and what it is. They come and go as projectiles do. */
    for (const p of this.pickupList) {
      entities.push({
        netId: p.netId,
        components: {
          [T]: [quantize(p.x, POSITION), quantize(p.y, POSITION), quantize(p.z, POSITION), p.yaw & 0x3ff, 0],
          [COMPONENT_IDS.Pickup]: [p.weapon, p.ammo],
        },
      });
    }

    for (const g of this.emplacementList) {
      const gunnerSlot = g.gunnerNetId === 0 ? -1 : this.slots.findIndex((s) => s.netId === g.gunnerNetId);
      entities.push({
        netId: g.netId,
        components: {
          [T]: [quantize(g.placed.x, POSITION), quantize(g.placed.y, POSITION), quantize(g.placed.z, POSITION), g.yaw & 0x3ff, g.pitch & 0x3ff],
          [COMPONENT_IDS.Emplacement]: [g.kind, g.gunnerNetId === 0 ? 0 : gunnerSlot >= 0 ? gunnerSlot + 1 : 7, heatToWire(g.heat), g.heat.overheated ? 1 : 0],
        },
      });
    }

    return { tick: this.currentTick, entities };
  }

  private broadcast(snapshot: WorldSnapshot): void {
    for (const conn of this.connections) {
      if (conn.state !== 'active') continue;

      const slot = this.slots.find((sl) => sl.connection === conn);
      let view = this.views.get(conn);
      if (!view) {
        view = new ClientView();
        this.views.set(conn, view);
      }
      // Per-client baseline: the VIEW they were sent at the tick they last
      // acknowledged (T-3.12) — an entity out of their radius then and in it
      // now is a spawn, the reverse a despawn. If it has aged out of the ring
      // they get a full view, which is self-healing.
      const baseline = conn.lastAckedTick >= 0 ? view.history.get(conn.lastAckedTick) : null;
      const watched = this.spectators.get(conn);
      const current = view.next(snapshot, watched === undefined ? (slot ? slot.netId : null) : watched === ESCORT_SPECTATE_SLOT ? (this.escort()?.netId ?? slot?.netId ?? null) : (this.slots[watched]?.netId ?? null));
      const w = new BitWriter();
      writeDelta(w, current, baseline);
      const payload = w.toUint8Array();

      const wire = encodeMessage({
        kind: 'Delta',
        tick: snapshot.tick,
        baselineTick: baseline ? baseline.tick : null,
        lastProcessedInputTick: slot ? slot.lastProcessedInputTick : -1,
        payload,
      });
      conn.transport.send(wire, 'unreliable');
      this.snapshotsSent++;
      this.bytesSent += wire.length;
    }
  }

  /** Every seated connection is told the host is draining, then dropped. */
  close(reason = 'session closed'): void {
    this.avoidance?.destroy();
    this.avoidance = null;
    for (const conn of [...this.connections]) conn.reject('host draining', reason);
    this.connections.clear();
    this.aiDebugClients.clear();
  }
}

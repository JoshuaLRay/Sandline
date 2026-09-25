import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { PlayerDirectory, type PlayerRecord } from '../identity/PlayerDirectory.ts';

export const CAMPAIGN_CODE_ALPHABET = 'ACDEFGHJKMNPRTUVWXY34679';
export const CAMPAIGN_CODE_LENGTH = 8;
export const CAMPAIGN_SAVE_VERSION = 1;
export const CAMPAIGN_SCHEMA_VERSION = 1;
export const CAMPAIGN_RETENTION_MS = 180 * 24 * 60 * 60_000;

export interface SoldierSave {
  slot: number;
  classId: string;
  rank: number;
  xp: number;
}

export interface CampaignCheckpoint {
  mission: string;
  objective: number;
  elapsedTicks: number;
  spawns: { x: number; y: number; z: number }[];
  completedGroups: string[];
  event: unknown | null;
}

export interface CampaignState {
  formatVersion: number;
  world: string;
  completedMissions: string[];
  checkpoint: CampaignCheckpoint | null;
  soldiers: SoldierSave[];
}

export interface CampaignRecord {
  code: string;
  ownerId: string;
  state: CampaignState;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface CampaignDatabaseOptions {
  /** Number of attempts for a write that throws. Defaults to 3. */
  writeAttempts?: number;
  /** Test-only seam for a process dying before/after SQLite commits. */
  fault?: (phase: 'before-commit' | 'after-commit') => void;
}

type Row = Record<string, string | number | bigint | Uint8Array | null>;

function initialSoldiers(): SoldierSave[] {
  return Array.from({ length: 6 }, (_, slot) => ({ slot, classId: '', rank: 0, xp: 0 }));
}

export function newCampaignState(world: string): CampaignState {
  return {
    formatVersion: CAMPAIGN_SAVE_VERSION,
    world,
    completedMissions: [],
    checkpoint: null,
    soldiers: initialSoldiers(),
  };
}

export function normalizeCampaignCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s_-]+/g, '');
}

export function isCampaignCode(code: string): boolean {
  if (code.length !== CAMPAIGN_CODE_LENGTH) return false;
  for (const ch of code) if (!CAMPAIGN_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

function makeCampaignCode(): string {
  const bytes = randomBytes(CAMPAIGN_CODE_LENGTH);
  let out = '';
  for (const byte of bytes) out += CAMPAIGN_CODE_ALPHABET[byte % CAMPAIGN_CODE_ALPHABET.length];
  return out;
}

function number(row: Row, key: string): number {
  return Number(row[key]);
}

function text(row: Row, key: string): string {
  return String(row[key]);
}

function normalizedState(input: CampaignState): CampaignState {
  if (input.formatVersion !== CAMPAIGN_SAVE_VERSION) {
    throw new Error(`campaign save format ${input.formatVersion} is not supported by format ${CAMPAIGN_SAVE_VERSION}`);
  }
  if (typeof input.world !== 'string' || input.world === '') throw new Error('campaign world is required');
  if (!Array.isArray(input.completedMissions) || input.completedMissions.some((id) => typeof id !== 'string' || id === '')) {
    throw new Error('campaign completedMissions must contain mission ids');
  }
  if (!Array.isArray(input.soldiers) || input.soldiers.length !== 6) throw new Error('campaign must contain six soldiers');
  const soldiers = [...input.soldiers].sort((a, b) => a.slot - b.slot).map((soldier, slot) => {
    if (soldier.slot !== slot) throw new Error('campaign soldiers must contain slots 0..5 exactly once');
    if (typeof soldier.classId !== 'string') throw new Error(`soldier ${slot} classId must be a string`);
    if (!Number.isInteger(soldier.rank) || soldier.rank < 0) throw new Error(`soldier ${slot} rank must be a non-negative integer`);
    if (!Number.isInteger(soldier.xp) || soldier.xp < 0) throw new Error(`soldier ${slot} xp must be a non-negative integer`);
    return { slot, classId: soldier.classId, rank: soldier.rank, xp: soldier.xp };
  });
  let checkpoint: CampaignCheckpoint | null = null;
  if (input.checkpoint !== null) {
    const saved = input.checkpoint;
    if (typeof saved.mission !== 'string' || saved.mission === '') throw new Error('checkpoint mission is required');
    if (!Number.isInteger(saved.objective) || saved.objective < 0) throw new Error('checkpoint objective must be a non-negative integer');
    if (!Number.isInteger(saved.elapsedTicks) || saved.elapsedTicks < 0) throw new Error('checkpoint elapsedTicks must be a non-negative integer');
    if (!Array.isArray(saved.spawns) || saved.spawns.length !== 6 || saved.spawns.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) {
      throw new Error('checkpoint must contain six finite spawn positions');
    }
    if (!Array.isArray(saved.completedGroups) || saved.completedGroups.some((id) => typeof id !== 'string' || id === '')) {
      throw new Error('checkpoint completedGroups must contain ids');
    }
    checkpoint = {
      mission: saved.mission,
      objective: saved.objective,
      elapsedTicks: saved.elapsedTicks,
      spawns: saved.spawns.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      completedGroups: [...saved.completedGroups],
      event: saved.event ?? null,
    };
  }
  return {
    formatVersion: CAMPAIGN_SAVE_VERSION,
    world: input.world,
    completedMissions: [...new Set(input.completedMissions)],
    checkpoint,
    soldiers,
  };
}

function migrations(version: number): string {
  if (version !== 1) throw new Error(`missing campaign database migration ${version}`);
  return `
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      code TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS campaigns_owner_idx ON campaigns(owner_id);
    CREATE INDEX IF NOT EXISTS campaigns_updated_idx ON campaigns(updated_at);
  `;
}

/**
 * T-4.23's durable store. Every acknowledged campaign save is one SQLite
 * transaction in WAL mode. Retrying the same state is idempotent: it returns
 * the already-committed revision instead of creating a second save.
 */
export class CampaignDatabase {
  private readonly db: DatabaseSync;
  private readonly attempts: number;
  private readonly fault: CampaignDatabaseOptions['fault'];

  constructor(readonly path: string, options: CampaignDatabaseOptions = {}) {
    this.attempts = Math.max(1, options.writeAttempts ?? 3);
    this.fault = options.fault;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  get schemaVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as Row;
    return number(row, 'user_version');
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    let version = this.schemaVersion;
    if (version > CAMPAIGN_SCHEMA_VERSION) {
      throw new Error(`campaign database schema ${version} is newer than supported ${CAMPAIGN_SCHEMA_VERSION}`);
    }
    while (version < CAMPAIGN_SCHEMA_VERSION) {
      const next = version + 1;
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec(migrations(next));
        this.db.exec(`PRAGMA user_version = ${next}`);
        this.db.exec('COMMIT');
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch { /* rollback is best-effort when the transaction already ended */ }
        throw error;
      }
      version = next;
    }
  }

  createCampaign(ownerId: string, world: string, nowMs = Date.now(), askedCode = ''): CampaignRecord {
    if (ownerId === '') throw new Error('campaign owner is required');
    const state = newCampaignState(world);
    return this.write(() => {
      let code = normalizeCampaignCode(askedCode);
      if (code !== '' && !isCampaignCode(code)) throw new Error(`invalid campaign code '${askedCode}'`);
      if (code === '') {
        do code = makeCampaignCode();
        while (this.db.prepare('SELECT 1 FROM campaigns WHERE code = ?').get(code));
      }
      const json = JSON.stringify(state);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare('INSERT INTO campaigns (code, owner_id, state_json, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
          .run(code, ownerId, json, nowMs, nowMs);
        this.fault?.('before-commit');
        this.db.exec('COMMIT');
        this.fault?.('after-commit');
        return { code, ownerId, state, revision: 1, createdAt: nowMs, updatedAt: nowMs };
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch { /* rollback is best-effort when the transaction already ended */ }
        throw error;
      }
    });
  }

  loadCampaign(code: string): CampaignRecord | undefined {
    const normalized = normalizeCampaignCode(code);
    if (!isCampaignCode(normalized)) return undefined;
    const row = this.db.prepare('SELECT code, owner_id, state_json, revision, created_at, updated_at FROM campaigns WHERE code = ?').get(normalized) as Row | undefined;
    if (!row) return undefined;
    const parsed = JSON.parse(text(row, 'state_json')) as CampaignState;
    return {
      code: text(row, 'code'),
      ownerId: text(row, 'owner_id'),
      state: normalizedState(parsed),
      revision: number(row, 'revision'),
      createdAt: number(row, 'created_at'),
      updatedAt: number(row, 'updated_at'),
    };
  }

  saveCampaign(code: string, input: CampaignState, nowMs = Date.now()): CampaignRecord {
    const normalized = normalizeCampaignCode(code);
    if (!isCampaignCode(normalized)) throw new Error(`invalid campaign code '${code}'`);
    const state = normalizedState(input);
    const json = JSON.stringify(state);
    return this.write(() => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const row = this.db.prepare('SELECT owner_id, state_json, revision, created_at, updated_at FROM campaigns WHERE code = ?').get(normalized) as Row | undefined;
        if (!row) throw new Error(`no campaign ${normalized}`);
        if (text(row, 'state_json') === json) {
          this.db.exec('COMMIT');
          return {
            code: normalized,
            ownerId: text(row, 'owner_id'),
            state,
            revision: number(row, 'revision'),
            createdAt: number(row, 'created_at'),
            updatedAt: number(row, 'updated_at'),
          };
        }
        const revision = number(row, 'revision') + 1;
        this.db.prepare('UPDATE campaigns SET state_json = ?, revision = ?, updated_at = ? WHERE code = ?')
          .run(json, revision, nowMs, normalized);
        this.fault?.('before-commit');
        this.db.exec('COMMIT');
        this.fault?.('after-commit');
        return {
          code: normalized,
          ownerId: text(row, 'owner_id'),
          state,
          revision,
          createdAt: number(row, 'created_at'),
          updatedAt: nowMs,
        };
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch { /* rollback is best-effort when the transaction already ended */ }
        throw error;
      }
    });
  }

  listOwned(ownerId: string): CampaignRecord[] {
    const rows = this.db.prepare('SELECT code FROM campaigns WHERE owner_id = ? ORDER BY updated_at DESC').all(ownerId) as Row[];
    return rows.map((row) => this.loadCampaign(text(row, 'code'))!);
  }

  deleteCampaign(code: string, ownerId: string): boolean {
    const result = this.db.prepare('DELETE FROM campaigns WHERE code = ? AND owner_id = ?').run(normalizeCampaignCode(code), ownerId);
    return Number(result.changes) > 0;
  }

  pruneCampaigns(nowMs: number, retentionMs = CAMPAIGN_RETENTION_MS): number {
    const result = this.db.prepare('DELETE FROM campaigns WHERE updated_at < ?').run(nowMs - retentionMs);
    return Number(result.changes);
  }

  touchPlayer(id: string, name: string, nowMs: number): PlayerRecord {
    this.db.prepare(`
      INSERT INTO players (id, name, first_seen, last_seen) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen
    `).run(id, name, nowMs, nowMs);
    return this.getPlayer(id)!;
  }

  getPlayer(id: string): PlayerRecord | undefined {
    const row = this.db.prepare('SELECT id, name, first_seen, last_seen FROM players WHERE id = ?').get(id) as Row | undefined;
    return row ? { id: text(row, 'id'), name: text(row, 'name'), firstSeen: number(row, 'first_seen'), lastSeen: number(row, 'last_seen') } : undefined;
  }

  get playerCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM players').get() as Row;
    return number(row, 'count');
  }

  prunePlayers(nowMs: number, retentionMs: number): number {
    const result = this.db.prepare(`
      DELETE FROM players
      WHERE last_seen < ?
        AND NOT EXISTS (SELECT 1 FROM campaigns WHERE campaigns.owner_id = players.id)
    `).run(nowMs - retentionMs);
    return Number(result.changes);
  }

  private write<T>(operation: () => T): T {
    let error: unknown = new Error('campaign write failed');
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      try {
        return operation();
      } catch (caught) {
        error = caught;
      }
    }
    throw error;
  }
}

/** PlayerDirectory-compatible view backed by the same SQLite file. */
export class SqlitePlayerDirectory extends PlayerDirectory {
  constructor(private readonly campaigns: CampaignDatabase) {
    super();
  }

  override touch(id: string, name: string, nowMs: number): PlayerRecord {
    return this.campaigns.touchPlayer(id, name, nowMs);
  }

  override get(id: string): PlayerRecord | undefined {
    return this.campaigns.getPlayer(id);
  }

  override get size(): number {
    return this.campaigns.playerCount;
  }

  override prune(nowMs: number, retentionMs?: number): number {
    return this.campaigns.prunePlayers(nowMs, retentionMs ?? 180 * 24 * 60 * 60_000);
  }
}

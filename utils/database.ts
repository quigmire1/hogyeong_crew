import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';

export type LocationRecord = {
  id?: number;
  session_id: string;
  latitude: number;
  longitude: number;
  altitude: number;
  timestamp: number;
  synced: number;
};

export type PhotoRecord = {
  id?: number;
  session_id: string;
  latitude: number;
  longitude: number;
  local_uri: string;
  remote_path?: string | null;
  public_url?: string | null;
  timestamp: number;
  synced: number;
};

export type SessionRecord = {
  id: string;        // UUID 형태의 session id
  started_at: number; // unix ms
  ended_at: number;   // unix ms
  synced?: number;
  group_hike_id?: string | null;
  group_hike_title?: string | null;
};

export type CloudSessionRecord = {
  id: string;
  started_at: string;
  ended_at: string | null;
  group_hike_id?: string | null;
  group_hike_title?: string | null;
};

export type CloudLocationRecord = {
  local_id: number;
  session_id: string;
  latitude: number;
  longitude: number;
  altitude?: number | null;
  recorded_at: string;
};

export type CloudPhotoRecord = {
  local_id: number;
  session_id: string;
  latitude?: number | null;
  longitude?: number | null;
  local_uri?: string | null;
  remote_path?: string | null;
  public_url?: string | null;
  taken_at: string;
};

const DB_NAME = 'hogyeong_crew.db';
let _db: SQLite.SQLiteDatabase | null = null;
const CURRENT_SCHEMA_VERSION = 5;

const getDB = () => {
  if (!_db) {
    _db = SQLite.openDatabaseSync(DB_NAME);
  }
  return _db;
};

const columnExists = (db: SQLite.SQLiteDatabase, tableName: string, columnName: string) => {
  const columns = db.getAllSync<{ name: string }>(`PRAGMA table_info(${tableName})`);
  return columns.some((column) => column.name === columnName);
};

const ensureMigrationTable = (db: SQLite.SQLiteDatabase) => {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
};

const hasMigration = (db: SQLite.SQLiteDatabase, version: number) => {
  const row = db.getFirstSync<{ version: number }>(
    'SELECT version FROM schema_migrations WHERE version = ?',
    version,
  );
  return Boolean(row);
};

const recordMigration = (db: SQLite.SQLiteDatabase, version: number) => {
  db.runSync(
    'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
    version,
    Date.now(),
  );
};

const runMigration = (
  db: SQLite.SQLiteDatabase,
  version: number,
  migrate: () => void,
) => {
  if (hasMigration(db, version)) {
    return;
  }

  migrate();
  recordMigration(db, version);
};

const runMigrations = (db: SQLite.SQLiteDatabase) => {
  ensureMigrationTable(db);

  runMigration(db, 1, () => {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL DEFAULT 0,
        synced INTEGER DEFAULT 0
      );
    `);

    db.execSync(`
      CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT '',
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        altitude REAL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        synced INTEGER DEFAULT 0
      );
    `);

    db.execSync(`
      CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT '',
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        local_uri TEXT NOT NULL,
        remote_path TEXT,
        public_url TEXT,
        timestamp INTEGER NOT NULL,
        synced INTEGER DEFAULT 0
      );
    `);
  });

  runMigration(db, 2, () => {
    if (!columnExists(db, 'locations', 'session_id')) {
      db.execSync(`ALTER TABLE locations ADD COLUMN session_id TEXT NOT NULL DEFAULT '';`);
    }

    if (!columnExists(db, 'photos', 'session_id')) {
      db.execSync(`ALTER TABLE photos ADD COLUMN session_id TEXT NOT NULL DEFAULT '';`);
    }

    if (!columnExists(db, 'sessions', 'synced')) {
      db.execSync(`ALTER TABLE sessions ADD COLUMN synced INTEGER DEFAULT 0;`);
    }
  });

  runMigration(db, 3, () => {
    db.execSync(`
      CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions (started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_ended_at ON sessions (ended_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_synced ON sessions (synced);
      CREATE INDEX IF NOT EXISTS idx_locations_session_id ON locations (session_id);
      CREATE INDEX IF NOT EXISTS idx_locations_synced ON locations (synced);
      CREATE INDEX IF NOT EXISTS idx_locations_timestamp ON locations (timestamp);
      CREATE INDEX IF NOT EXISTS idx_photos_session_id ON photos (session_id);
      CREATE INDEX IF NOT EXISTS idx_photos_synced ON photos (synced);
      CREATE INDEX IF NOT EXISTS idx_photos_timestamp ON photos (timestamp);
    `);
  });

  runMigration(db, 4, () => {
    if (!columnExists(db, 'sessions', 'synced')) {
      db.execSync(`ALTER TABLE sessions ADD COLUMN synced INTEGER DEFAULT 0;`);
    }
    db.execSync(`CREATE INDEX IF NOT EXISTS idx_sessions_synced ON sessions (synced);`);

    if (!columnExists(db, 'photos', 'remote_path')) {
      db.execSync(`ALTER TABLE photos ADD COLUMN remote_path TEXT;`);
    }

    if (!columnExists(db, 'photos', 'public_url')) {
      db.execSync(`ALTER TABLE photos ADD COLUMN public_url TEXT;`);
    }
  });

  runMigration(db, 5, () => {
    if (!columnExists(db, 'sessions', 'group_hike_id')) {
      db.execSync(`ALTER TABLE sessions ADD COLUMN group_hike_id TEXT;`);
    }

    if (!columnExists(db, 'sessions', 'group_hike_title')) {
      db.execSync(`ALTER TABLE sessions ADD COLUMN group_hike_title TEXT;`);
    }

    db.execSync(`CREATE INDEX IF NOT EXISTS idx_sessions_group_hike_id ON sessions (group_hike_id);`);
  });
};

export const initDB = async () => {
  try {
    const db = getDB();
    db.execSync('PRAGMA journal_mode = WAL;');
    runMigrations(db);

    console.log(`[Database] Initialized successfully (schema v${CURRENT_SCHEMA_VERSION})`);
  } catch (error) {
    console.error('[Database] Failed to initialize:', error);
    throw error;
  }
};

// ─── Session ─────────────────────────────────────────────────────────────────

export const createSession = async (metadata?: {
  groupHikeId?: string | null;
  groupHikeTitle?: string | null;
}): Promise<string> => {
  const db = getDB();
  const id = Crypto.randomUUID();
  db.runSync(
    'INSERT INTO sessions (id, started_at, ended_at, group_hike_id, group_hike_title) VALUES (?, ?, ?, ?, ?)',
    id,
    Date.now(),
    0,
    metadata?.groupHikeId ?? null,
    metadata?.groupHikeTitle ?? null,
  );
  return id;
};

export const endSession = async (sessionId: string): Promise<void> => {
  const db = getDB();
  db.runSync('UPDATE sessions SET ended_at = ?, synced = 0 WHERE id = ?', Date.now(), sessionId);
};

export const getAllSessions = async (): Promise<SessionRecord[]> => {
  const db = getDB();
  // 진행 중인 세션(ended_at = 0)은 기록 화면에서 이어가기/종료를 판단할 수 있도록 최신 완료 세션보다 먼저 반환합니다.
  return db.getAllSync<SessionRecord>(
    'SELECT * FROM sessions ORDER BY CASE WHEN ended_at = 0 THEN 0 ELSE 1 END, started_at DESC',
  );
};

export const getUnsyncedSessions = async (): Promise<SessionRecord[]> => {
  const db = getDB();
  return db.getAllSync<SessionRecord>(
    'SELECT * FROM sessions WHERE synced = 0 ORDER BY started_at ASC',
  );
};

export const markSessionsAsSynced = async (ids: string[]) => {
  if (ids.length === 0) return;
  const db = getDB();
  const placeholders = ids.map(() => '?').join(',');
  db.runSync(`UPDATE sessions SET synced = 1 WHERE id IN (${placeholders})`, ...ids);
};

export const upsertSessionsFromCloud = async (sessions: CloudSessionRecord[]) => {
  if (sessions.length === 0) return;
  const db = getDB();

  sessions.forEach((session) => {
    const startedAt = new Date(session.started_at).getTime();
    const endedAt = session.ended_at ? new Date(session.ended_at).getTime() : 0;
    if (!session.id || Number.isNaN(startedAt)) return;

    db.runSync(
      `INSERT OR REPLACE INTO sessions (
        id, started_at, ended_at, synced, group_hike_id, group_hike_title
      ) VALUES (?, ?, ?, 1, ?, ?)`,
      session.id,
      startedAt,
      Number.isNaN(endedAt) ? 0 : endedAt,
      session.group_hike_id ?? null,
      session.group_hike_title ?? null,
    );
  });
};

// ─── Location ─────────────────────────────────────────────────────────────────

export const insertLocation = async (
  latitude: number, longitude: number, altitude: number, timestamp: number, sessionId: string = ''
) => {
  const db = getDB();
  db.runSync(
    'INSERT INTO locations (session_id, latitude, longitude, altitude, timestamp, synced) VALUES (?, ?, ?, ?, ?, ?)',
    sessionId, latitude, longitude, altitude, timestamp, 0
  );
};

export const getLocationsBySession = async (sessionId: string): Promise<LocationRecord[]> => {
  const db = getDB();
  return db.getAllSync<LocationRecord>(
    'SELECT * FROM locations WHERE session_id = ? ORDER BY timestamp ASC', sessionId
  );
};

export const getAllLocations = async (): Promise<LocationRecord[]> => {
  const db = getDB();
  return db.getAllSync<LocationRecord>('SELECT * FROM locations ORDER BY timestamp ASC');
};

export const getUnsyncedLocations = async (): Promise<LocationRecord[]> => {
  const db = getDB();
  return db.getAllSync<LocationRecord>('SELECT * FROM locations WHERE synced = 0 ORDER BY timestamp ASC');
};

export const markAsSynced = async (ids: number[]) => {
  if (ids.length === 0) return;
  const db = getDB();
  const placeholders = ids.map(() => '?').join(',');
  db.runSync(`UPDATE locations SET synced = 1 WHERE id IN (${placeholders})`, ...ids);
};

export const upsertLocationsFromCloud = async (locations: CloudLocationRecord[]) => {
  if (locations.length === 0) return;
  const db = getDB();

  locations.forEach((location) => {
    const timestamp = new Date(location.recorded_at).getTime();
    if (!location.local_id || !location.session_id || Number.isNaN(timestamp)) return;

    db.runSync(
      `INSERT OR IGNORE INTO locations (
        id, session_id, latitude, longitude, altitude, timestamp, synced
      ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      location.local_id,
      location.session_id,
      location.latitude,
      location.longitude,
      location.altitude ?? 0,
      timestamp,
    );
  });
};

// clearLocations는 완전 삭제가 아닌 no-op으로 변경 (세션별로 보존)
export const clearLocations = async () => {
  // 더 이상 전체 삭제하지 않습니다. 세션 단위로 데이터를 관리합니다.
  console.log('[Database] clearLocations: 세션 기반으로 전환되어 전체 삭제를 하지 않습니다.');
};

// ─── Photo ────────────────────────────────────────────────────────────────────

export const insertPhoto = async (
  latitude: number, longitude: number, local_uri: string, timestamp: number, sessionId: string = ''
) => {
  const db = getDB();
  db.runSync(
    'INSERT INTO photos (session_id, latitude, longitude, local_uri, timestamp, synced) VALUES (?, ?, ?, ?, ?, ?)',
    sessionId, latitude, longitude, local_uri, timestamp, 0
  );
};

export const getAllPhotos = async (): Promise<PhotoRecord[]> => {
  const db = getDB();
  return db.getAllSync<PhotoRecord>('SELECT * FROM photos ORDER BY timestamp ASC');
};

export const getPhotosBySession = async (sessionId: string): Promise<PhotoRecord[]> => {
  const db = getDB();
  return db.getAllSync<PhotoRecord>(
    'SELECT * FROM photos WHERE session_id = ? ORDER BY timestamp ASC', sessionId
  );
};

export const getUnsyncedPhotos = async (): Promise<PhotoRecord[]> => {
  const db = getDB();
  return db.getAllSync<PhotoRecord>('SELECT * FROM photos WHERE synced = 0 ORDER BY timestamp ASC');
};

export const markPhotosAsSynced = async (ids: number[]) => {
  if (ids.length === 0) return;
  const db = getDB();
  const placeholders = ids.map(() => '?').join(',');
  db.runSync(`UPDATE photos SET synced = 1 WHERE id IN (${placeholders})`, ...ids);
};

export const upsertPhotosFromCloud = async (photos: CloudPhotoRecord[]) => {
  if (photos.length === 0) return;
  const db = getDB();

  photos.forEach((photo) => {
    const timestamp = new Date(photo.taken_at).getTime();
    if (!photo.local_id || !photo.session_id || Number.isNaN(timestamp)) return;

    db.runSync(
      `INSERT OR IGNORE INTO photos (
        id, session_id, latitude, longitude, local_uri, remote_path, public_url, timestamp, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      photo.local_id,
      photo.session_id,
      photo.latitude ?? 0,
      photo.longitude ?? 0,
      photo.local_uri ?? photo.public_url ?? '',
      photo.remote_path ?? null,
      photo.public_url ?? null,
      timestamp,
    );
  });
};

export const markPhotoAsSynced = async (
  id: number,
  remotePath: string,
  publicUrl: string | null,
) => {
  const db = getDB();
  db.runSync(
    'UPDATE photos SET synced = 1, remote_path = ?, public_url = ? WHERE id = ?',
    remotePath,
    publicUrl,
    id,
  );
};

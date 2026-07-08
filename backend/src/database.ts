import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { createRequire } from 'module';
import { randomInt, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { ReviewResult } from './engine.js';

const require = createRequire(import.meta.url);

export type Db = BetterSqlite3Database;

export interface UserRow {
  user_id: string;
  is_premium: number;
}

export interface ItemRow {
  item_id: string;
  user_id: string;
  content: string;
  notes: string;
  interval: number;
  ease_factor: number;
  repetitions: number;
  next_due_date: number;
}

export interface LogRow {
  id: number;
  item_id: string;
  user_id: string;
  quality: string;
  reviewed_at: number;
}

export function initDb(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id   TEXT PRIMARY KEY,
      is_premium INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS items (
      user_id       TEXT NOT NULL,
      item_id       TEXT NOT NULL,
      content       TEXT NOT NULL DEFAULT '',
      notes         TEXT NOT NULL DEFAULT '',
      interval      INTEGER NOT NULL DEFAULT 1,
      ease_factor   REAL NOT NULL DEFAULT 2.5,
      repetitions   INTEGER NOT NULL DEFAULT 0,
      next_due_date INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, item_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );

    CREATE TABLE IF NOT EXISTS review_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id     TEXT    NOT NULL,
      user_id     TEXT    NOT NULL,
      quality     TEXT    NOT NULL,
      reviewed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
  `);

  // Schema migrations — guarded by PRAGMA user_version so each runs exactly once
  const schemaVersion = (db.pragma('user_version', { simple: true }) as number);

  if (schemaVersion < 1) {
    // M1: add content/notes columns (old schema lacked them)
    const cols = (db.prepare('PRAGMA table_info(items)').all() as { name: string }[]).map(c => c.name);
    if (!cols.includes('content')) db.exec("ALTER TABLE items ADD COLUMN content TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('notes'))   db.exec("ALTER TABLE items ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
    db.pragma('user_version = 1');
  }

  if (schemaVersion < 2) {
    // M2: fix primary key — old schema had item_id as sole PK; new schema is (user_id, item_id)
    db.transaction(() => {
      db.exec(`ALTER TABLE items RENAME TO items_old`);
      db.exec(`
        CREATE TABLE items (
          user_id       TEXT NOT NULL,
          item_id       TEXT NOT NULL,
          content       TEXT NOT NULL DEFAULT '',
          notes         TEXT NOT NULL DEFAULT '',
          interval      INTEGER NOT NULL DEFAULT 1,
          ease_factor   REAL NOT NULL DEFAULT 2.5,
          repetitions   INTEGER NOT NULL DEFAULT 0,
          next_due_date INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, item_id),
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
      `);
      db.exec(`INSERT INTO items SELECT user_id, item_id, content, notes, interval, ease_factor, repetitions, next_due_date FROM items_old`);
      db.exec(`DROP TABLE items_old`);
      db.pragma('user_version = 2');
    })();
  }

  if (schemaVersion < 3) {
    // M3: display_name on users, plus circles/circle_members/circle_cheers tables
    const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
    if (!userCols.includes('display_name')) db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');

    db.exec(`
      CREATE TABLE IF NOT EXISTS circles (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        invite_code     TEXT NOT NULL UNIQUE,
        creator_user_id TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        FOREIGN KEY (creator_user_id) REFERENCES users(user_id)
      );

      CREATE TABLE IF NOT EXISTS circle_members (
        circle_id  TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        joined_at  INTEGER NOT NULL,
        PRIMARY KEY (circle_id, user_id),
        FOREIGN KEY (circle_id) REFERENCES circles(id),
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      );

      CREATE TABLE IF NOT EXISTS circle_cheers (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        circle_id     TEXT NOT NULL,
        from_user_id  TEXT NOT NULL,
        to_user_id    TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        FOREIGN KEY (circle_id) REFERENCES circles(id),
        FOREIGN KEY (from_user_id) REFERENCES users(user_id),
        FOREIGN KEY (to_user_id) REFERENCES users(user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_cheers_to ON circle_cheers(circle_id, to_user_id);
      CREATE INDEX IF NOT EXISTS idx_members_user ON circle_members(user_id);
    `);
    db.pragma('user_version = 3');
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_log_user ON review_log(user_id, reviewed_at);`);

  seedQuranIfEmpty(db);

  return db;
}

function seedQuranIfEmpty(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quran_ayahs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      surah      INTEGER NOT NULL,
      ayah       INTEGER NOT NULL,
      arabic     TEXT    NOT NULL,
      english    TEXT    NOT NULL DEFAULT '',
      surah_name TEXT    NOT NULL,
      UNIQUE(surah, ayah)
    );
    CREATE INDEX IF NOT EXISTS idx_quran_surah ON quran_ayahs(surah);
    CREATE VIRTUAL TABLE IF NOT EXISTS quran_fts USING fts5(
      english,
      surah_name,
      content='quran_ayahs',
      content_rowid='id'
    );
  `);

  const count = (db.prepare('SELECT COUNT(*) as n FROM quran_ayahs').get() as { n: number }).n;
  if (count > 0) return;

  console.log('Seeding Quran data…');
  interface Verse { id: number; text: string; translation: string; }
  interface Surah  { id: number; transliteration: string; translation: string; verses: Verse[]; }
  const quranEn: Surah[] = require('quran-json/dist/quran_en.json');

  const insertAyah = db.prepare(
    `INSERT OR IGNORE INTO quran_ayahs (surah, ayah, arabic, english, surah_name) VALUES (?, ?, ?, ?, ?)`
  );
  const insertFts = db.prepare(
    `INSERT INTO quran_fts (rowid, english, surah_name)
     SELECT id, english, surah_name FROM quran_ayahs
     WHERE surah = ? AND ayah = ? AND id NOT IN (SELECT rowid FROM quran_fts)`
  );

  db.transaction(() => {
    for (const surah of quranEn) {
      const label = `${surah.transliteration} (${surah.translation})`;
      for (const verse of surah.verses) {
        insertAyah.run(surah.id, verse.id, verse.text, verse.translation, label);
        insertFts.run(surah.id, verse.id);
      }
    }
  })();

  const seeded = (db.prepare('SELECT COUNT(*) as n FROM quran_ayahs').get() as { n: number }).n;
  console.log(`Quran seeded — ${seeded} ayahs.`);
}

export function createUser(db: Db, userId: string): void {
  db.prepare('INSERT OR IGNORE INTO users (user_id) VALUES (?)').run(userId);
}

export function getUser(db: Db, userId: string): UserRow | null {
  return (
    (db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as UserRow) ?? null
  );
}

export interface InitialDifficulty {
  interval?: number;
  ease_factor?: number;
  repetitions?: number;
  next_due_date?: number;
}

export function addItem(
  db: Db,
  userId: string,
  itemId: string,
  content: string = '',
  initial: InitialDifficulty = {}
): void {
  const user = getUser(db, userId);
  if (!user) throw new Error(`USER_NOT_FOUND: ${userId}`);

  if (user.is_premium === 0) {
    const count = (
      db
        .prepare('SELECT COUNT(*) as cnt FROM items WHERE user_id = ?')
        .get(userId) as { cnt: number }
    ).cnt;
    if (count >= 50) {
      throw new Error('LIMIT_REACHED');
    }
  }

  const interval     = initial.interval     ?? 1;
  const ease_factor  = initial.ease_factor  ?? 2.5;
  const repetitions  = initial.repetitions  ?? 0;
  const next_due_date = initial.next_due_date ?? Date.now();

  const { changes } = db
    .prepare(
      `INSERT OR IGNORE INTO items (user_id, item_id, content, interval, ease_factor, repetitions, next_due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, itemId, content, interval, ease_factor, repetitions, next_due_date);
  if (changes === 0) throw new Error('DUPLICATE_ITEM');
}

export function getDueItems(db: Db, userId: string): ItemRow[] {
  return db
    .prepare(
      'SELECT * FROM items WHERE user_id = ? AND next_due_date <= ? ORDER BY next_due_date ASC'
    )
    .all(userId, Date.now()) as ItemRow[];
}

export function getItem(db: Db, userId: string, itemId: string): ItemRow | null {
  return (
    (db.prepare('SELECT * FROM items WHERE user_id = ? AND item_id = ?').get(userId, itemId) as ItemRow) ?? null
  );
}

export function updateItem(db: Db, userId: string, itemId: string, result: ReviewResult): void {
  const { changes } = db
    .prepare(
      `UPDATE items
       SET interval = ?, ease_factor = ?, repetitions = ?, next_due_date = ?
       WHERE user_id = ? AND item_id = ?`
    )
    .run(result.interval, result.ease_factor, result.repetitions, result.next_due_date, userId, itemId);
  if (changes === 0) throw new Error(`ITEM_NOT_FOUND: ${itemId}`);
}

export function deleteItem(db: Db, userId: string, itemId: string): void {
  const { changes } = db.prepare('DELETE FROM items WHERE user_id = ? AND item_id = ?').run(userId, itemId);
  if (changes === 0) throw new Error(`ITEM_NOT_FOUND: ${itemId}`);
}

export function renameItem(
  db: Db,
  userId: string,
  oldItemId: string,
  newItemId: string,
  newContent: string
): void {
  if (oldItemId === newItemId) return;
  const old = getItem(db, userId, oldItemId);
  if (!old) throw new Error(`ITEM_NOT_FOUND: ${oldItemId}`);
  if (getItem(db, userId, newItemId)) throw new Error('DUPLICATE_ITEM');
  db.transaction(() => {
    db.prepare(
      `INSERT INTO items (user_id, item_id, content, notes, interval, ease_factor, repetitions, next_due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, newItemId, newContent, old.notes, old.interval, old.ease_factor, old.repetitions, old.next_due_date);
    db.prepare('DELETE FROM items WHERE user_id = ? AND item_id = ?').run(userId, oldItemId);
  })();
}

// ── Notes ───────────────────────────────────────────────────────────────────
export function updateNotes(db: Db, userId: string, itemId: string, notes: string): void {
  const { changes } = db.prepare('UPDATE items SET notes = ? WHERE user_id = ? AND item_id = ?').run(notes, userId, itemId);
  if (changes === 0) throw new Error(`ITEM_NOT_FOUND: ${itemId}`);
}

// ── Snooze ──────────────────────────────────────────────────────────────────
export function snoozeItem(db: Db, userId: string, itemId: string, days = 1): void {
  const future = Date.now() + days * 86_400_000;
  const { changes } = db.prepare('UPDATE items SET next_due_date = ? WHERE user_id = ? AND item_id = ?').run(future, userId, itemId);
  if (changes === 0) throw new Error(`ITEM_NOT_FOUND: ${itemId}`);
}

// ── Reschedule (arbitrary date) ─────────────────────────────────────────────
export function rescheduleItem(db: Db, userId: string, itemId: string, date: number): void {
  const { changes } = db.prepare('UPDATE items SET next_due_date = ? WHERE user_id = ? AND item_id = ?').run(date, userId, itemId);
  if (changes === 0) throw new Error(`ITEM_NOT_FOUND: ${itemId}`);
}

// ── All items (for stats) ───────────────────────────────────────────────────
export function getAllItems(db: Db, userId: string): ItemRow[] {
  return db.prepare(
    'SELECT * FROM items WHERE user_id = ? ORDER BY next_due_date ASC'
  ).all(userId) as ItemRow[];
}

// ── Review log ──────────────────────────────────────────────────────────────
export function logReview(db: Db, itemId: string, userId: string, quality: string): void {
  db.prepare(
    'INSERT INTO review_log (item_id, user_id, quality, reviewed_at) VALUES (?, ?, ?, ?)'
  ).run(itemId, userId, quality, Date.now());
}

export function undoReview(
  db: Db,
  userId: string,
  itemId: string,
  prevState: { interval: number; ease_factor: number; repetitions: number; next_due_date: number }
): void {
  db.transaction(() => {
    const { changes } = db.prepare(
      `UPDATE items SET interval = ?, ease_factor = ?, repetitions = ?, next_due_date = ?
       WHERE user_id = ? AND item_id = ?`
    ).run(prevState.interval, prevState.ease_factor, prevState.repetitions, prevState.next_due_date, userId, itemId);
    if (changes === 0) throw new Error(`ITEM_NOT_FOUND: ${itemId}`);
    db.prepare(
      `DELETE FROM review_log WHERE id = (
         SELECT id FROM review_log WHERE item_id = ? AND user_id = ? ORDER BY reviewed_at DESC LIMIT 1
       )`
    ).run(itemId, userId);
  })();
}

export function getReviewLog(db: Db, userId: string, limit = 100): LogRow[] {
  return db.prepare(
    `SELECT * FROM review_log WHERE user_id = ? ORDER BY reviewed_at DESC LIMIT ?`
  ).all(userId, limit) as LogRow[];
}

// ── Stats ────────────────────────────────────────────────────────────────────
export function getStats(db: Db, userId: string): {
  totalItems: number;
  allTimeReviews: number;
} {
  const totalItems = (
    db.prepare('SELECT COUNT(*) as n FROM items WHERE user_id = ?').get(userId) as { n: number }
  ).n;
  const allTimeReviews = (
    db.prepare('SELECT COUNT(*) as n FROM review_log WHERE user_id = ?').get(userId) as { n: number }
  ).n;
  return { totalItems, allTimeReviews };
}

export interface AyahRow {
  id: number;
  surah: number;
  ayah: number;
  arabic: string;
  english: string;
  surah_name: string;
}

export function searchAyahs(db: Db, query: string, limit = 20): AyahRow[] {
  // Strip FTS5 special characters to prevent query-syntax injection.
  // Wrapping in double-quotes makes it a phrase search; the trailing * allows prefix matching.
  const safeQuery = '"' + query.replace(/["*^():\-]/g, ' ').trim() + '"*';

  // FTS search first, fall back to LIKE if FTS table is empty or query is malformed
  try {
    const rows = db.prepare(
      `SELECT q.* FROM quran_ayahs q
       JOIN quran_fts f ON f.rowid = q.id
       WHERE quran_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    ).all(safeQuery, limit) as AyahRow[];
    // If FTS found nothing, try a broader fallback
    if (rows.length > 0) return rows;
    throw new Error('no fts results');
  } catch {
    const likeQ = '%' + query.replace(/[%_\\]/g, '\\$&') + '%';
    return db.prepare(
      `SELECT * FROM quran_ayahs
       WHERE arabic LIKE ? ESCAPE '\\'
          OR english LIKE ? ESCAPE '\\'
          OR surah_name LIKE ? ESCAPE '\\'
       LIMIT ?`
    ).all(likeQ, likeQ, likeQ, limit) as AyahRow[];
  }
}

export function getAyahRange(db: Db, surah: number, fromAyah: number, toAyah: number): AyahRow[] {
  return db.prepare(
    `SELECT * FROM quran_ayahs
     WHERE surah = ? AND ayah >= ? AND ayah <= ?
     ORDER BY ayah`
  ).all(surah, fromAyah, toAyah) as AyahRow[];
}

// ── Circles ──────────────────────────────────────────────────────────────────

export interface CircleRow {
  id: string;
  name: string;
  description: string;
  invite_code: string;
  creator_user_id: string;
  created_at: number;
}

export interface CircleMemberDetail {
  user_id: string;
  display_name: string;
  streak: number;
  last_reviewed_item_id: string | null;
  last_reviewed_at: number | null;
  cheer_count: number;
}

export interface CircleDetail extends CircleRow {
  members: CircleMemberDetail[];
}

const MAX_CIRCLES_PER_USER = 5;
const MAX_MEMBERS_PER_CIRCLE = 20;

function generateInviteCode(db: Db): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, avoids ambiguous codes
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[randomInt(chars.length)];
    const existing = db.prepare('SELECT 1 FROM circles WHERE invite_code = ?').get(code);
    if (!existing) return code;
  }
  throw new Error('COULD_NOT_GENERATE_INVITE_CODE');
}

export function setDisplayName(db: Db, userId: string, displayName: string): void {
  db.prepare('UPDATE users SET display_name = ? WHERE user_id = ?').run(displayName, userId);
}

export function createCircle(db: Db, userId: string, name: string, description: string): CircleRow {
  const count = (
    db.prepare('SELECT COUNT(*) as n FROM circle_members WHERE user_id = ?').get(userId) as { n: number }
  ).n;
  if (count >= MAX_CIRCLES_PER_USER) throw new Error('CIRCLE_CAP_REACHED');

  const id = `circle_${randomUUID()}`;
  const invite_code = generateInviteCode(db);
  const created_at = Date.now();

  db.transaction(() => {
    db.prepare(
      'INSERT INTO circles (id, name, description, invite_code, creator_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, name, description, invite_code, userId, created_at);
    db.prepare(
      'INSERT INTO circle_members (circle_id, user_id, joined_at) VALUES (?, ?, ?)'
    ).run(id, userId, created_at);
  })();

  return { id, name, description, invite_code, creator_user_id: userId, created_at };
}

export function joinCircle(db: Db, userId: string, inviteCode: string): CircleRow {
  const circle = db.prepare('SELECT * FROM circles WHERE invite_code = ?').get(inviteCode) as CircleRow | undefined;
  if (!circle) throw new Error('INVITE_NOT_FOUND');

  const alreadyMember = db.prepare(
    'SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?'
  ).get(circle.id, userId);
  if (alreadyMember) return circle; // idempotent — already joined, no-op success

  const userCircleCount = (
    db.prepare('SELECT COUNT(*) as n FROM circle_members WHERE user_id = ?').get(userId) as { n: number }
  ).n;
  if (userCircleCount >= MAX_CIRCLES_PER_USER) throw new Error('CIRCLE_CAP_REACHED');

  const memberCount = (
    db.prepare('SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ?').get(circle.id) as { n: number }
  ).n;
  if (memberCount >= MAX_MEMBERS_PER_CIRCLE) throw new Error('CIRCLE_FULL');

  db.prepare('INSERT INTO circle_members (circle_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(circle.id, userId, Date.now());

  return circle;
}

export function leaveCircle(db: Db, userId: string, circleId: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?').run(circleId, userId);
    const remaining = (
      db.prepare('SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ?').get(circleId) as { n: number }
    ).n;
    if (remaining === 0) {
      db.prepare('DELETE FROM circle_cheers WHERE circle_id = ?').run(circleId);
      db.prepare('DELETE FROM circles WHERE id = ?').run(circleId);
    }
  })();
}

export function getUserCircles(db: Db, userId: string): (CircleRow & { member_count: number })[] {
  return db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM circle_members cm2 WHERE cm2.circle_id = c.id) as member_count
     FROM circles c
     JOIN circle_members cm ON cm.circle_id = c.id
     WHERE cm.user_id = ?
     ORDER BY c.created_at DESC`
  ).all(userId) as (CircleRow & { member_count: number })[];
}

/** Streak = consecutive days with at least 1 review, counting back from today (UTC calendar days). */
function calcStreakFromTimestamps(timestamps: number[]): number {
  const dayStrings = new Set(timestamps.map(t => new Date(t).toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  for (;;) {
    const dayStr = cursor.toISOString().slice(0, 10);
    if (dayStrings.has(dayStr)) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export function getCircleDetail(db: Db, circleId: string): CircleDetail | null {
  const circle = db.prepare('SELECT * FROM circles WHERE id = ?').get(circleId) as CircleRow | undefined;
  if (!circle) return null;

  const memberIds = (
    db.prepare('SELECT user_id FROM circle_members WHERE circle_id = ?').all(circleId) as { user_id: string }[]
  ).map(r => r.user_id);

  const members: CircleMemberDetail[] = memberIds.map(userId => {
    const user = db.prepare('SELECT display_name FROM users WHERE user_id = ?').get(userId) as { display_name: string | null } | undefined;
    const reviewTimestamps = (
      db.prepare('SELECT reviewed_at FROM review_log WHERE user_id = ?').all(userId) as { reviewed_at: number }[]
    ).map(r => r.reviewed_at);
    const lastReview = db.prepare(
      'SELECT item_id, reviewed_at FROM review_log WHERE user_id = ? ORDER BY reviewed_at DESC LIMIT 1'
    ).get(userId) as { item_id: string; reviewed_at: number } | undefined;
    const cheerCount = (
      db.prepare('SELECT COUNT(*) as n FROM circle_cheers WHERE circle_id = ? AND to_user_id = ?').get(circleId, userId) as { n: number }
    ).n;

    return {
      user_id: userId,
      display_name: user?.display_name ?? 'Anonymous',
      streak: calcStreakFromTimestamps(reviewTimestamps),
      last_reviewed_item_id: lastReview?.item_id ?? null,
      last_reviewed_at: lastReview?.reviewed_at ?? null,
      cheer_count: cheerCount,
    };
  });

  return { ...circle, members };
}

export function addCheer(db: Db, circleId: string, fromUserId: string, toUserId: string): void {
  db.prepare('INSERT INTO circle_cheers (circle_id, from_user_id, to_user_id, created_at) VALUES (?, ?, ?, ?)')
    .run(circleId, fromUserId, toUserId, Date.now());
}

import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type { ReviewResult } from './engine.js';

export type Db = BetterSqlite3Database;

export interface UserRow {
  user_id: string;
  is_premium: number;
}

export interface ItemRow {
  item_id: string;
  user_id: string;
  interval: number;
  ease_factor: number;
  repetitions: number;
  next_due_date: number;
}

export function initDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id   TEXT PRIMARY KEY,
      is_premium INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS items (
      item_id       TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      interval      INTEGER NOT NULL DEFAULT 1,
      ease_factor   REAL NOT NULL DEFAULT 2.5,
      repetitions   INTEGER NOT NULL DEFAULT 0,
      next_due_date INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
  `);
  return db;
}

export function createUser(db: Db, userId: string): void {
  db.prepare('INSERT OR IGNORE INTO users (user_id) VALUES (?)').run(userId);
}

export function getUser(db: Db, userId: string): UserRow | null {
  return (
    (db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as UserRow) ?? null
  );
}

export function addItem(db: Db, userId: string, itemId: string): void {
  const user = getUser(db, userId);
  if (!user) throw new Error(`USER_NOT_FOUND: ${userId}`);

  if (user.is_premium === 0) {
    const count = (
      db
        .prepare('SELECT COUNT(*) as cnt FROM items WHERE user_id = ?')
        .get(userId) as { cnt: number }
    ).cnt;
    if (count >= 3) {
      throw new Error('LIMIT_REACHED');
    }
  }

  db
    .prepare(
      `INSERT INTO items (item_id, user_id, next_due_date)
       VALUES (?, ?, ?)`
    )
    .run(itemId, userId, Date.now());
}

export function getDueItems(db: Db, userId: string): ItemRow[] {
  return db
    .prepare(
      'SELECT * FROM items WHERE user_id = ? AND next_due_date <= ? ORDER BY next_due_date ASC'
    )
    .all(userId, Date.now()) as ItemRow[];
}

export function updateItem(db: Db, itemId: string, result: ReviewResult): void {
  const { changes } = db
    .prepare(
      `UPDATE items
       SET interval = ?, ease_factor = ?, repetitions = ?, next_due_date = ?
       WHERE item_id = ?`
    )
    .run(result.interval, result.ease_factor, result.repetitions, result.next_due_date, itemId);
  if (changes === 0) throw new Error(`ITEM_NOT_FOUND: ${itemId}`);
}

export function deleteItem(db: Db, itemId: string): void {
  const { changes } = db.prepare('DELETE FROM items WHERE item_id = ?').run(itemId);
  if (changes === 0) throw new Error(`ITEM_NOT_FOUND: ${itemId}`);
}

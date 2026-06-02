/**
 * seed-quran.ts
 * Populates the quran_ayahs and quran_fts tables from the quran-json package.
 * Run once (or re-run safely — it's idempotent):
 *   npm run seed
 */

import Database from 'better-sqlite3';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

interface Verse {
  id: number;
  text: string;
  translation: string;
}

interface Surah {
  id: number;
  name: string;
  transliteration: string;
  translation: string;
  verses: Verse[];
}

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'retainflow.db');
console.log(`Seeding Quran data into: ${DB_PATH}`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ── Create tables ───────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS quran_ayahs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    surah       INTEGER NOT NULL,
    ayah        INTEGER NOT NULL,
    arabic      TEXT    NOT NULL,
    english     TEXT    NOT NULL DEFAULT '',
    surah_name  TEXT    NOT NULL,
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

// ── Load and insert ─────────────────────────────────────────────────────────
const quranEn: Surah[] = require('quran-json/dist/quran_en.json');

const insertAyah = db.prepare(`
  INSERT OR IGNORE INTO quran_ayahs (surah, ayah, arabic, english, surah_name)
  VALUES (?, ?, ?, ?, ?)
`);

const insertFts = db.prepare(`
  INSERT INTO quran_fts (rowid, english, surah_name)
  SELECT id, english, surah_name FROM quran_ayahs
  WHERE surah = ? AND ayah = ?
    AND id NOT IN (SELECT rowid FROM quran_fts)
`);

let total = 0;
const seed = db.transaction(() => {
  for (const surah of quranEn) {
    const surahLabel = `${surah.transliteration} (${surah.translation})`;
    for (const verse of surah.verses) {
      insertAyah.run(surah.id, verse.id, verse.text, verse.translation, surahLabel);
      insertFts.run(surah.id, verse.id);
      total++;
    }
  }
});

seed();

const count = (db.prepare('SELECT COUNT(*) as n FROM quran_ayahs').get() as { n: number }).n;
console.log(`Done — ${count} ayahs seeded (${total} processed this run).`);
db.close();

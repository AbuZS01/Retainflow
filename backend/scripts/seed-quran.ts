import Database from 'better-sqlite3';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '../retainflow.db');

// Use createRequire to import JSON in ESM context
const require = createRequire(import.meta.url);

interface Verse {
  id: number;
  text: string;
  translation: string;
}

interface Chapter {
  id: number;
  name: string;
  transliteration: string;
  translation: string;
  type: string;
  total_verses: number;
  verses: Verse[];
}

async function seed() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create quran_ayahs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS quran_ayahs (
      id          INTEGER PRIMARY KEY,
      surah       INTEGER NOT NULL,
      ayah        INTEGER NOT NULL,
      arabic      TEXT NOT NULL,
      english     TEXT NOT NULL DEFAULT '',
      surah_name  TEXT NOT NULL,
      UNIQUE(surah, ayah)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS quran_fts
    USING fts5(arabic, english, surah_name, content='quran_ayahs', content_rowid='id');
  `);

  const existing = (db.prepare('SELECT COUNT(*) as cnt FROM quran_ayahs').get() as any).cnt;
  if (existing > 0) {
    console.log(`Already seeded (${existing} ayahs). Skipping.`);
    db.close();
    return;
  }

  console.log('Loading Quran data from quran-json package...');
  const quranEn: Chapter[] = require('quran-json/dist/quran_en.json');

  const insertAyah = db.prepare(
    'INSERT OR IGNORE INTO quran_ayahs (surah, ayah, arabic, english, surah_name) VALUES (?, ?, ?, ?, ?)'
  );
  const insertFts = db.prepare(
    'INSERT INTO quran_fts(rowid, arabic, english, surah_name) VALUES (?, ?, ?, ?)'
  );

  console.log('Seeding ayahs...');
  const insertAll = db.transaction(() => {
    for (const chapter of quranEn) {
      for (const verse of chapter.verses) {
        const result = insertAyah.run(
          chapter.id,
          verse.id,
          verse.text,
          verse.translation ?? '',
          chapter.transliteration
        );
        if (result.lastInsertRowid) {
          insertFts.run(result.lastInsertRowid, verse.text, verse.translation ?? '', chapter.transliteration);
        }
      }
    }
  });

  insertAll();

  const count = (db.prepare('SELECT COUNT(*) as cnt FROM quran_ayahs').get() as any).cnt;
  console.log(`✓ Seeded ${count} ayahs.`);
  db.close();
}

seed().catch(console.error);

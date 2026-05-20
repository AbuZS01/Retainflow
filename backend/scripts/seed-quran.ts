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

interface MuhsinVerse {
  chapter: number;
  verse: number;
  text: string;
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

  // Clear existing quran data to allow re-seeding with new translation
  db.exec('DELETE FROM quran_fts; DELETE FROM quran_ayahs;');
  // Reset the already-seeded check
  console.log('Cleared existing Quran data. Re-seeding with Muhsin Khan/Hilali translation...');

  console.log('Fetching Muhsin Khan/Hilali translation from CDN...');
  const cdnResponse = await fetch('https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/eng-muhammadtaqiudd.json');
  if (!cdnResponse.ok) {
    throw new Error(`Failed to fetch Muhsin Khan translation: ${cdnResponse.status} ${cdnResponse.statusText}`);
  }
  const muhsinData = await cdnResponse.json() as { quran: MuhsinVerse[] };

  // Build surah:ayah -> english text map
  const engMap = new Map<string, string>();
  for (const v of muhsinData.quran) {
    engMap.set(`${v.chapter}:${v.verse}`, v.text);
  }
  console.log(`Loaded ${engMap.size} verses from Muhsin Khan/Hilali translation.`);

  console.log('Loading Arabic Quran data from quran-json package...');
  const quranAr: Chapter[] = require('quran-json/dist/quran_en.json');

  const insertAyah = db.prepare(
    'INSERT OR IGNORE INTO quran_ayahs (surah, ayah, arabic, english, surah_name) VALUES (?, ?, ?, ?, ?)'
  );
  const insertFts = db.prepare(
    'INSERT INTO quran_fts(rowid, arabic, english, surah_name) VALUES (?, ?, ?, ?)'
  );

  console.log('Seeding ayahs...');
  const insertAll = db.transaction(() => {
    for (const chapter of quranAr) {
      for (const verse of chapter.verses) {
        const english = engMap.get(`${chapter.id}:${verse.id}`) ?? verse.translation ?? '';
        const result = insertAyah.run(
          chapter.id,
          verse.id,
          verse.text,
          english,
          chapter.transliteration
        );
        if (result.lastInsertRowid) {
          insertFts.run(result.lastInsertRowid, verse.text, english, chapter.transliteration);
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

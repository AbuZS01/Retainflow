import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import fastifyCompress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import { fileURLToPath } from 'url';
import path from 'path';
import { initDb, createUser, addItem, getDueItems, getAllItems, getItem, updateItem, deleteItem, renameItem, searchAyahs, getAyahRange, logReview, getReviewLog, getStats, updateNotes, snoozeItem, undoReview } from './database.js';
import { applyReview, type ReviewQuality } from './engine.js';

const VALID_QUALITIES = new Set<string>(['forgot', 'hard', 'good', 'easy']);

// Allowed origins: same-origin in production, localhost in dev.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

import type { FastifyReply } from 'fastify';

/** Returns false and sends 400 when user_id is missing — use as an early-return guard. */
function requireUserId(user_id: string | undefined, reply: FastifyReply): user_id is string {
  if (!user_id) { reply.status(400).send({ error: 'user_id required' }); return false; }
  return true;
}

export function buildApp(dbPath: string): FastifyInstance {
  const db = initDb(dbPath);
  const app = Fastify({ logger: false, bodyLimit: 600_000 });

  // Gzip/Brotli compression for all text responses
  app.register(fastifyCompress, { global: true });

  // Rate limiting: 60 req/min globally
  app.register(rateLimit, {
    global: true,
    max: 60,
    timeWindow: '1 minute',
  });

  // CORS: locked to explicit origins, not origin: true
  app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow requests with no Origin (same-origin, curl, mobile apps)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'), false);
    },
  });

  // POST /api/users
  app.post('/api/users', async (req, reply) => {
    const { user_id } = req.body as { user_id?: string };
    if (!user_id) return reply.status(400).send({ error: 'user_id required' });
    if (user_id.length > 200) return reply.status(400).send({ error: 'user_id too long (max 200 chars)' });
    createUser(db, user_id);
    return reply.status(201).send({ ok: true, user_id });
  });

  // POST /api/items
  app.post('/api/items', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { user_id, item_id, content = '', initial } = req.body as {
      user_id?: string;
      item_id?: string;
      content?: string;
      initial?: { interval?: number; ease_factor?: number; repetitions?: number; next_due_date?: number };
    };
    if (!user_id || !item_id)
      return reply.status(400).send({ error: 'user_id and item_id required' });
    if (user_id.length > 200 || item_id.length > 200)
      return reply.status(400).send({ error: 'user_id and item_id must be 200 chars or less' });

    // Ensure user exists — anonymous users may not have hit /api/users first
    createUser(db, user_id);

    // Content size guard — prevents disk-filling attacks
    if (typeof content === 'string' && content.length > 500_000)
      return reply.status(400).send({ error: 'content too large (max 500 KB)' });

    // Validate initial difficulty params if provided
    if (initial) {
      const { interval, ease_factor, repetitions, next_due_date } = initial;
      if (interval !== undefined && (typeof interval !== 'number' || interval < 1 || interval > 3650 || !Number.isFinite(interval)))
        return reply.status(400).send({ error: 'initial.interval must be 1–3650' });
      if (ease_factor !== undefined && (typeof ease_factor !== 'number' || ease_factor < 1.3 || ease_factor > 5.0 || !Number.isFinite(ease_factor)))
        return reply.status(400).send({ error: 'initial.ease_factor must be 1.3–5.0' });
      if (repetitions !== undefined && (typeof repetitions !== 'number' || repetitions < 0 || repetitions > 1000 || !Number.isInteger(repetitions)))
        return reply.status(400).send({ error: 'initial.repetitions must be an integer 0–1000' });
      if (next_due_date !== undefined && (typeof next_due_date !== 'number' || next_due_date < 0 || !Number.isFinite(next_due_date)))
        return reply.status(400).send({ error: 'initial.next_due_date must be a valid timestamp' });
    }

    try {
      addItem(db, user_id, item_id, content, initial ?? {});
      return reply.status(201).send({ ok: true, item_id });
    } catch (err: any) {
      if (err.message === 'LIMIT_REACHED')
        return reply.status(403).send({ error: 'LIMIT_REACHED', message: 'Free tier is limited to 50 parallel tracking decks.' });
      if (err.message === 'DUPLICATE_ITEM')
        return reply.status(409).send({ error: 'DUPLICATE_ITEM', message: 'This range is already in your queue.' });
      throw err;
    }
  });

  // GET /api/items/:userId
  app.get('/api/items/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const items = getDueItems(db, userId);
    return reply.send(items);
  });

  // GET /api/items/:userId/all
  app.get('/api/items/:userId/all', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const items = getAllItems(db, userId);
    return reply.send(items);
  });

  // PUT /api/items/:itemId/review
  app.put('/api/items/:itemId/review', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { quality, user_id } = req.body as { quality?: string; user_id?: string };
    if (!quality || !VALID_QUALITIES.has(quality))
      return reply.status(400).send({ error: 'quality must be one of: forgot, hard, good, easy' });
    if (!requireUserId(user_id, reply)) return;

    const row = getItem(db, user_id, itemId);
    if (!row) return reply.status(404).send({ error: 'item not found' });

    const result = applyReview(
      { interval: row.interval, ease_factor: row.ease_factor, repetitions: row.repetitions },
      quality as ReviewQuality
    );
    updateItem(db, user_id, itemId, result);
    logReview(db, itemId, user_id, quality);
    return reply.send({ ok: true, ...result });
  });

  // DELETE /api/items/:itemId
  app.delete('/api/items/:itemId', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { user_id } = (req.body ?? {}) as { user_id?: string };
    if (!requireUserId(user_id, reply)) return;
    try {
      deleteItem(db, user_id, itemId);
      return reply.send({ ok: true });
    } catch (err: any) {
      if (err.message.startsWith('ITEM_NOT_FOUND'))
        return reply.status(404).send({ error: 'ITEM_NOT_FOUND', message: 'Item not found' });
      throw err;
    }
  });

  // GET /api/stats/:userId
  app.get('/api/stats/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const counts = getStats(db, userId);
    const log    = getReviewLog(db, userId, 100);
    return reply.send({ ...counts, log });
  });

  // PUT /api/items/:itemId/notes
  app.put('/api/items/:itemId/notes', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { notes = '', user_id } = req.body as { notes?: string; user_id?: string };
    if (!requireUserId(user_id, reply)) return;
    if (typeof notes === 'string' && notes.length > 10_000)
      return reply.status(400).send({ error: 'notes too long (max 10,000 chars)' });
    updateNotes(db, user_id, itemId, notes);
    return reply.send({ ok: true });
  });

  // PUT /api/items/:itemId/snooze
  app.put('/api/items/:itemId/snooze', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { user_id } = req.body as { user_id?: string };
    if (!requireUserId(user_id, reply)) return;
    snoozeItem(db, user_id, itemId);
    return reply.send({ ok: true });
  });

  // GET /api/quran/search?q=...
  app.get('/api/quran/search', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { q } = req.query as { q?: string };
    if (!q || q.trim().length < 2)
      return reply.status(400).send({ error: 'query must be at least 2 characters' });
    if (q.trim().length > 100)
      return reply.status(400).send({ error: 'query too long (max 100 chars)' });
    const results = searchAyahs(db, q.trim());
    return reply.send(results);
  });

  // GET /api/quran/:surah/:from/:to
  app.get('/api/quran/:surah/:from/:to', async (req, reply) => {
    const { surah, from, to } = req.params as { surah: string; from: string; to: string };
    const s = parseInt(surah, 10);
    const f = parseInt(from, 10);
    const t = parseInt(to, 10);
    if (isNaN(s) || isNaN(f) || isNaN(t) || s < 1 || s > 114 || f < 1 || t < f || t - f > 300)
      return reply.status(400).send({ error: 'invalid range' });
    const ayahs = getAyahRange(db, s, f, t);
    return reply.send(ayahs);
  });

  // Security + cache headers on every response
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-XSS-Protection', '0'); // CSP is the right approach; disable legacy auditor
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    const url = req.url.split('?')[0]; // strip query string
    if (url === '/' || url.endsWith('index.html')) {
      // HTML entry point — never cache so users always get fresh shell
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      reply.header('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "media-src https://everyayah.com; " +
        "img-src 'self' data: https://api.qrserver.com; " +
        "connect-src 'self'; " +
        "frame-ancestors 'none';"
      );
    } else if (url.endsWith('sw.js')) {
      // Service worker — browser must not cache it (only the SW cache handles assets)
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (url.startsWith('/api/')) {
      // API responses — no caching
      reply.header('Cache-Control', 'no-store');
    } else if (/\.(js|css)$/.test(url)) {
      // App shell JS/CSS — always revalidate so SW picks up changes immediately
      reply.header('Cache-Control', 'no-cache');
    } else if (/\.(png|jpg|jpeg|svg|ico|webp|woff2?)$/.test(url)) {
      // Static media/fonts — long cache, these rarely change
      reply.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
    }
  });

  // Serve frontend in production
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendPath = path.join(__dirname, '../../frontend');
  app.register(fastifyStatic, { root: frontendPath, prefix: '/' });

  return app;
}

// Entrypoint when run directly
if (process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))) {
  const app = buildApp(process.env.DB_PATH ?? './retainflow.db');
  app.listen({ port: parseInt(process.env.PORT ?? '3000', 10), host: process.env.HOST ?? '127.0.0.1' }, (err, address) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`RetainFlow running at ${address}`);
  });
}

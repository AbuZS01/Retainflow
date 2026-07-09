import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import fastifyCompress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import { fileURLToPath } from 'url';
import path from 'path';
import { initDb, createUser, addItem, getDueItems, getAllItems, getItem, updateItem, deleteItem, renameItem, searchAyahs, getAyahRange, logReview, getReviewLog, getStats, updateNotes, snoozeItem, rescheduleItem, undoReview, setDisplayName, createCircle, joinCircle, leaveCircle, getUserCircles, getCircleDetail, addCheer, MAX_CIRCLES_PER_USER, MAX_MEMBERS_PER_CIRCLE } from './database.js';
import { applyReview as applySm2, type ReviewQuality } from './engine.js';
import { applyReview as applyFsrs } from './fsrs.js';
import { registerBillingRoutes } from './payments.js';

// Scheduler: FSRS-4.5 by default (set ENGINE=sm2 to roll back instantly).
const applyReview = (process.env.ENGINE ?? 'fsrs') === 'sm2' ? applySm2 : applyFsrs;

const VALID_QUALITIES = new Set<string>(['forgot', 'hard', 'good', 'easy']);

// Allowed origins: same-origin in production, localhost in dev.
// Production frontends are always allowed (the muraja'ah PWA is hosted on
// Vercel); ALLOWED_ORIGINS env var, when set, adds to — not replaces — these.
const PRODUCTION_ORIGINS = ['https://muraja-native.vercel.app'];
const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8081', 'http://localhost:19006'];
const ALLOWED_ORIGINS = [
  ...PRODUCTION_ORIGINS,
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : DEV_ORIGINS),
];

import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Resolve the caller's user_id. Preferred source is the `Authorization: Bearer`
 * header (keeps the credential out of URLs/logs); falls back to the route param,
 * body, or query for older clients (the web frontend still uses those).
 */
function userIdFrom(req: FastifyRequest): string | undefined {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const id = auth.slice(7).trim();
    if (id) return id;
  }
  const p = (req.params as { userId?: string } | undefined)?.userId;
  if (p) return p;
  const b = (req.body as { user_id?: string } | undefined)?.user_id;
  if (b) return b;
  const q = (req.query as { user_id?: string } | undefined)?.user_id;
  if (q) return q;
  return undefined;
}

/** Returns false and sends 400 when user_id is missing — use as an early-return guard. */
function requireUserId(user_id: string | undefined, reply: FastifyReply): user_id is string {
  if (!user_id) { reply.status(400).send({ error: 'user_id required' }); return false; }
  return true;
}

export function buildApp(dbPath: string): FastifyInstance {
  const db = initDb(dbPath);
  const app = Fastify({ logger: false, bodyLimit: 600_000 });

  // One canonical domain — 301 stray hosts (onrender.com, fly.dev, etc.)
  // so users never split their localStorage identity across origins.
  const CANONICAL_HOST = process.env.CANONICAL_HOST;
  if (CANONICAL_HOST) {
    app.addHook('onRequest', async (req, reply) => {
      const host = (req.headers.host ?? '').split(':')[0];
      if (host && host !== CANONICAL_HOST && host !== 'localhost' && host !== '127.0.0.1') {
        return reply.code(301).redirect(`https://${CANONICAL_HOST}${req.url}`);
      }
    });
  }

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
    // @fastify/cors defaults to GET,HEAD,POST — the reschedule/undo/notes/snooze
    // routes use PUT and the swipe-to-delete route uses DELETE, so both must be
    // listed explicitly or their preflight requests get rejected.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
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

  // Due items — header-auth (preferred) and legacy path variant.
  const dueHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = userIdFrom(req);
    if (!requireUserId(userId, reply)) return;
    return reply.send(getDueItems(db, userId));
  };
  app.get('/api/me/due', dueHandler);
  app.get('/api/items/:userId', dueHandler);

  // All items — header-auth (preferred) and legacy path variant.
  const allHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = userIdFrom(req);
    if (!requireUserId(userId, reply)) return;
    return reply.send(getAllItems(db, userId));
  };
  app.get('/api/me/all', allHandler);
  app.get('/api/items/:userId/all', allHandler);

  // PUT /api/items/:itemId/review
  app.put('/api/items/:itemId/review', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { quality } = req.body as { quality?: string };
    const user_id = userIdFrom(req);
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
    // Prefer the Authorization header — reliable even when proxies strip DELETE bodies.
    const user_id = userIdFrom(req);
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

  // PUT /api/items/:itemId/range
  app.put('/api/items/:itemId/range', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { surah, from, to } = req.body as {
      surah?: number; from?: number; to?: number;
    };
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
    if (
      typeof surah !== 'number' || typeof from !== 'number' || typeof to !== 'number' ||
      surah < 1 || surah > 114 || from < 1 || to < from || to - from > 300
    ) return reply.status(400).send({ error: 'invalid range' });

    const newItemId = `surah-${surah}-ayat-${from}-${to}`;
    const ayahs = getAyahRange(db, surah, from, to);
    const newContent = ayahs.map(a => `${a.arabic}\n${a.english}`).join('\n\n');
    try {
      renameItem(db, user_id, itemId, newItemId, newContent);
      return reply.send({ ok: true, item_id: newItemId });
    } catch (err: any) {
      if (err.message.startsWith('ITEM_NOT_FOUND'))
        return reply.status(404).send({ error: 'ITEM_NOT_FOUND' });
      if (err.message === 'DUPLICATE_ITEM')
        return reply.status(409).send({ error: 'DUPLICATE_ITEM', message: 'That range is already tracked.' });
      throw err;
    }
  });

  // Stats — header-auth (preferred) and legacy path variant.
  const statsHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = userIdFrom(req);
    if (!requireUserId(userId, reply)) return;
    const counts = getStats(db, userId);
    const log    = getReviewLog(db, userId, 100);
    return reply.send({ ...counts, log });
  };
  app.get('/api/me/stats', statsHandler);
  app.get('/api/stats/:userId', statsHandler);

  // PUT /api/items/:itemId/notes
  app.put('/api/items/:itemId/notes', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { notes = '' } = req.body as { notes?: string };
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
    if (typeof notes === 'string' && notes.length > 10_000)
      return reply.status(400).send({ error: 'notes too long (max 10,000 chars)' });
    updateNotes(db, user_id, itemId, notes);
    return reply.send({ ok: true });
  });

  // PUT /api/items/:itemId/snooze
  app.put('/api/items/:itemId/snooze', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { days = 1 } = req.body as { days?: number };
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
    if (![1, 3, 7, 14].includes(days))
      return reply.status(400).send({ error: 'days must be 1, 3, 7, or 14' });
    snoozeItem(db, user_id, itemId, days);
    return reply.send({ ok: true });
  });

  // PUT /api/items/:itemId/reschedule
  app.put('/api/items/:itemId/reschedule', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { date } = req.body as { date?: number };
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
    if (typeof date !== 'number' || !Number.isFinite(date) || date < 0)
      return reply.status(400).send({ error: 'date must be a valid timestamp (ms)' });
    // Cap at 2 years out — sanity guard
    const twoYears = Date.now() + 730 * 86_400_000;
    if (date > twoYears)
      return reply.status(400).send({ error: 'date too far in the future (max 2 years)' });
    try {
      rescheduleItem(db, user_id, itemId, date);
      return reply.send({ ok: true });
    } catch (err: any) {
      if (err.message.startsWith('ITEM_NOT_FOUND'))
        return reply.status(404).send({ error: 'ITEM_NOT_FOUND' });
      throw err;
    }
  });

  // PUT /api/items/:itemId/undo-review
  app.put('/api/items/:itemId/undo-review', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { prev_state } = req.body as {
      prev_state?: { interval: number; ease_factor: number; repetitions: number; next_due_date: number };
    };
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
    if (
      !prev_state ||
      typeof prev_state.interval !== 'number' ||
      typeof prev_state.ease_factor !== 'number' ||
      typeof prev_state.repetitions !== 'number' ||
      typeof prev_state.next_due_date !== 'number'
    ) return reply.status(400).send({ error: 'prev_state required with interval, ease_factor, repetitions, next_due_date' });

    try {
      undoReview(db, user_id, itemId, prev_state);
      return reply.send({ ok: true });
    } catch (err: any) {
      if (err.message.startsWith('ITEM_NOT_FOUND'))
        return reply.status(404).send({ error: 'ITEM_NOT_FOUND' });
      throw err;
    }
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
    return reply.send(ayahs.map(a => ({ ...a, indopak: a.arabic })));
  });

  // PUT /api/me/display_name
  app.put('/api/me/display_name', async (req, reply) => {
    const { display_name } = req.body as { display_name?: string };
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
    const trimmed = (display_name ?? '').trim();
    if (trimmed.length === 0) return reply.status(400).send({ error: 'display_name required' });
    if (trimmed.length > 40) return reply.status(400).send({ error: 'display_name must be 40 characters or less' });
    setDisplayName(db, user_id, trimmed);
    return reply.send({ ok: true });
  });

  // POST /api/circles
  app.post('/api/circles', async (req, reply) => {
    const { name, description = '' } = req.body as { name?: string; description?: string };
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
    if (!name || !name.trim()) return reply.status(400).send({ error: 'name required' });
    if (name.length > 60) return reply.status(400).send({ error: 'name must be 60 characters or less' });
    if (description.length > 300) return reply.status(400).send({ error: 'description must be 300 characters or less' });
    try {
      const circle = createCircle(db, user_id, name.trim(), description.trim());
      return reply.status(201).send(circle);
    } catch (err: any) {
      if (err.message === 'CIRCLE_CAP_REACHED')
        return reply.status(403).send({ error: 'CIRCLE_CAP_REACHED', message: `You can only join or create up to ${MAX_CIRCLES_PER_USER} circles.` });
      throw err;
    }
  });

  // POST /api/circles/join
  app.post('/api/circles/join', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { invite_code } = req.body as { invite_code?: string };
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
    if (!invite_code || !invite_code.trim()) return reply.status(400).send({ error: 'invite_code required' });
    try {
      const circle = joinCircle(db, user_id, invite_code.trim().toUpperCase());
      return reply.send(circle);
    } catch (err: any) {
      if (err.message === 'INVITE_NOT_FOUND')
        return reply.status(404).send({ error: 'INVITE_NOT_FOUND', message: 'That invite code was not found.' });
      if (err.message === 'CIRCLE_CAP_REACHED')
        return reply.status(403).send({ error: 'CIRCLE_CAP_REACHED', message: `You can only join or create up to ${MAX_CIRCLES_PER_USER} circles.` });
      if (err.message === 'CIRCLE_FULL')
        return reply.status(403).send({ error: 'CIRCLE_FULL', message: `This circle is full (${MAX_MEMBERS_PER_CIRCLE} members max).` });
      throw err;
    }
  });

  // POST /api/circles/:id/leave
  app.post('/api/circles/:id/leave', async (req, reply) => {
    const { id } = req.params as { id: string };
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
    const myCircles = getUserCircles(db, user_id);
    if (!myCircles.some(c => c.id === id))
      return reply.status(404).send({ error: 'CIRCLE_NOT_FOUND' });
    leaveCircle(db, user_id, id);
    return reply.send({ ok: true });
  });

  // GET /api/circles
  app.get('/api/circles', async (req, reply) => {
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
    return reply.send(getUserCircles(db, user_id));
  });

  // GET /api/circles/:id
  app.get('/api/circles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
    // Membership check BEFORE returning any data — the critical scoping boundary.
    const myCircles = getUserCircles(db, user_id);
    if (!myCircles.some(c => c.id === id))
      return reply.status(404).send({ error: 'CIRCLE_NOT_FOUND' });
    const detail = getCircleDetail(db, id);
    if (!detail) return reply.status(404).send({ error: 'CIRCLE_NOT_FOUND' });
    return reply.send(detail);
  });

  // POST /api/circles/:id/cheer/:userId
  //
  // NOTE: this route has a route param named `:userId`, which collides with
  // one of userIdFrom's fallback lookup sources (req.params.userId). Here
  // `:userId` is the CHEER TARGET's id, not the caller's — using userIdFrom
  // as-is would be correct only because it checks the Authorization header
  // first and returns immediately when present. To avoid relying on that
  // implicit ordering for a security-relevant "who is the caller" decision,
  // the caller's id is resolved directly from the header here.
  app.post('/api/circles/:id/cheer/:userId', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id, userId: targetUserId } = req.params as { id: string; userId: string };
    const auth = req.headers['authorization'];
    const user_id = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    if (!requireUserId(user_id, reply)) return;
    const myCircles = getUserCircles(db, user_id);
    if (!myCircles.some(c => c.id === id))
      return reply.status(404).send({ error: 'CIRCLE_NOT_FOUND' });
    const detail = getCircleDetail(db, id);
    if (!detail || !detail.members.some(m => m.user_id === targetUserId))
      return reply.status(404).send({ error: 'MEMBER_NOT_FOUND' });
    addCheer(db, id, user_id, targetUserId);
    return reply.send({ ok: true });
  });

  // Full data export ("your data is yours") — header-auth + legacy path variant.
  const exportHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = userIdFrom(req);
    if (!requireUserId(userId, reply)) return;
    const items = getAllItems(db, userId);
    const log = getReviewLog(db, userId, 10_000);
    const stats = getStats(db, userId);
    reply.header('Content-Disposition', 'attachment; filename="murajah-export.json"');
    return reply.send({
      app: "muraja'ah",
      exported_at: new Date().toISOString(),
      user_id: userId,
      stats, items, review_log: log,
    });
  };
  const exportOpts = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };
  app.get('/api/me/export', exportOpts, exportHandler);
  app.get('/api/export/:userId', exportOpts, exportHandler);

  // Stripe billing (one-time lifetime purchase) — no-ops if env not set
  registerBillingRoutes(app, db);

  // Security + cache headers on every response
  app.addHook('onSend', async (req, reply) => {
    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
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
        "script-src 'self'; " +
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "media-src https://everyayah.com; " +
        "img-src 'self' data: https://api.qrserver.com; " +
        "connect-src 'self'; " +
        "object-src 'none'; " +
        "base-uri 'none'; " +
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

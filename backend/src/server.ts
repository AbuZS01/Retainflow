import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { fileURLToPath } from 'url';
import path from 'path';
import { initDb, createUser, addItem, getDueItems, getItem, updateItem, deleteItem } from './database.js';
import { applyReview, type ReviewQuality } from './engine.js';

const VALID_QUALITIES = new Set<string>(['forgot', 'hard', 'good', 'easy']);

export function buildApp(dbPath: string): FastifyInstance {
  const db = initDb(dbPath);
  const app = Fastify({ logger: false });

  app.register(fastifyCors, { origin: true });

  // POST /api/users
  app.post('/api/users', async (req, reply) => {
    const { user_id } = req.body as { user_id?: string };
    if (!user_id) return reply.status(400).send({ error: 'user_id required' });
    if (user_id.length > 200) return reply.status(400).send({ error: 'user_id too long (max 200 chars)' });
    createUser(db, user_id);
    return reply.status(201).send({ ok: true, user_id });
  });

  // POST /api/items
  app.post('/api/items', async (req, reply) => {
    const { user_id, item_id } = req.body as { user_id?: string; item_id?: string };
    if (!user_id || !item_id)
      return reply.status(400).send({ error: 'user_id and item_id required' });
    if (user_id.length > 200 || item_id.length > 200)
      return reply.status(400).send({ error: 'user_id and item_id must be 200 chars or less' });
    try {
      addItem(db, user_id, item_id);
      return reply.status(201).send({ ok: true, item_id });
    } catch (err: any) {
      if (err.message === 'LIMIT_REACHED') {
        return reply.status(403).send({
          error: 'LIMIT_REACHED',
          message: 'Free tier is limited to 3 parallel tracking decks.',
        });
      }
      if (err.message.startsWith('USER_NOT_FOUND')) {
        return reply.status(404).send({ error: 'USER_NOT_FOUND', message: 'User not found' });
      }
      if (err.message.includes('UNIQUE constraint failed')) {
        return reply.status(409).send({ error: 'DUPLICATE_ITEM', message: 'Item ID already exists.' });
      }
      throw err;
    }
  });

  // GET /api/items/:userId
  app.get('/api/items/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const items = getDueItems(db, userId);
    return reply.send(items);
  });

  // PUT /api/items/:itemId/review
  app.put('/api/items/:itemId/review', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    const { quality } = req.body as { quality?: string };
    if (!quality || !VALID_QUALITIES.has(quality))
      return reply.status(400).send({ error: 'quality must be one of: forgot, hard, good, easy' });

    const row = getItem(db, itemId);
    if (!row) return reply.status(404).send({ error: 'item not found' });

    const result = applyReview(
      { interval: row.interval, ease_factor: row.ease_factor, repetitions: row.repetitions },
      quality as ReviewQuality
    );
    updateItem(db, itemId, result);
    return reply.send({ ok: true, ...result });
  });

  // DELETE /api/items/:itemId
  app.delete('/api/items/:itemId', async (req, reply) => {
    const { itemId } = req.params as { itemId: string };
    try {
      deleteItem(db, itemId);
      return reply.send({ ok: true });
    } catch (err: any) {
      if (err.message.startsWith('ITEM_NOT_FOUND')) {
        return reply.status(404).send({ error: 'ITEM_NOT_FOUND', message: 'Item not found' });
      }
      throw err;
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
  app.listen({ port: 3000, host: '0.0.0.0' }, (err, address) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`RetainFlow running at ${address}`);
  });
}

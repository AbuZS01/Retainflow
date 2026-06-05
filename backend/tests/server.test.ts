import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/server.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp(':memory:');
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('POST /api/users', () => {
  it('creates a user and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { user_id: 'test-user-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ ok: true, user_id: 'test-user-1' });
  });

  it('returns 400 if user_id missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/users', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/items', () => {
  it('adds an item and returns 201', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { user_id: 'test-user-2' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { user_id: 'test-user-2', item_id: 'surah-1-1' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('stores content when provided', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'content-user' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { user_id: 'content-user', item_id: 'verse-with-content', content: 'Hello world' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('returns 403 with LIMIT_REACHED after 50 free items', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { user_id: 'free-user-limit' },
    });
    for (let i = 1; i <= 50; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/items',
        payload: { user_id: 'free-user-limit', item_id: `item-${i}` },
      });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { user_id: 'free-user-limit', item_id: 'item-51' },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('LIMIT_REACHED');
    expect(body.message).toBe('Free tier is limited to 50 parallel tracking decks.');
  });
});

describe('GET /api/items/:userId', () => {
  it('returns due items array', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { user_id: 'test-user-3' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { user_id: 'test-user-3', item_id: 'page-1' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/items/test-user-3' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].item_id).toBe('page-1');
  });
});

describe('PUT /api/items/:itemId/review', () => {
  it('submits a review and updates the item', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { user_id: 'test-user-4' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { user_id: 'test-user-4', item_id: 'card-review' },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/card-review/review',
      payload: { quality: 'good', user_id: 'test-user-4' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.next_due_date).toBeGreaterThan(Date.now());
  });

  it('returns 400 for invalid quality value', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/card-review/review',
      payload: { quality: 'unknown' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/items/:itemId', () => {
  it('deletes an item and returns 200', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { user_id: 'test-user-5' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { user_id: 'test-user-5', item_id: 'to-del' },
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/items/to-del', payload: { user_id: 'test-user-5' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

describe('PUT /api/items/:itemId/range', () => {
  it('renames item and returns new item_id', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'u-editrange' } });
    await app.inject({ method: 'POST', url: '/api/items', payload: { user_id: 'u-editrange', item_id: 'surah-1-ayat-1-3' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-1-ayat-1-3/range',
      payload: { user_id: 'u-editrange', surah: 1, from: 1, to: 5 },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).item_id).toBe('surah-1-ayat-1-5');
  });

  it('returns 400 for invalid range (to < from)', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'u-editrange2' } });
    await app.inject({ method: 'POST', url: '/api/items', payload: { user_id: 'u-editrange2', item_id: 'surah-1-ayat-1-3' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-1-ayat-1-3/range',
      payload: { user_id: 'u-editrange2', surah: 1, from: 5, to: 3 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /api/items/:itemId/undo-review', () => {
  it('restores item state', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'u-undo2' } });
    await app.inject({ method: 'POST', url: '/api/items', payload: { user_id: 'u-undo2', item_id: 'surah-2-ayat-1-5' } });
    await app.inject({ method: 'PUT', url: '/api/items/surah-2-ayat-1-5/review', payload: { user_id: 'u-undo2', quality: 'easy' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-2-ayat-1-5/undo-review',
      payload: { user_id: 'u-undo2', prev_state: { interval: 1, ease_factor: 2.5, repetitions: 0, next_due_date: 0 } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 if prev_state missing', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-2-ayat-1-5/undo-review',
      payload: { user_id: 'u-undo2' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /api/items/:itemId/snooze with days', () => {
  it('accepts days=7', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'u-snoozedays' } });
    await app.inject({ method: 'POST', url: '/api/items', payload: { user_id: 'u-snoozedays', item_id: 'surah-3-ayat-1-5' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-3-ayat-1-5/snooze',
      payload: { user_id: 'u-snoozedays', days: 7 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for invalid days value (5)', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'u-snoozedays2' } });
    await app.inject({ method: 'POST', url: '/api/items', payload: { user_id: 'u-snoozedays2', item_id: 'surah-4-ayat-1-5' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/items/surah-4-ayat-1-5/snooze',
      payload: { user_id: 'u-snoozedays2', days: 5 },
    });
    expect(res.statusCode).toBe(400);
  });
});

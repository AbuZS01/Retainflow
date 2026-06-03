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

  it('returns 403 with LIMIT_REACHED after 5 free items', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { user_id: 'free-user-limit' },
    });
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await app.inject({
        method: 'POST',
        url: '/api/items',
        payload: { user_id: 'free-user-limit', item_id: id },
      });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/items',
      payload: { user_id: 'free-user-limit', item_id: 'f' },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('LIMIT_REACHED');
    expect(body.message).toBe('Free tier is limited to 5 parallel tracking decks.');
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

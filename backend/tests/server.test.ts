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

describe('PUT /api/me/display_name', () => {
  it('sets a display name', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'dn-user-1' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/display_name',
      headers: { authorization: 'Bearer dn-user-1' },
      payload: { display_name: 'Zayd' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('rejects empty display name', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'dn-user-2' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/display_name',
      headers: { authorization: 'Bearer dn-user-2' },
      payload: { display_name: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects display name over 40 chars', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'dn-user-3' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/me/display_name',
      headers: { authorization: 'Bearer dn-user-3' },
      payload: { display_name: 'x'.repeat(41) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/circles', () => {
  it('creates a circle', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'circ-creator-1' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/circles',
      headers: { authorization: 'Bearer circ-creator-1' },
      payload: { name: 'Test Circle', description: 'A test' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('Test Circle');
    expect(body.invite_code).toMatch(/^[A-Z0-9]{8}$/);
  });

  it('rejects missing name', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'circ-creator-2' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/circles',
      headers: { authorization: 'Bearer circ-creator-2' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 at the 5-circle cap', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'circ-creator-3' } });
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST', url: '/api/circles',
        headers: { authorization: 'Bearer circ-creator-3' },
        payload: { name: `Circle ${i}` },
      });
    }
    const res = await app.inject({
      method: 'POST', url: '/api/circles',
      headers: { authorization: 'Bearer circ-creator-3' },
      payload: { name: 'One Too Many' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/circles/join', () => {
  it('joins by invite code', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'join-creator-1' } });
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'join-joiner-1' } });
    const createRes = await app.inject({
      method: 'POST', url: '/api/circles',
      headers: { authorization: 'Bearer join-creator-1' },
      payload: { name: 'Joinable' },
    });
    const { invite_code } = JSON.parse(createRes.body);
    const joinRes = await app.inject({
      method: 'POST', url: '/api/circles/join',
      headers: { authorization: 'Bearer join-joiner-1' },
      payload: { invite_code },
    });
    expect(joinRes.statusCode).toBe(200);
  });

  it('returns 404 for an invalid code', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'join-user-bad-code' } });
    const res = await app.inject({
      method: 'POST', url: '/api/circles/join',
      headers: { authorization: 'Bearer join-user-bad-code' },
      payload: { invite_code: 'NOTREAL1' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/circles', () => {
  it('lists circles the caller is a member of', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'list-user-1' } });
    await app.inject({
      method: 'POST', url: '/api/circles',
      headers: { authorization: 'Bearer list-user-1' },
      payload: { name: 'Listed Circle' },
    });
    const res = await app.inject({
      method: 'GET', url: '/api/circles',
      headers: { authorization: 'Bearer list-user-1' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Listed Circle');
  });
});

describe('GET /api/circles/:id', () => {
  it('returns circle detail with member data for a member', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'detail-user-1' } });
    const createRes = await app.inject({
      method: 'POST', url: '/api/circles',
      headers: { authorization: 'Bearer detail-user-1' },
      payload: { name: 'Detail Circle' },
    });
    const { id } = JSON.parse(createRes.body);
    const res = await app.inject({
      method: 'GET', url: `/api/circles/${id}`,
      headers: { authorization: 'Bearer detail-user-1' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.members).toHaveLength(1);
    expect(body.members[0].user_id).toBe('detail-user-1');
  });

  it('returns 404 for a non-member', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'detail-owner-1' } });
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'detail-outsider-1' } });
    const createRes = await app.inject({
      method: 'POST', url: '/api/circles',
      headers: { authorization: 'Bearer detail-owner-1' },
      payload: { name: 'Private Circle' },
    });
    const { id } = JSON.parse(createRes.body);
    const res = await app.inject({
      method: 'GET', url: `/api/circles/${id}`,
      headers: { authorization: 'Bearer detail-outsider-1' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/circles/:id/leave', () => {
  it('removes the caller from the circle', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'leave-user-1' } });
    const createRes = await app.inject({
      method: 'POST', url: '/api/circles',
      headers: { authorization: 'Bearer leave-user-1' },
      payload: { name: 'Leaving Soon' },
    });
    const { id } = JSON.parse(createRes.body);
    const leaveRes = await app.inject({
      method: 'POST', url: `/api/circles/${id}/leave`,
      headers: { authorization: 'Bearer leave-user-1' },
    });
    expect(leaveRes.statusCode).toBe(200);
    const listRes = await app.inject({
      method: 'GET', url: '/api/circles',
      headers: { authorization: 'Bearer leave-user-1' },
    });
    expect(JSON.parse(listRes.body)).toHaveLength(0);
  });
});

describe('POST /api/circles/:id/cheer/:userId', () => {
  it('lets a fellow member cheer another', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'cheer-creator-1' } });
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'cheer-target-1' } });
    const createRes = await app.inject({
      method: 'POST', url: '/api/circles',
      headers: { authorization: 'Bearer cheer-creator-1' },
      payload: { name: 'Cheer Circle' },
    });
    const { id, invite_code } = JSON.parse(createRes.body);
    await app.inject({
      method: 'POST', url: '/api/circles/join',
      headers: { authorization: 'Bearer cheer-target-1' },
      payload: { invite_code },
    });
    const cheerRes = await app.inject({
      method: 'POST', url: `/api/circles/${id}/cheer/cheer-target-1`,
      headers: { authorization: 'Bearer cheer-creator-1' },
    });
    expect(cheerRes.statusCode).toBe(200);
  });

  it('returns 404 if the target is not a member of the circle', async () => {
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'cheer-creator-2' } });
    await app.inject({ method: 'POST', url: '/api/users', payload: { user_id: 'cheer-non-member' } });
    const createRes = await app.inject({
      method: 'POST', url: '/api/circles',
      headers: { authorization: 'Bearer cheer-creator-2' },
      payload: { name: 'Cheer Circle 2' },
    });
    const { id } = JSON.parse(createRes.body);
    const cheerRes = await app.inject({
      method: 'POST', url: `/api/circles/${id}/cheer/cheer-non-member`,
      headers: { authorization: 'Bearer cheer-creator-2' },
    });
    expect(cheerRes.statusCode).toBe(404);
  });
});

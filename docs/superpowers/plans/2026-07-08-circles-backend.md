# Accountability Circles (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend support (schema, DB helpers, HTTP endpoints) for Accountability Circles — small named groups joined by invite code, where members see each other's real streak, last-reviewed item, and can send lightweight "cheer" reactions.

**Architecture:** Extend the existing SQLite schema (`database.ts`) with a guarded `user_version` migration (M3): a `display_name` column on `users`, plus `circles`/`circle_members`/`circle_cheers` tables. Add matching query helper functions to `database.ts`, then wire 7 new Fastify routes in `server.ts`, following the exact patterns (`userIdFrom`/`requireUserId`, rate-limit config, typed error responses) already used by every existing endpoint.

**Tech Stack:** Fastify, `better-sqlite3`, TypeScript, Vitest (`app.inject()` against `buildApp(':memory:')`, per the existing `tests/server.test.ts` convention).

**Spec:** `docs/superpowers/specs/2026-07-08-circles-backend-design.md`

**Note on running tests:** `CLAUDE.md` documents that `backend/package.json` is mismatched with the lockfile, so `npm test` may not work as expected. Run tests directly: `node_modules/.bin/vitest run tests/server.test.ts` from `C:\Users\Amir_\Retainflow\backend`. Verify this works before Task 1's first test run — if it doesn't, that's a pre-existing environment issue to report, not something to silently work around by weakening the plan.

---

## Task 1: Schema migration (M3)

**Files:**
- Modify: `backend/src/database.ts:71-108` (the migration block inside `initDb`)
- Test: `backend/tests/database.test.ts` (create if it doesn't already exist — check first; if a `database.test.ts` already exists, add to it instead of creating a duplicate)

- [ ] **Step 1: Check whether `backend/tests/database.test.ts` already exists**

Run: `ls backend/tests/` from `C:\Users\Amir_\Retainflow`. If `database.test.ts` exists, read it first to match its existing describe/it structure before adding new tests. If it doesn't exist, Step 2 creates it fresh.

- [ ] **Step 2: Write the failing test**

Add to `backend/tests/database.test.ts` (create the file with this content if it doesn't exist, using the same `import`/`beforeAll` pattern as `server.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';
import { initDb } from '../src/database.js';

describe('M3 migration: circles schema', () => {
  it('adds a nullable display_name column to users', () => {
    const db = initDb(':memory:');
    db.prepare('INSERT INTO users (user_id) VALUES (?)').run('m3-test-user');
    const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('display_name');
    const row = db.prepare('SELECT display_name FROM users WHERE user_id = ?').get('m3-test-user') as { display_name: string | null };
    expect(row.display_name).toBeNull();
  });

  it('creates circles, circle_members, and circle_cheers tables', () => {
    const db = initDb(':memory:');
    const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(t => t.name);
    expect(tableNames).toContain('circles');
    expect(tableNames).toContain('circle_members');
    expect(tableNames).toContain('circle_cheers');
  });

  it('enforces UNIQUE invite_code on circles', () => {
    const db = initDb(':memory:');
    db.exec(`INSERT INTO circles (id, name, invite_code, creator_user_id, created_at) VALUES ('c1', 'Test', 'CODE1234', 'u1', ${Date.now()})`);
    expect(() => {
      db.exec(`INSERT INTO circles (id, name, invite_code, creator_user_id, created_at) VALUES ('c2', 'Test2', 'CODE1234', 'u2', ${Date.now()})`);
    }).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/database.test.ts` from `C:\Users\Amir_\Retainflow\backend`
Expected: FAIL — `display_name` column doesn't exist yet, `circles`/`circle_members`/`circle_cheers` tables don't exist yet.

- [ ] **Step 4: Implement the migration**

In `backend/src/database.ts`, add a new migration block after the existing M2 block (after line 104, before the `db.exec(\`CREATE INDEX IF NOT EXISTS idx_log_user...\`)` line at 106):

```typescript
  if (schemaVersion < 3) {
    // M3: display_name on users, plus circles/circle_members/circle_cheers tables
    const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(c => c.name);
    if (!userCols.includes('display_name')) db.exec('ALTER TABLE users ADD COLUMN display_name TEXT');

    db.exec(`
      CREATE TABLE IF NOT EXISTS circles (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        invite_code     TEXT NOT NULL UNIQUE,
        creator_user_id TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        FOREIGN KEY (creator_user_id) REFERENCES users(user_id)
      );

      CREATE TABLE IF NOT EXISTS circle_members (
        circle_id  TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        joined_at  INTEGER NOT NULL,
        PRIMARY KEY (circle_id, user_id),
        FOREIGN KEY (circle_id) REFERENCES circles(id),
        FOREIGN KEY (user_id) REFERENCES users(user_id)
      );

      CREATE TABLE IF NOT EXISTS circle_cheers (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        circle_id     TEXT NOT NULL,
        from_user_id  TEXT NOT NULL,
        to_user_id    TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        FOREIGN KEY (circle_id) REFERENCES circles(id)
      );
      CREATE INDEX IF NOT EXISTS idx_cheers_to ON circle_cheers(circle_id, to_user_id);
      CREATE INDEX IF NOT EXISTS idx_members_user ON circle_members(user_id);
    `);
    db.pragma('user_version = 3');
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node_modules/.bin/vitest run tests/database.test.ts` from `C:\Users\Amir_\Retainflow\backend`
Expected: PASS (all 3 tests).

- [ ] **Step 6: Commit**

```bash
cd C:\Users\Amir_\Retainflow
git add backend/src/database.ts backend/tests/database.test.ts
git commit -m "Add M3 migration: display_name column + circles schema"
```

---

## Task 2: Database helper functions

**Files:**
- Modify: `backend/src/database.ts` (add new exported functions after `getAyahRange`, the last function in the file)
- Test: `backend/tests/database.test.ts` (same file as Task 1)

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/database.test.ts`:

```typescript
import {
  initDb, createUser, setDisplayName, createCircle, joinCircle, leaveCircle,
  getUserCircles, getCircleDetail, addCheer, logReview,
} from '../src/database.js';

describe('setDisplayName', () => {
  it('sets and retrieves a display name', () => {
    const db = initDb(':memory:');
    createUser(db, 'u1');
    setDisplayName(db, 'u1', 'Zayd');
    const row = db.prepare('SELECT display_name FROM users WHERE user_id = ?').get('u1') as { display_name: string };
    expect(row.display_name).toBe('Zayd');
  });
});

describe('createCircle', () => {
  it('creates a circle and adds the creator as a member', () => {
    const db = initDb(':memory:');
    createUser(db, 'creator1');
    const circle = createCircle(db, 'creator1', 'Juz Amma Crew', 'Memorizing Juz 30');
    expect(circle.name).toBe('Juz Amma Crew');
    expect(circle.invite_code).toMatch(/^[A-Z0-9]{8}$/);
    const circles = getUserCircles(db, 'creator1');
    expect(circles).toHaveLength(1);
    expect(circles[0].id).toBe(circle.id);
  });

  it('throws CIRCLE_CAP_REACHED after 5 circles', () => {
    const db = initDb(':memory:');
    createUser(db, 'u2');
    for (let i = 0; i < 5; i++) createCircle(db, 'u2', `Circle ${i}`, '');
    expect(() => createCircle(db, 'u2', 'One Too Many', '')).toThrow('CIRCLE_CAP_REACHED');
  });
});

describe('joinCircle', () => {
  it('joins by invite code', () => {
    const db = initDb(':memory:');
    createUser(db, 'creator2');
    createUser(db, 'joiner1');
    const circle = createCircle(db, 'creator2', 'Test Circle', '');
    joinCircle(db, 'joiner1', circle.invite_code);
    const joinerCircles = getUserCircles(db, 'joiner1');
    expect(joinerCircles.map(c => c.id)).toContain(circle.id);
  });

  it('is idempotent — joining twice does not error', () => {
    const db = initDb(':memory:');
    createUser(db, 'creator3');
    createUser(db, 'joiner2');
    const circle = createCircle(db, 'creator3', 'Test', '');
    joinCircle(db, 'joiner2', circle.invite_code);
    expect(() => joinCircle(db, 'joiner2', circle.invite_code)).not.toThrow();
  });

  it('throws INVITE_NOT_FOUND for an unknown code', () => {
    const db = initDb(':memory:');
    createUser(db, 'joiner3');
    expect(() => joinCircle(db, 'joiner3', 'NOTAREAL')).toThrow('INVITE_NOT_FOUND');
  });

  it('throws CIRCLE_FULL at 20 members', () => {
    const db = initDb(':memory:');
    createUser(db, 'creator4');
    const circle = createCircle(db, 'creator4', 'Full Circle', '');
    for (let i = 0; i < 19; i++) {
      createUser(db, `member${i}`);
      joinCircle(db, `member${i}`, circle.invite_code);
    }
    createUser(db, 'overflow');
    expect(() => joinCircle(db, 'overflow', circle.invite_code)).toThrow('CIRCLE_FULL');
  });

  it('throws CIRCLE_CAP_REACHED if the joiner is already in 5 circles', () => {
    const db = initDb(':memory:');
    createUser(db, 'busy-joiner');
    for (let i = 0; i < 5; i++) createCircle(db, 'busy-joiner', `Circle ${i}`, '');
    createUser(db, 'other-creator');
    const sixthCircle = createCircle(db, 'other-creator', 'Sixth', '');
    expect(() => joinCircle(db, 'busy-joiner', sixthCircle.invite_code)).toThrow('CIRCLE_CAP_REACHED');
  });
});

describe('leaveCircle', () => {
  it('removes membership', () => {
    const db = initDb(':memory:');
    createUser(db, 'creator5');
    createUser(db, 'leaver1');
    const circle = createCircle(db, 'creator5', 'Test', '');
    joinCircle(db, 'leaver1', circle.invite_code);
    leaveCircle(db, 'leaver1', circle.id);
    expect(getUserCircles(db, 'leaver1')).toHaveLength(0);
  });

  it('deletes the circle when the last member leaves', () => {
    const db = initDb(':memory:');
    createUser(db, 'solo-creator');
    const circle = createCircle(db, 'solo-creator', 'Solo', '');
    leaveCircle(db, 'solo-creator', circle.id);
    const row = db.prepare('SELECT * FROM circles WHERE id = ?').get(circle.id);
    expect(row).toBeUndefined();
  });
});

describe('getCircleDetail', () => {
  it('returns members with streak, last-reviewed item, and cheer count', () => {
    const db = initDb(':memory:');
    createUser(db, 'creator6');
    setDisplayName(db, 'creator6', 'Fatima');
    const circle = createCircle(db, 'creator6', 'Detail Test', '');
    const now = Date.now();
    const DAY = 86_400_000;
    logReview(db, 'surah-1-1-2', 'creator6', 'good');
    // Backdate two more reviews to build a 3-day streak (today, yesterday, 2 days ago)
    db.prepare('INSERT INTO review_log (item_id, user_id, quality, reviewed_at) VALUES (?, ?, ?, ?)')
      .run('surah-1-1-2', 'creator6', 'good', now - DAY);
    db.prepare('INSERT INTO review_log (item_id, user_id, quality, reviewed_at) VALUES (?, ?, ?, ?)')
      .run('surah-1-1-2', 'creator6', 'good', now - 2 * DAY);

    const detail = getCircleDetail(db, circle.id);
    expect(detail).not.toBeNull();
    expect(detail!.members).toHaveLength(1);
    const member = detail!.members[0];
    expect(member.user_id).toBe('creator6');
    expect(member.display_name).toBe('Fatima');
    expect(member.streak).toBe(3);
    expect(member.last_reviewed_item_id).toBe('surah-1-1-2');
    expect(member.cheer_count).toBe(0);
  });

  it('falls back to "Anonymous" when display_name is null', () => {
    const db = initDb(':memory:');
    createUser(db, 'no-name-user');
    const circle = createCircle(db, 'no-name-user', 'Anon Test', '');
    const detail = getCircleDetail(db, circle.id);
    expect(detail!.members[0].display_name).toBe('Anonymous');
  });

  it('returns null for a non-existent circle', () => {
    const db = initDb(':memory:');
    expect(getCircleDetail(db, 'no-such-circle')).toBeNull();
  });
});

describe('addCheer', () => {
  it('increments the cheer count for a member', () => {
    const db = initDb(':memory:');
    createUser(db, 'creator7');
    createUser(db, 'cheered-user');
    const circle = createCircle(db, 'creator7', 'Cheer Test', '');
    joinCircle(db, 'cheered-user', circle.invite_code);
    addCheer(db, circle.id, 'creator7', 'cheered-user');
    const detail = getCircleDetail(db, circle.id);
    const member = detail!.members.find(m => m.user_id === 'cheered-user');
    expect(member!.cheer_count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/database.test.ts` from `C:\Users\Amir_\Retainflow\backend`
Expected: FAIL — none of `setDisplayName`/`createCircle`/`joinCircle`/`leaveCircle`/`getUserCircles`/`getCircleDetail`/`addCheer` exist yet (TypeScript compile errors on the imports).

- [ ] **Step 3: Implement the helper functions**

Append to `backend/src/database.ts` (after the existing `getAyahRange` function, which is currently the last function in the file):

```typescript
// ── Circles ──────────────────────────────────────────────────────────────────

export interface CircleRow {
  id: string;
  name: string;
  description: string;
  invite_code: string;
  creator_user_id: string;
  created_at: number;
}

export interface CircleMemberDetail {
  user_id: string;
  display_name: string;
  streak: number;
  last_reviewed_item_id: string | null;
  last_reviewed_at: number | null;
  cheer_count: number;
}

export interface CircleDetail extends CircleRow {
  members: CircleMemberDetail[];
}

const MAX_CIRCLES_PER_USER = 5;
const MAX_MEMBERS_PER_CIRCLE = 20;

function generateInviteCode(db: Db): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, avoids ambiguous codes
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const existing = db.prepare('SELECT 1 FROM circles WHERE invite_code = ?').get(code);
    if (!existing) return code;
  }
  throw new Error('COULD_NOT_GENERATE_INVITE_CODE');
}

export function setDisplayName(db: Db, userId: string, displayName: string): void {
  db.prepare('UPDATE users SET display_name = ? WHERE user_id = ?').run(displayName, userId);
}

export function createCircle(db: Db, userId: string, name: string, description: string): CircleRow {
  const count = (
    db.prepare('SELECT COUNT(*) as n FROM circle_members WHERE user_id = ?').get(userId) as { n: number }
  ).n;
  if (count >= MAX_CIRCLES_PER_USER) throw new Error('CIRCLE_CAP_REACHED');

  const id = `circle_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const invite_code = generateInviteCode(db);
  const created_at = Date.now();

  db.transaction(() => {
    db.prepare(
      'INSERT INTO circles (id, name, description, invite_code, creator_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, name, description, invite_code, userId, created_at);
    db.prepare(
      'INSERT INTO circle_members (circle_id, user_id, joined_at) VALUES (?, ?, ?)'
    ).run(id, userId, created_at);
  })();

  return { id, name, description, invite_code, creator_user_id: userId, created_at };
}

export function joinCircle(db: Db, userId: string, inviteCode: string): CircleRow {
  const circle = db.prepare('SELECT * FROM circles WHERE invite_code = ?').get(inviteCode) as CircleRow | undefined;
  if (!circle) throw new Error('INVITE_NOT_FOUND');

  const alreadyMember = db.prepare(
    'SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?'
  ).get(circle.id, userId);
  if (alreadyMember) return circle; // idempotent — already joined, no-op success

  const userCircleCount = (
    db.prepare('SELECT COUNT(*) as n FROM circle_members WHERE user_id = ?').get(userId) as { n: number }
  ).n;
  if (userCircleCount >= MAX_CIRCLES_PER_USER) throw new Error('CIRCLE_CAP_REACHED');

  const memberCount = (
    db.prepare('SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ?').get(circle.id) as { n: number }
  ).n;
  if (memberCount >= MAX_MEMBERS_PER_CIRCLE) throw new Error('CIRCLE_FULL');

  db.prepare('INSERT INTO circle_members (circle_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(circle.id, userId, Date.now());

  return circle;
}

export function leaveCircle(db: Db, userId: string, circleId: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?').run(circleId, userId);
    const remaining = (
      db.prepare('SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ?').get(circleId) as { n: number }
    ).n;
    if (remaining === 0) {
      db.prepare('DELETE FROM circle_cheers WHERE circle_id = ?').run(circleId);
      db.prepare('DELETE FROM circles WHERE id = ?').run(circleId);
    }
  })();
}

export function getUserCircles(db: Db, userId: string): (CircleRow & { member_count: number })[] {
  return db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM circle_members cm2 WHERE cm2.circle_id = c.id) as member_count
     FROM circles c
     JOIN circle_members cm ON cm.circle_id = c.id
     WHERE cm.user_id = ?
     ORDER BY c.created_at DESC`
  ).all(userId) as (CircleRow & { member_count: number })[];
}

/** Streak = consecutive days with at least 1 review, counting back from today (UTC calendar days). */
function calcStreakFromTimestamps(timestamps: number[]): number {
  const dayStrings = new Set(timestamps.map(t => new Date(t).toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  for (;;) {
    const dayStr = cursor.toISOString().slice(0, 10);
    if (dayStrings.has(dayStr)) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export function getCircleDetail(db: Db, circleId: string): CircleDetail | null {
  const circle = db.prepare('SELECT * FROM circles WHERE id = ?').get(circleId) as CircleRow | undefined;
  if (!circle) return null;

  const memberIds = (
    db.prepare('SELECT user_id FROM circle_members WHERE circle_id = ?').all(circleId) as { user_id: string }[]
  ).map(r => r.user_id);

  const members: CircleMemberDetail[] = memberIds.map(userId => {
    const user = db.prepare('SELECT display_name FROM users WHERE user_id = ?').get(userId) as { display_name: string | null } | undefined;
    const reviewTimestamps = (
      db.prepare('SELECT reviewed_at FROM review_log WHERE user_id = ?').all(userId) as { reviewed_at: number }[]
    ).map(r => r.reviewed_at);
    const lastReview = (
      db.prepare('SELECT item_id, reviewed_at FROM review_log WHERE user_id = ? ORDER BY reviewed_at DESC LIMIT 1').get(userId)
      as { item_id: string; reviewed_at: number } | undefined
    );
    const cheerCount = (
      db.prepare('SELECT COUNT(*) as n FROM circle_cheers WHERE circle_id = ? AND to_user_id = ?').get(circleId, userId) as { n: number }
    ).n;

    return {
      user_id: userId,
      display_name: user?.display_name ?? 'Anonymous',
      streak: calcStreakFromTimestamps(reviewTimestamps),
      last_reviewed_item_id: lastReview?.item_id ?? null,
      last_reviewed_at: lastReview?.reviewed_at ?? null,
      cheer_count: cheerCount,
    };
  });

  return { ...circle, members };
}

export function addCheer(db: Db, circleId: string, fromUserId: string, toUserId: string): void {
  db.prepare('INSERT INTO circle_cheers (circle_id, from_user_id, to_user_id, created_at) VALUES (?, ?, ?, ?)')
    .run(circleId, fromUserId, toUserId, Date.now());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node_modules/.bin/vitest run tests/database.test.ts` from `C:\Users\Amir_\Retainflow\backend`
Expected: PASS (all tests in the file, including Task 1's).

- [ ] **Step 5: Commit**

```bash
cd C:\Users\Amir_\Retainflow
git add backend/src/database.ts backend/tests/database.test.ts
git commit -m "Add circle database helper functions"
```

---

## Task 3: HTTP endpoints

**Files:**
- Modify: `backend/src/server.ts`
- Test: `backend/tests/server.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/server.test.ts` (append at the end, following the existing `describe`/`app.inject()` pattern already used throughout the file):

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node_modules/.bin/vitest run tests/server.test.ts` from `C:\Users\Amir_\Retainflow\backend`
Expected: FAIL — none of the new routes exist yet (404s where 200/201/403 are expected).

- [ ] **Step 3: Update the import line**

In `backend/src/server.ts`, update the import from `./database.js` (line 9) to add the new functions:

```typescript
import { initDb, createUser, addItem, getDueItems, getAllItems, getItem, updateItem, deleteItem, renameItem, searchAyahs, getAyahRange, logReview, getReviewLog, getStats, updateNotes, snoozeItem, rescheduleItem, undoReview, setDisplayName, createCircle, joinCircle, leaveCircle, getUserCircles, getCircleDetail, addCheer } from './database.js';
```

- [ ] **Step 4: Add the 7 new routes**

In `backend/src/server.ts`, add these routes after the `GET /api/quran/:surah/:from/:to` route (after line 345, before the "Full data export" section):

```typescript
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
        return reply.status(403).send({ error: 'CIRCLE_CAP_REACHED', message: 'You can only join or create up to 5 circles.' });
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
        return reply.status(403).send({ error: 'CIRCLE_CAP_REACHED', message: 'You can only join or create up to 5 circles.' });
      if (err.message === 'CIRCLE_FULL')
        return reply.status(403).send({ error: 'CIRCLE_FULL', message: 'This circle is full (20 members max).' });
      throw err;
    }
  });

  // POST /api/circles/:id/leave
  app.post('/api/circles/:id/leave', async (req, reply) => {
    const { id } = req.params as { id: string };
    const user_id = userIdFrom(req);
    if (!requireUserId(user_id, reply)) return;
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
  app.post('/api/circles/:id/cheer/:userId', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { id, userId: targetUserId } = req.params as { id: string; userId: string };
    const user_id = userIdFrom(req);
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
```

Note: `userIdFrom`'s existing fallback to `req.params.userId` (line 44 of the existing file) would clash with the new `:userId` route param on the cheer endpoint (it's the *target*'s id, not the caller's) — read `userIdFrom`'s implementation again before wiring this up. Since the cheer route always sends the caller's id via the `Authorization` header (as the tests above do), and `userIdFrom` checks the header FIRST and returns immediately if found, this is safe in practice — but confirm this reasoning holds by re-reading `userIdFrom` yourself, and if you find a real ambiguity, resolve it by relying only on the header for this specific route rather than the shared helper, and explain your reasoning in your report.

- [ ] **Step 5: Run test to verify it passes**

Run: `node_modules/.bin/vitest run tests/server.test.ts` from `C:\Users\Amir_\Retainflow\backend`
Expected: PASS (all tests in the file, including all pre-existing ones — confirm nothing regressed).

- [ ] **Step 6: Commit**

```bash
cd C:\Users\Amir_\Retainflow
git add backend/src/server.ts backend/tests/server.test.ts
git commit -m "Add Circles HTTP endpoints"
```

---

## Task 4: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `node_modules/.bin/vitest run` from `C:\Users\Amir_\Retainflow\backend`
Expected: all tests pass, including every pre-existing test file (not just the new ones) — this confirms no regression to the existing `/api/items`, `/api/quran`, etc. endpoints.

- [ ] **Step 2: Manual smoke test against a running dev server**

Start the server: `node_modules/.bin/tsx src/server.ts` from `C:\Users\Amir_\Retainflow\backend` (matching the documented workaround for the `package.json` mismatch — use `tsx` directly, not `npm run dev`), with `DB_PATH=/tmp/circles-smoke-test.db PORT=3999` env vars set so it doesn't collide with any other running instance or the real production DB.

Then, from a separate terminal, exercise the full flow with curl:
```bash
curl -s -X POST http://127.0.0.1:3999/api/users -H "Content-Type: application/json" -d '{"user_id":"smoke-test-1"}'
curl -s -X PUT http://127.0.0.1:3999/api/me/display_name -H "Authorization: Bearer smoke-test-1" -H "Content-Type: application/json" -d '{"display_name":"Smoke Tester"}'
curl -s -X POST http://127.0.0.1:3999/api/circles -H "Authorization: Bearer smoke-test-1" -H "Content-Type: application/json" -d '{"name":"Smoke Circle","description":"testing"}'
# copy the returned invite_code and id, then:
curl -s -X POST http://127.0.0.1:3999/api/circles/join -H "Authorization: Bearer smoke-test-2" -H "Content-Type: application/json" -d '{"invite_code":"<CODE>"}'
curl -s http://127.0.0.1:3999/api/circles/<ID> -H "Authorization: Bearer smoke-test-1"
curl -s -X POST http://127.0.0.1:3999/api/circles/<ID>/cheer/smoke-test-2 -H "Authorization: Bearer smoke-test-1"
curl -s http://127.0.0.1:3999/api/circles/<ID> -H "Authorization: Bearer smoke-test-1"  # confirm cheer_count is now 1
```
Confirm each response matches expectations (200/201 status, correct JSON shapes, cheer count incremented). Stop the server afterward and delete the temp DB file (`/tmp/circles-smoke-test.db*`).

- [ ] **Step 3: Confirm CORS/rate-limit config didn't need changes**

Re-read `backend/src/server.ts`'s CORS registration (around line 86-98) — confirm all 7 new routes use only `GET`/`POST`/`PUT` (they do, per the plan above), so the existing `methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE']` list already covers them with no change needed.

- [ ] **Step 4: Report status**

```bash
cd C:\Users\Amir_\Retainflow
git status --short
git log --oneline -5
```

Report the final commit list and confirm the working tree is clean. Do not push without explicit user confirmation, per this project's established workflow.

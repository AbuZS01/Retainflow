import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initDb,
  createUser,
  getUser,
  getItem,
  addItem,
  getDueItems,
  updateItem,
  deleteItem,
  renameItem,
  undoReview,
  snoozeItem,
  logReview,
  getReviewLog,
  setDisplayName,
  createCircle,
  joinCircle,
  leaveCircle,
  getUserCircles,
  getCircleDetail,
  addCheer,
  type Db,
} from '../src/database.js';

let db: Db;

beforeEach(() => {
  db = initDb(':memory:');
});

afterEach(() => {
  db.close();
});

describe('createUser / getUser', () => {
  it('creates a free-tier user', () => {
    createUser(db, 'user-1');
    const user = getUser(db, 'user-1');
    expect(user).not.toBeNull();
    expect(user!.user_id).toBe('user-1');
    expect(user!.is_premium).toBe(0);
  });

  it('returns null for unknown user', () => {
    expect(getUser(db, 'nobody')).toBeNull();
  });
});

describe('addItem — freemium tier limit', () => {
  it('allows adding the 50th item for a free user', () => {
    createUser(db, 'user-free');
    // Insert 49 items directly to keep the test fast
    for (let i = 1; i <= 49; i++) {
      db.prepare(
        `INSERT INTO items (user_id, item_id, content, interval, ease_factor, repetitions, next_due_date)
         VALUES (?, ?, '', 1, 2.5, 0, 0)`
      ).run('user-free', `item-${i}`);
    }
    expect(() => addItem(db, 'user-free', 'item-50')).not.toThrow();
  });

  it('blocks the 51st item for a free user with LIMIT_REACHED', () => {
    createUser(db, 'user-free2');
    for (let i = 1; i <= 50; i++) {
      db.prepare(
        `INSERT INTO items (user_id, item_id, content, interval, ease_factor, repetitions, next_due_date)
         VALUES (?, ?, '', 1, 2.5, 0, 0)`
      ).run('user-free2', `item-${i}`);
    }
    expect(() => addItem(db, 'user-free2', 'item-51')).toThrow('LIMIT_REACHED');
  });

  it('allows more than 50 items for a premium user', () => {
    createUser(db, 'user-prem');
    db.prepare(`UPDATE users SET is_premium = 1 WHERE user_id = ?`).run('user-prem');
    for (let i = 1; i <= 51; i++) {
      expect(() => addItem(db, 'user-prem', `item-${i}`)).not.toThrow();
    }
  });
});

describe('getDueItems', () => {
  it('only returns items with next_due_date <= now', () => {
    createUser(db, 'user-due');
    addItem(db, 'user-due', 'past-due');
    // Manually set a far-future due date on a second item
    addItem(db, 'user-due', 'future-item');
    db.prepare(
      "UPDATE items SET next_due_date = ? WHERE item_id = 'future-item'"
    ).run(Date.now() + 10 * 86_400_000);

    const due = getDueItems(db, 'user-due');
    const ids = due.map((i) => i.item_id);
    expect(ids).toContain('past-due');
    expect(ids).not.toContain('future-item');
  });
});

describe('updateItem', () => {
  it('persists new SM-2 values', () => {
    createUser(db, 'user-upd');
    addItem(db, 'user-upd', 'card-1');
    const futureDate = Date.now() + 15 * 86_400_000;
    updateItem(db, 'user-upd', 'card-1', {
      interval: 15,
      ease_factor: 2.6,
      repetitions: 3,
      next_due_date: futureDate,
    });
    const row = db.prepare("SELECT * FROM items WHERE user_id = 'user-upd' AND item_id = 'card-1'").get() as any;
    expect(row.interval).toBe(15);
    expect(row.ease_factor).toBeCloseTo(2.6, 4);
    expect(row.repetitions).toBe(3);
    expect(row.next_due_date).toBe(futureDate);
  });

  it('throws ITEM_NOT_FOUND when item does not exist', () => {
    expect(() =>
      updateItem(db, 'no-user', 'nonexistent', { interval: 1, ease_factor: 2.5, repetitions: 0, next_due_date: 0 })
    ).toThrow('ITEM_NOT_FOUND');
  });
});

describe('deleteItem', () => {
  it('removes the item row', () => {
    createUser(db, 'user-del');
    addItem(db, 'user-del', 'to-delete');
    deleteItem(db, 'user-del', 'to-delete');
    const row = db.prepare("SELECT * FROM items WHERE user_id = 'user-del' AND item_id = 'to-delete'").get();
    expect(row).toBeUndefined();
  });

  it('throws ITEM_NOT_FOUND when item does not exist', () => {
    expect(() => deleteItem(db, 'user-del', 'ghost-item')).toThrow('ITEM_NOT_FOUND');
  });
});

describe('addItem — error cases', () => {
  it('throws USER_NOT_FOUND when user does not exist', () => {
    expect(() => addItem(db, 'nobody', 'item-x')).toThrow('USER_NOT_FOUND');
  });
});

describe('addItem — content', () => {
  it('stores and retrieves content', () => {
    createUser(db, 'user-content');
    addItem(db, 'user-content', 'verse-1', 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ');
    const item = getItem(db, 'user-content', 'verse-1');
    expect(item).not.toBeNull();
    expect(item!.content).toBe('بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ');
  });

  it('defaults to empty string when content not provided', () => {
    createUser(db, 'user-nocontent');
    addItem(db, 'user-nocontent', 'item-no-content');
    const item = getItem(db, 'user-nocontent', 'item-no-content');
    expect(item!.content).toBe('');
  });
});

describe('getItem', () => {
  it('returns item by id', () => {
    createUser(db, 'user-getitem');
    addItem(db, 'user-getitem', 'my-item');
    const item = getItem(db, 'user-getitem', 'my-item');
    expect(item).not.toBeNull();
    expect(item!.item_id).toBe('my-item');
    expect(item!.user_id).toBe('user-getitem');
  });

  it('returns null for unknown item', () => {
    expect(getItem(db, 'user-getitem', 'ghost')).toBeNull();
  });
});

describe('renameItem', () => {
  it('preserves SM-2 state while changing item_id and content', () => {
    const db = initDb(':memory:');
    createUser(db, 'u-rename');
    addItem(db, 'u-rename', 'surah-1-ayat-1-7', 'old content', { interval: 5, ease_factor: 2.1, repetitions: 3 });
    renameItem(db, 'u-rename', 'surah-1-ayat-1-7', 'surah-1-ayat-1-10', 'new content');
    const old = getItem(db, 'u-rename', 'surah-1-ayat-1-7');
    const updated = getItem(db, 'u-rename', 'surah-1-ayat-1-10');
    expect(old).toBeNull();
    expect(updated?.interval).toBe(5);
    expect(updated?.ease_factor).toBeCloseTo(2.1);
    expect(updated?.repetitions).toBe(3);
    expect(updated?.content).toBe('new content');
  });

  it('throws ITEM_NOT_FOUND for unknown item', () => {
    const db = initDb(':memory:');
    createUser(db, 'u-rename2');
    expect(() => renameItem(db, 'u-rename2', 'nope', 'new', '')).toThrow('ITEM_NOT_FOUND');
  });

  it('throws DUPLICATE_ITEM if new id already exists', () => {
    const db = initDb(':memory:');
    createUser(db, 'u-rename3');
    addItem(db, 'u-rename3', 'item-a', '');
    addItem(db, 'u-rename3', 'item-b', '');
    expect(() => renameItem(db, 'u-rename3', 'item-a', 'item-b', '')).toThrow('DUPLICATE_ITEM');
  });
});

describe('undoReview', () => {
  it('restores SM-2 state and removes last log entry', () => {
    const db = initDb(':memory:');
    createUser(db, 'u-undo');
    addItem(db, 'u-undo', 'item-1', '', { interval: 1, ease_factor: 2.5, repetitions: 0 });
    const prev = { interval: 1, ease_factor: 2.5, repetitions: 0, next_due_date: Date.now() };
    logReview(db, 'item-1', 'u-undo', 'good');
    updateItem(db, 'u-undo', 'item-1', { interval: 6, ease_factor: 2.5, repetitions: 1, next_due_date: Date.now() + 6 * 86_400_000 });
    undoReview(db, 'u-undo', 'item-1', prev);
    const restored = getItem(db, 'u-undo', 'item-1');
    expect(restored?.interval).toBe(1);
    expect(restored?.repetitions).toBe(0);
    const log = getReviewLog(db, 'u-undo', 10);
    expect(log.length).toBe(0);
  });
});

describe('snoozeItem with days', () => {
  it('snoozes by the given number of days', () => {
    const db = initDb(':memory:');
    createUser(db, 'u-snooze2');
    addItem(db, 'u-snooze2', 'item-snz', '');
    const before = Date.now();
    snoozeItem(db, 'u-snooze2', 'item-snz', 7);
    const item = getItem(db, 'u-snooze2', 'item-snz');
    expect(item!.next_due_date).toBeGreaterThanOrEqual(before + 7 * 86_400_000 - 100);
  });
});

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
    db.exec(`INSERT INTO users (user_id) VALUES ('u1'), ('u2')`);
    db.exec(`INSERT INTO circles (id, name, invite_code, creator_user_id, created_at) VALUES ('c1', 'Test', 'CODE1234', 'u1', ${Date.now()})`);
    expect(() => {
      db.exec(`INSERT INTO circles (id, name, invite_code, creator_user_id, created_at) VALUES ('c2', 'Test2', 'CODE1234', 'u2', ${Date.now()})`);
    }).toThrow();
  });
});

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

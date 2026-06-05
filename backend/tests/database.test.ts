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

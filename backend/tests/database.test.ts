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
  it('allows adding up to 3 items for free user', () => {
    createUser(db, 'user-free');
    addItem(db, 'user-free', 'item-1');
    addItem(db, 'user-free', 'item-2');
    addItem(db, 'user-free', 'item-3');
    addItem(db, 'user-free', 'item-4');
    addItem(db, 'user-free', 'item-5');
    const items = getDueItems(db, 'user-free');
    expect(items.length).toBe(5);
  });

  it('blocks 6th item for free user with LIMIT_REACHED error', () => {
    createUser(db, 'user-free2');
    addItem(db, 'user-free2', 'item-a');
    addItem(db, 'user-free2', 'item-b');
    addItem(db, 'user-free2', 'item-c');
    addItem(db, 'user-free2', 'item-d');
    addItem(db, 'user-free2', 'item-e');
    expect(() => addItem(db, 'user-free2', 'item-f')).toThrow('LIMIT_REACHED');
  });

  it('allows more than 3 items for premium user', () => {
    createUser(db, 'user-premium');
    db.prepare("UPDATE users SET is_premium = 1 WHERE user_id = 'user-premium'").run();
    addItem(db, 'user-premium', 'item-1');
    addItem(db, 'user-premium', 'item-2');
    addItem(db, 'user-premium', 'item-3');
    addItem(db, 'user-premium', 'item-4');
    const items = getDueItems(db, 'user-premium');
    expect(items.length).toBe(4);
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
    updateItem(db, 'card-1', {
      interval: 15,
      ease_factor: 2.6,
      repetitions: 3,
      next_due_date: futureDate,
    });
    const row = db.prepare("SELECT * FROM items WHERE item_id = 'card-1'").get() as any;
    expect(row.interval).toBe(15);
    expect(row.ease_factor).toBeCloseTo(2.6, 4);
    expect(row.repetitions).toBe(3);
    expect(row.next_due_date).toBe(futureDate);
  });

  it('throws ITEM_NOT_FOUND when item does not exist', () => {
    expect(() =>
      updateItem(db, 'nonexistent', { interval: 1, ease_factor: 2.5, repetitions: 0, next_due_date: 0 })
    ).toThrow('ITEM_NOT_FOUND');
  });
});

describe('deleteItem', () => {
  it('removes the item row', () => {
    createUser(db, 'user-del');
    addItem(db, 'user-del', 'to-delete');
    deleteItem(db, 'to-delete');
    const row = db.prepare("SELECT * FROM items WHERE item_id = 'to-delete'").get();
    expect(row).toBeUndefined();
  });

  it('throws ITEM_NOT_FOUND when item does not exist', () => {
    expect(() => deleteItem(db, 'ghost-item')).toThrow('ITEM_NOT_FOUND');
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
    const item = getItem(db, 'verse-1');
    expect(item).not.toBeNull();
    expect(item!.content).toBe('بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ');
  });

  it('defaults to empty string when content not provided', () => {
    createUser(db, 'user-nocontent');
    addItem(db, 'user-nocontent', 'item-no-content');
    const item = getItem(db, 'item-no-content');
    expect(item!.content).toBe('');
  });
});

describe('getItem', () => {
  it('returns item by id', () => {
    createUser(db, 'user-getitem');
    addItem(db, 'user-getitem', 'my-item');
    const item = getItem(db, 'my-item');
    expect(item).not.toBeNull();
    expect(item!.item_id).toBe('my-item');
    expect(item!.user_id).toBe('user-getitem');
  });

  it('returns null for unknown item', () => {
    expect(getItem(db, 'ghost')).toBeNull();
  });
});

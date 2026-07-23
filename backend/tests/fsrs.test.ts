import { describe, it, expect } from 'vitest';
import { applyReview, ItemState, ReviewQuality } from '../src/fsrs.js';

// fsrs.ts had no isolated unit coverage before this — only indirect coverage
// via server.test.ts's PUT /review case. These fixtures pin down concrete
// (state, quality, now) -> expected ReviewResult values so the client-side
// port (src/lib/fsrs.ts in muraja-native) has a fixed oracle to check
// against, since that repo has no test runner to assert equality
// automatically.
const NOW = 1700000000000;

function review(state: ItemState, quality: ReviewQuality) {
  return applyReview(state, quality, NOW);
}

describe('applyReview — first review (repetitions === 0)', () => {
  it('"good" seeds stability/difficulty from W and starts repetitions at 1', () => {
    const r = review({ interval: 1, ease_factor: 2.5, repetitions: 0 }, 'good');
    expect(r).toEqual({ interval: 4, ease_factor: 1, repetitions: 1, next_due_date: NOW + 4 * 86_400_000 });
  });

  it('"easy" produces a longer first interval than "good"', () => {
    const r = review({ interval: 1, ease_factor: 2.5, repetitions: 0 }, 'easy');
    expect(r).toEqual({ interval: 14, ease_factor: 1, repetitions: 1, next_due_date: NOW + 14 * 86_400_000 });
  });
});

describe('applyReview — subsequent reviews', () => {
  it('"good" on an established FSRS item grows the interval and bumps repetitions', () => {
    const r = review({ interval: 6, ease_factor: 5.2, repetitions: 2 }, 'good');
    expect(r).toEqual({ interval: 22, ease_factor: 5.0698, repetitions: 3, next_due_date: NOW + 22 * 86_400_000 });
  });

  it('"forgot" resets interval to 1 and repetitions to 0', () => {
    const r = review({ interval: 20, ease_factor: 4.8, repetitions: 4 }, 'forgot');
    expect(r).toEqual({ interval: 1, ease_factor: 3.7944, repetitions: 0, next_due_date: NOW + 1 * 86_400_000 });
  });

  it('migrates a legacy SM-2 state (ease_factor in the 1.3-5.0 range) before scheduling', () => {
    const r = review({ interval: 10, ease_factor: 2.3, repetitions: 3 }, 'good');
    expect(r).toEqual({ interval: 27, ease_factor: 6.6783, repetitions: 4, next_due_date: NOW + 27 * 86_400_000 });
  });
});

describe('applyReview — invariants', () => {
  it('ease_factor (difficulty) always stays within [1, 10]', () => {
    for (const quality of ['forgot', 'hard', 'good', 'easy'] as ReviewQuality[]) {
      const r = review({ interval: 1, ease_factor: 2.5, repetitions: 0 }, quality);
      expect(r.ease_factor).toBeGreaterThanOrEqual(1);
      expect(r.ease_factor).toBeLessThanOrEqual(10);
    }
  });

  it('interval is always a positive integer, capped at 3650 days', () => {
    const r = review({ interval: 3000, ease_factor: 9, repetitions: 20 }, 'easy');
    expect(Number.isInteger(r.interval)).toBe(true);
    expect(r.interval).toBeGreaterThan(0);
    expect(r.interval).toBeLessThanOrEqual(3650);
  });
});

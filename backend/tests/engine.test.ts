import { describe, it, expect } from 'vitest';
import { mapQuality, applyReview, ReviewQuality } from '../src/engine.js';

describe('mapQuality', () => {
  it('maps "forgot" to 0', () => expect(mapQuality('forgot')).toBe(0));
  it('maps "hard" to 2', () => expect(mapQuality('hard')).toBe(2));
  it('maps "good" to 4', () => expect(mapQuality('good')).toBe(4));
  it('maps "easy" to 5', () => expect(mapQuality('easy')).toBe(5));
});

describe('applyReview — fail case (quality < 3)', () => {
  it('resets repetitions and interval to 1 on "forgot"', () => {
    const result = applyReview(
      { interval: 10, ease_factor: 2.5, repetitions: 3 },
      'forgot'
    );
    expect(result.repetitions).toBe(0);
    expect(result.interval).toBe(1);
    expect(result.ease_factor).toBeCloseTo(2.5, 5);
  });

  it('resets on "hard" (quality 2)', () => {
    const result = applyReview(
      { interval: 6, ease_factor: 2.0, repetitions: 2 },
      'hard'
    );
    expect(result.repetitions).toBe(0);
    expect(result.interval).toBe(1);
  });
});

describe('applyReview — pass cases (quality >= 3)', () => {
  it('first repetition (rep=0) sets interval to 1', () => {
    const result = applyReview(
      { interval: 1, ease_factor: 2.5, repetitions: 0 },
      'good'
    );
    expect(result.repetitions).toBe(1);
    expect(result.interval).toBe(1);
  });

  it('second repetition (rep=1) sets interval to 6', () => {
    const result = applyReview(
      { interval: 1, ease_factor: 2.5, repetitions: 1 },
      'good'
    );
    expect(result.repetitions).toBe(2);
    expect(result.interval).toBe(6);
  });

  it('third repetition uses interval * ease_factor', () => {
    const result = applyReview(
      { interval: 6, ease_factor: 2.5, repetitions: 2 },
      'good'
    );
    // interval = round(6 * 2.5) = 15
    expect(result.interval).toBe(15);
    expect(result.repetitions).toBe(3);
  });

  it('"easy" increases ease_factor', () => {
    const before = 2.5;
    const result = applyReview(
      { interval: 6, ease_factor: before, repetitions: 2 },
      'easy'
    );
    // ef += 0.1 - (5-5)*(0.08+(5-5)*0.02) = 0.1
    expect(result.ease_factor).toBeCloseTo(2.6, 5);
  });

  it('"good" keeps ease_factor roughly the same', () => {
    const before = 2.5;
    const result = applyReview(
      { interval: 6, ease_factor: before, repetitions: 2 },
      'good'
    );
    // ef += 0.1 - (5-4)*(0.08+(5-4)*0.02) = 0.1 - 0.1 = 0
    expect(result.ease_factor).toBeCloseTo(2.5, 5);
  });

  it('ease_factor never drops below 1.3', () => {
    const result = applyReview(
      { interval: 1, ease_factor: 1.3, repetitions: 0 },
      'good'
    );
    expect(result.ease_factor).toBeGreaterThanOrEqual(1.3);
  });

  it('next_due_date is interval days from now', () => {
    const fixedNow = 1_700_000_000_000; // fixed timestamp
    const result = applyReview(
      { interval: 1, ease_factor: 2.5, repetitions: 1 },
      'easy',
      fixedNow
    );
    // rep=1 → interval=6
    expect(result.next_due_date).toBe(fixedNow + 6 * 86_400_000);
  });
});

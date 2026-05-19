export type ReviewQuality = 'forgot' | 'hard' | 'good' | 'easy';

export interface CardState {
  interval: number;
  ease_factor: number;
  repetitions: number;
}

export interface ReviewResult extends CardState {
  next_due_date: number;
}

export function mapQuality(quality: ReviewQuality): number {
  const map: Record<ReviewQuality, number> = {
    forgot: 0,
    hard: 2,
    good: 4,
    easy: 5,
  };
  return map[quality];
}

export function applyReview(card: CardState, quality: ReviewQuality): ReviewResult {
  const q = mapQuality(quality);

  let { interval, ease_factor, repetitions } = card;

  if (q < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * ease_factor);
    }
    ease_factor = ease_factor + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
    ease_factor = Math.max(1.3, parseFloat(ease_factor.toFixed(4)));
    repetitions += 1;
  }

  const next_due_date = Date.now() + interval * 86_400_000;

  return { interval, ease_factor, repetitions, next_due_date };
}

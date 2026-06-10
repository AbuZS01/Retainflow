/**
 * FSRS-4.5 scheduler — drop-in replacement for the SM-2 engine.
 *
 * Maps onto the existing item columns with no DB migration:
 *   interval     → memory stability S (days; at the default 0.9 retention
 *                  target, next interval ≈ stability, so storing the rounded
 *                  interval here is faithful)
 *   ease_factor  → difficulty D (1–10)
 *   repetitions  → review count
 *
 * Legacy SM-2 items (ease_factor in 1.3–5.0 with repetitions > 0) are
 * converted on their first FSRS review — users keep their schedule.
 */

export type ReviewQuality = 'forgot' | 'hard' | 'good' | 'easy';

export interface ItemState {
  interval: number;     // stability (days)
  ease_factor: number;  // difficulty (1–10) — legacy SM-2 EF auto-converted
  repetitions: number;
}

export interface ReviewResult extends ItemState {
  next_due_date: number; // epoch ms
}

// FSRS-4.5 default weights (trained on ~700M reviews)
const W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031,
  1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];

const DECAY = -0.5;
const FACTOR = 19 / 81; // chosen so R(S, S) = 0.9
const REQUEST_RETENTION = Number(process.env.FSRS_RETENTION ?? 0.9);
const MAX_INTERVAL = 3650;
const DAY_MS = 86_400_000;

const GRADE: Record<ReviewQuality, 1 | 2 | 3 | 4> = {
  forgot: 1, hard: 2, good: 3, easy: 4,
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Retrievability after t days given stability S. */
function retrievability(t: number, S: number): number {
  return Math.pow(1 + FACTOR * (t / Math.max(S, 0.01)), DECAY);
}

/** Interval (days) at which retrievability decays to the retention target. */
function nextIntervalDays(S: number): number {
  const ivl = (S / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(ivl), 1, MAX_INTERVAL);
}

function initStability(g: number): number {
  return Math.max(W[g - 1], 0.1);
}

function initDifficulty(g: number): number {
  return clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);
}

function nextDifficulty(D: number, g: number): number {
  const delta = -W[6] * (g - 3);
  const damped = D + delta * ((10 - D) / 9);
  // Mean reversion toward D0(easy)
  return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * damped, 1, 10);
}

function stabilityAfterSuccess(D: number, S: number, R: number, g: number): number {
  const hardPenalty = g === 2 ? W[15] : 1;
  const easyBonus = g === 4 ? W[16] : 1;
  const grow =
    Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9]) *
    (Math.exp(W[10] * (1 - R)) - 1) * hardPenalty * easyBonus;
  return S * (1 + grow);
}

function stabilityAfterFailure(D: number, S: number, R: number): number {
  const sf =
    W[11] * Math.pow(D, -W[12]) *
    (Math.pow(S + 1, W[13]) - 1) * Math.exp(W[14] * (1 - R));
  return Math.min(sf, S); // forgetting never increases stability
}

/** Detect items last scheduled by SM-2 and convert their state once. */
function migrateLegacy(state: ItemState): ItemState {
  const legacy =
    state.repetitions > 0 &&
    state.ease_factor >= 1.29 && state.ease_factor <= 5.01;
  if (!legacy) return state;
  return {
    interval: Math.max(state.interval, 1),                  // interval ≈ stability
    ease_factor: clamp(11 - 1.8 * state.ease_factor, 1, 10), // EF→difficulty
    repetitions: state.repetitions,
  };
}

/**
 * Drop-in replacement for the SM-2 applyReview.
 * `now` is injectable for tests.
 */
export function applyReview(
  state: ItemState,
  quality: ReviewQuality,
  now: number = Date.now(),
): ReviewResult {
  const g = GRADE[quality];
  let S: number, D: number;

  if (state.repetitions === 0) {
    S = initStability(g);
    D = initDifficulty(g);
  } else {
    const { interval, ease_factor } = migrateLegacy(state);
    // Elapsed days since last review ≈ interval (items surface when due).
    const elapsed = Math.max(interval, 0.1);
    const R = retrievability(elapsed, interval);
    D = nextDifficulty(ease_factor, g);
    S = g === 1
      ? stabilityAfterFailure(ease_factor, interval, R)
      : stabilityAfterSuccess(ease_factor, interval, R, g);
  }

  const interval = g === 1 ? 1 : nextIntervalDays(S);
  return {
    interval,
    ease_factor: Number(D.toFixed(4)),
    repetitions: g === 1 ? 0 : state.repetitions + 1,
    next_due_date: now + interval * DAY_MS,
  };
}

/** Quality → numeric grade, kept for API parity with the SM-2 engine. */
export function mapQuality(q: ReviewQuality): number {
  return GRADE[q];
}

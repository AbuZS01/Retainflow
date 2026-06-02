# Review Key — Design Spec
_2026-06-02_

## Summary

Add a ⓘ (info) button to the review screen's bottom dock. Tapping it opens a popover showing the exact next-review interval (in days) each of the four rating buttons would produce for the current card. Values are computed client-side from the card's SM-2 state and update with every card transition.

---

## Why

Users don't know what "Forgot / Hard / Good / Easy" actually schedule. Showing real days — not vague descriptions — gives them enough information to rate honestly without needing to understand SM-2 internals.

---

## UI

### ⓘ Button

- 24px ghost circle, top-right corner of `.review-bottom-dock`
- Sits on the same row as the "How did it go?" label (or floated right within the dock header)
- Subdued style matching the snooze button: low-contrast border, no fill, small font
- Accessible: `aria-label="Rating key"`, `aria-expanded` toggled on open/close

### Popover

- Anchored above the ⓘ button, opens upward
- Closes on: second ⓘ tap, tap anywhere outside the popover
- Four rows, one per button, colour dot matches button background:

```
● Forgot   → N day(s)
● Hard     → N day(s)
● Good     → N day(s)
● Easy     → N day(s)
```

- "day" / "days" pluralised correctly
- Pure HTML + CSS (`.rating-key-popover` div toggled with `.open` class) — no JS library

---

## Data Flow

1. A card loads in `app.js` — the card object already carries `interval`, `ease_factor`, `repetitions`
2. `previewIntervals(card)` runs immediately, returning `{ forgot, hard, good, easy }` day counts
3. Values are stored on the popover DOM element (e.g. `dataset`) or set as text content directly
4. ⓘ tapped → popover shown with current values
5. User taps a rating button → card advances → step 1 repeats for next card

---

## `previewIntervals(card)` Logic

Mirrors `engine.ts` `applyReview()` client-side. No API call.

```js
function previewIntervals(card) {
  // quality map: forgot=0, hard=2, good=4, easy=5
  return Object.fromEntries(
    ['forgot','hard','good','easy'].map(q => [q, computeInterval(card, q)])
  );
}

function computeInterval(card, quality) {
  const qMap = { forgot: 0, hard: 2, good: 4, easy: 5 };
  const q = qMap[quality];
  let { interval, ease_factor, repetitions } = card;
  if (q < 3) return 1;
  if (repetitions === 0) return 1;
  if (repetitions === 1) return 6;
  return Math.round(interval * ease_factor);
}
```

---

## Edge Cases

| Situation | Behaviour |
|-----------|-----------|
| First review (rep=0) | Good and Easy both show 1 day — correct per SM-2 |
| Second review (rep=1) | Good and Easy both show 6 days — correct |
| Forgot and Hard always | Always return 1 day regardless of card state |
| Plural | "1 day" / "2 days" |

---

## Styling

- Popover: `position: absolute; bottom: calc(100% + .5rem); right: 0` relative to a `position: relative` wrapper on `.review-bottom-dock`
- Background: `var(--surface)` or `var(--bg)` with a subtle border and shadow
- Z-index: above dock (z-index: 101) but below profile overlay (110)
- Colour dots: `display: inline-block; width: 10px; height: 10px; border-radius: 50%` with hardcoded colours matching `.q-forgot/.q-hard/.q-good/.q-easy`

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/index.html` | Add ⓘ button and `.rating-key-popover` div inside `.review-bottom-dock` |
| `frontend/style.css` | Style `.rating-key-btn`, `.rating-key-popover`, `.rating-key-popover.open` |
| `frontend/app.js` | Add `previewIntervals()`, `computeInterval()`, call on card load, wire ⓘ toggle |

No backend changes required.

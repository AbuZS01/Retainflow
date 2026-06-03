# Mobile Layout — Bottom Nav + Full-screen Review

**Date:** 2026-05-31  
**Status:** Approved  
**Scope:** `frontend/index.html`, `frontend/style.css`, `frontend/app.js`

---

## Goal

Give RetainFlow a native-app feel on mobile by solving two concrete UX problems:

1. **Crowded topbar** — five icon buttons crammed into a single row, hard to tap, awkward on small screens.
2. **Scroll-to-reach review buttons** — on longer ayah ranges, users must scroll past the Arabic text to reach the Forgot / Hard / Good / Easy buttons.

---

## Part 1 — Bottom Navigation Bar

### Structure

A persistent `<nav id="bottom-nav">` element fixed to the bottom of the viewport, containing five tabs:

| Tab | Icon | Label | Activates |
|-----|------|-------|-----------|
| Home | 🏠 | Home | `view-dashboard` |
| Queue | ☰ | Queue | `view-queue` |
| Add *(centre)* | ＋ | *(no label)* | `view-add` |
| Stats | 📊 | Stats | `view-stats` |
| Profile | 👤 | Profile | profile overlay |

The Add tab is visually elevated (filled circle, accent colour) like a floating action button, centred between Queue and Stats.

### Topbar changes

The existing topbar `<div class="topbar-actions">` block (the five `btn-icon` buttons) is **removed**. The topbar becomes:

```
[ RetainFlow   🔥 3 ]
[ Your personal Quran revision schedule ]
```

Just logo + streak chip. No action buttons.

### Theme toggle

Moves into the Profile panel, alongside the existing notification toggle. One extra row: `🌙 Dark mode [toggle]`.

### Visibility rules

| View | Bottom nav shown? |
|------|------------------|
| Landing page | No (full-screen overlay, z-index 50) |
| Dashboard | Yes — Home tab active |
| Add | Yes — Add tab active |
| Queue | Yes — Queue tab active |
| Stats | Yes — Stats tab active |
| Review | **No** — review is full-screen (z-index 100) |
| Session complete | Yes — Home tab active |

### Navigation wiring

- Tapping a tab calls `showView()` for that view (same as the existing buttons do).
- The "← Back" button is removed from Add, Queue, and Stats views — users navigate away by tapping another tab.
- The Profile tab opens/closes the existing profile overlay (same as the current 👤 button).
- Active tab highlighted with accent colour text + small underline dot.

### CSS

```css
#bottom-nav {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  height: 56px;
  padding-bottom: env(safe-area-inset-bottom, 0);
  background: var(--surface);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-around;
  z-index: 90;
}
```

`#app` and all `.view` containers gain `padding-bottom: calc(56px + env(safe-area-inset-bottom, 0))` so content isn't hidden behind the nav bar.

The nav bar is hidden (`display: none`) when `view-review` is active or `view-landing` is active.

---

## Part 2 — Full-screen Review Mode

### Layout

The review view (`#view-review`) switches to a three-zone full-screen layout:

```
┌──────────────────────────────┐  ← fixed top bar (~56px)
│  ← Back    Al-Mulk 1–10  1/3 │
├──────────────────────────────┤
│                              │
│   Arabic text + translation  │  ← scrollable content area
│   (fills remaining height)   │     flex: 1; overflow-y: auto
│                              │
├──────────────────────────────┤  ← fixed bottom dock (~130px)
│  [Forgot] [Hard] [Good] [Easy] │
│  ⏳ Remind me tomorrow         │
│  (+ safe-area inset)           │
└──────────────────────────────┘
```

### CSS approach

```css
#view-review.active {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
}

.review-top-bar {
  flex-shrink: 0;
  height: 56px;
  /* back button, item ID, progress */
}

.review-scroll-area {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 1rem;
}

.review-bottom-dock {
  flex-shrink: 0;
  padding: 0.75rem 1rem;
  padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0));
  border-top: 1px solid var(--border);
  background: var(--surface);
}
```

### What moves where

| Element | Current location | New location |
|---------|-----------------|--------------|
| Back button + progress bar | `.review-topbar` | `.review-top-bar` (fixed) |
| Review card (Arabic text, controls) | Scrolls with page | `.review-scroll-area` |
| Quality buttons | Below review card, can scroll off-screen | `.review-bottom-dock` (always visible) |
| Snooze button | Below quality buttons | `.review-bottom-dock`, below buttons |
| Swipe hint | Above quality buttons | Removed (redundant with pinned buttons) |

### Audio player & controls

The audio player, text-mode toggle, and reveal button remain inside `.review-scroll-area` — they naturally scroll with the content.

---

## Files Changed

| File | Changes |
|------|---------|
| `frontend/index.html` | Add `<nav id="bottom-nav">` before `</body>`; remove `<div class="topbar-actions">` from dashboard; remove `btn-back` from Add/Queue/Stats views; restructure review view into top-bar / scroll-area / bottom-dock |
| `frontend/style.css` | Add bottom-nav styles; update `#app` padding; add review full-screen styles; remove or reclassify displaced rules |
| `frontend/app.js` | Wire bottom-nav tab clicks; update `showView()` to toggle nav visibility; move theme toggle to Profile panel handler; update `hideBottomNav()` / `showBottomNav()` helpers |

---

## Out of Scope

- Swipe-between-tabs gestures
- Animated tab transitions
- Any backend changes
- Redesigning the Add, Queue, or Stats view content

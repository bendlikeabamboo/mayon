# US4 Home Evidence — T016–T021 (Home invites instead of shrugging)

Captured on branch `feat/ui_overhaul` against the all-Docker dev stack
(`http://localhost:5173`, `/api/health` → 200, `pg` cap live). Viewport
1440×900, chromium via playwright-cli, methodology per
`evidence/baseline/README.md`.

## Live-tested vs statically reasoned

| Aspect | Mode |
| --- | --- |
| Resume card render + exact-id navigation | **live-tested** |
| Starter chips (generic + curriculum-derived) render | **live-tested** |
| Chip → visible conversation start (create → navigate → seeded first message) | **live-tested** (mouse AND keyboard Enter activation) |
| Keyboard interactions-to-start ≤ 2 | **live-measured** (see below) |
| Light + dark theme captures | **live-tested** |
| Empty-state branch (zero history) | **statically reasoned** (dev DB has seeded history; branch is a strict subset of the history layout — `hasHistory=false` renders greeting + hero composer + chips, hides resume card and recents) |
| Hero composer send wiring | **statically reasoned** (reuses the exact `pendingPrompt` chain live-verified via chips — same `startChat` path; the resume-priority layout hides the composer whenever a candidate exists, so the seeded DB only exercises chips) |
| Loading / no-provider states | **statically reasoned** (restyled only; BootGate untouched structurally) |

## Artifacts

- `us4-home-with-history.png` — light theme, resume card
  ("Photosynthesis basics" · timeAgo · `Goal:` hint), curriculum-derived chips
  (socratic brief → "Quiz me on it" first) + generic pads, demoted recents
  (smaller headings, borderless hover-tint rows).
- `us4-home-dark.png` — dark variant: same composition, warm accent preserved
  on the Continue CTA; no luminance jumps (edges/shadows carry the card).

## Interactions-to-start (SC-3) — measured

Keyboard traversal from page load (Tab sequence, verbatim probe):

- Sidebar nav links (Home→Chat→Labs→Quizzes→Tree→Search→Settings) = tabs 1–7;
  footer buttons tabs 8–9; **resume card = tab 10; first starter chip = tab
  11**. Enter on either starts (resume → exact chat; chip → new chat with
  seeded message, verified: navigation to fresh `/chat/{uuid}`, seeded text
  visibly in transcript). Mouse path: single click. Both ≤ 2 interactions.
- State A (empty) reasoning: greeting → hero composer is the first main-region
  tab stop; Enter send completes in 2 (Tab, type, ⌘/Ctrl+Enter = still one
  focus interaction before typing).

## Chip seed verification

> **⚠️ REVISED 2026-08-27 — OWNER RULING**: Home now shows ONLY the
> "Explore a new topic" chip (`src/lib/chat/starters.ts`). The other generic
> seeds and the brief-derived seed set below were removed — they duplicated
> affordances already present on Home (quiz/lab launchers, continue-learning
> card). The multi-seed verification below is historical record.

- Brief-less context (seeded DB default): stable generic set —
  `Explore a new topic · Quiz me · Plan a study session` (chat/quiz/lab
  artifact world per A-3).
- Socratic brief (`goal: "pass the cybersecurity unit exam"`, injected
  temporarily then reverted): `Quiz me on it → Continue: pass the cybersecurity
  unit… → Turn it into practice → Explore a new topic → Quiz me` — 5 seeds,
  recall-first ordering, dedupe holds (distinct generic "Quiz me" retained
  alongside derived "Quiz me on it"; labels differ, prompts differ).

## Honesty of the start flow

Chip/hero activation = `chatStore.createAndNavigate()` → `pendingPrompt` staged
→ `goto(/chat/{id})` → chat route drains `pendingPrompt` and streams visibly.
Verified live: created chat appears in list, user message renders in transcript
(reply errored with "Missing API key" — dev provider lacks a key; the failure
surfaced honestly in-app, no silent write). Throwaway test chats deleted via
the UI afterward; DB re-verified clean (`title='New chat'` count = 0).

## Deviations / notes

1. **Empty-state screenshot not captured**: dev DB carries seeded history.
   Per task instruction, empty-state correctness is stated from code reading
   (`hasHistory` gate hides resume card + recents sections entirely; chips +
   hero composer remain).
2. **Pre-existing cold-load race (not from this change)**: direct URL loads of
   `/chat`, `/lab`, `/quiz` can 500 with "Database not bootstrapped yet" when
   the route's `load` runs before layout boot resolves (untouched routes
   reproduce it identically). Client-side navigation is unaffected. File
   separately if a fix is wanted.
3. Hero composer instance hides when a resume candidate exists (resume takes
   the hero slot per R-6); launcher callbacks (branch/quiz/lab) are wired on
   the hero composer for the no-candidate case using the chat page's
   ensure-chat pattern.

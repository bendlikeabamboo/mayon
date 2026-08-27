# Quickstart: UI Visual Articulation Pass — Validation Guide

**Feature**: `012-ui-visual-articulation` | Run this after tasks.md implementation milestones and before sign-off (SC-7 owner gate).

## Prerequisites

1. Toolchain: Node 22, pnpm 10. Fresh checkout note: build `@mayon/shared` first (`pnpm install` handles workspace; changed shared code needs `pnpm dev:build`).
2. Dev stack up: `pnpm dev` (or `MAYON_DEV_ENGINE=podman pnpm dev`) — web on http://localhost:5173, server :4319, Postgres container.
3. Have available: at least one conversation with several messages (one interrupted reply if convenient), one quiz with an attempt, one lab with checklist state, and a second-root tree of ≥ 2 levels.

## Gates (every milestone)

```bash
pnpm check        # svelte-check — must pass
pnpm lint         # eslint + prettier --check — must pass
pnpm test         # vitest run (pglite) — must pass
```

Server suite unaffected by this feature but healthy to confirm occasionally:
```bash
pnpm --filter @mayon/server test
```

## Smoke walkthroughs (map to spec stories)

### Story 1 + 2 — accent & surface ladder (both themes)
1. Toggle theme via settings (localStorage `mayon.theme` mirrors into DB).
2. Walk: sidebar → chat page → chat list → quiz list → home → tree.
   - EXPECT: active nav item, "All Chats"-class primary buttons, links, suggested-choice pills carry the single warm accent; everything else stays in the paper/charcoal neutrals; focus-visible ring on Tab traversal is accent-toned everywhere (FR-1…5).
   - EXPECT three distinguishable depth levels per screen: canvas page → panel bands → raised cards lifting via hairline border + soft shadow — no glare jumps anywhere (FR-6…8).
3. Perf probe baseline if not yet run this session: `window.__MAYON_PERF__ = 1` in console before exercising hover/motion stories (constitution IV requirement).

### Story 3 — composer instrument card & launchers
1. Open a conversation: composer renders as rounded bordered card inside the ~3xl reading column; send/model/thinking/MCP/resources controls docked within its footprint; focus raises it with the accent ring (FR-9, AC 3.3).
2. Activate **branch here** in an open chat → new child conversation opens; reload browser → it persists; Tree page shows the new node linked (FR-10/11, SC-4).
3. New-chat context: from home hero composer activate **quiz me** → conversation established + quiz created/persisting across reload.
4. Repeat genesis check with **open lab**.
5. Narrow window to cap width → controls never exit the card (AC 3.4).

### Story 4 — home invitation
1. State A zero history → greeting + starter chips present, no broken recents prominence.
2. State B unfinished recent chat → "continue learning" resume card featured; click returns exactly that chat (FR-12…14).
3. Recents/labs/quizzes sit demoted below the invitation zone on one scroll-free-glance basis.

### Story 5 — micro-interaction affordances
1. Hover assistant message → copy · branch · regenerate revealed without message layout shift (FR-15); keyboard focus reaches them too.
2. Touch-mode check (devtools coarse pointer): actions reachable by tap.
3. Sweep pointer down any list → rows tint on hover (FR-16).
4. Tree page: expand/collapse rotates caret smoothly; connector lines make children visibly subordinate (FR-17). Reduce-motion ON → rotation snaps, stagger absent (SC-9).

### Story 6 — chrome compression
1. Sidebar footer: ONE compact indicator row replacing the two legacy pills; its popover lists db readiness/runtime, server version, capabilities, restoring flag — every previously shown fact (GP-4 ≤ 2 actions, FR-18); operable by keyboard alone.
2. In a titled chat: header shows ONE summary chip (`summarizeBrief · persona`) + chevron; toggle open, navigate away/back → same chat restores expanded; sibling chats keep their own remembered states across full reloads (FR-19). Untitled/new chats render expanded until titled.

### Story 7 — warm charcoal dark
Side-by-side vs pre-change screenshots: dark panels/backgrounds read warm-charcoal (not neutral gray); text softness identical to before — no brightening (FR-20; SC-7 gate explicitly requires owner's comfort sign-off here).

### Story 8 — unified RowCard
Chat list beside quiz list beside lab list: identical anatomy `title · timestamp · progress-meta`, equal spacing rhythm, hover response, edge treatment (FR-21). Quiz progress slot may show question-count meta as shipped baseline.

### Story 9 — motion honesty
1. Navigate routes: subtle per-child fade/stagger completing < ~0.5 s total (FR-22).
2. No skeleton flashes on fast loads; loading text acceptable where already present unless measured > 300 ms during implementation (FR-23/A-6 — none expected).
3. Reduce-motion ON: entries are instant/minimal (SC-9).
4. Capture `[mayon-perf]` summary output after traversal vs baseline: no longtask/frame regression.

## Unit/component test spots (per repo convention)

```bash
pnpm test src/lib/chat/uiState.test.ts                 # per-chat pref contract (settings-keys.md)
pnpm test src/lib/chat/starters.test.ts                # seed derivation/fallback
pnpm test src/lib/components/chat/Composer.launchers.test.ts   # source-text pins: three launcher affordances + docked-control composition
pnpm test src/lib/components/RowCard.anatomy.test.ts   # title/timestamp/meta slots present
pnpm test src/lib/components/StatusIndicator.compose.test.ts   # aggregated states exhaustive incl. server-off gray
```
(Filenames are tasks-phase targets enforcing the contracts in this folder.)

## Known-ripple review checklist

- UserMessage bubble under retinted dark `--primary`: readable at GP-1 softness.
- Tree current-node fill + suggested-choice pills still accent-consistent.
- BootGate/home no-provider/no-content states restyled coherently with ladder.

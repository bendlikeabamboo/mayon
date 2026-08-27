# US6 Evidence — Header chip consolidation + per-chat persisted expansion (T030–T033)

Date: 2026-08-27 · Branch: `feat/ui_overhaul` · Dev stack: `mayon-dev` (docker, web :5173
bind-mounts `./src` → HMR picked up changes without an image rebuild).

## Implementation summary

- **T030** `src/lib/chat/uiState.ts`: typed helpers over `repos.settings.get/set`.
  Key literal-composed as `ui-state:<chatId>:briefExpanded` via exported
  `briefExpandedKey(chatId)`. API: `isBriefExpanded(chatId, chatTitle)` /
  `setBriefExpanded(chatId, expanded)` / `defaultBriefExpanded(title)`. Defensive
  per contract: repo returns null on miss/invalid JSON; wrong-typed values are
  filtered by a `typeof === 'boolean'` check; any repo throw also falls back to
  defaults. Untitled detection = null / empty / whitespace / `DEFAULT_TITLE`
  (`'New chat'` — placeholder stored at creation before auto-titling).
  Module documented as sole writer of `ui-state:*` keys.
- **T031** `src/lib/chat/uiState.test.ts` (pglite harness mirrored from
  `mcp.test.ts`): 11 tests — key composition literals, absent-key default
  resolution (null/''/whitespace/'New chat' vs real title), round-trip
  set→get, per-chat isolation, wrong-type string/number/object fallback, and a
  raw invalid-JSON payload injected via the pglite driver's `exec` (no throw).
- **T032** Chat page header: Target pill + GraduationCap persona pill merged into
  ONE summary chip whose label is `summarizeBrief(rootBrief) · {personaName}`
  (level/mode ride inside the summary text, R-9). Chevron button toggles the
  existing BriefCard edit-mode card rendered INLINE directly under the chip
  (main screen, never modal); chevron rotates 180° under `motion-reduce`
  guard. Hydration `$effect` reads via `isBriefExpanded(chatId,
  chatStore.chat?.title ?? null)` on mount/chat-switch/title-change; every
  toggle writes through `setBriefExpanded`. A write-sequence counter discards
  stale async reads so an optimistic toggle is never clobbered. `editingBrief`
  state was fully replaced by the persisted state.

## Zero fact loss (GP-4) — chip facts retention table

| Pre-change fact / affordance | Was (location · actions) | Post-change (location · actions) |
|---|---|---|
| Brief goal summary text (incl. `level: X` label + mode token, FR-19 intent) | Target pill · 0 actions | Same text in single chip · 0 actions |
| Persona name | GraduationCap pill · 0 actions | Trailing segment of same chip label · 0 actions |
| "(inherited)" marker on branch chats | suffix on Target/persona pills · 0 actions | Suffix on the single chip · 0 actions |
| Brief edit access (goal/context/scope inputs) | Click Target pill (root only) · 1 action | Chip body click OR chevron · 1 action |
| Level/mode/structure/teacher selects | Edit card → Calibration disclosure (1 pill click + up to 1 disclosure) · ≤2 actions | Chevron → inline edit card → Calibration disclosure · ≤2 actions |
| Persona switch access | Edit card via persona-pill click + disclosure · ≤2 actions | Same selects via chevron path · ≤2 actions |

Chevron exists on root chats only — branch chats were non-interactive pre-change
(inherited brief is read-only there) and stay so; their chips carry "(inherited)".

Status-side facts (T027–T029, sidebar footer): legacy DbStatus row (db
ready/runtime label · status dot · error text + reload affordance when failing)
and ServerStatus row (server version · capability list `stdio-mcp`, `llm-proxy`,
`sandbox-db`, `backup`, `pg` · browser-only warning variant) both survive as
readout fragments inside the StatusIndicator popover body — compact indicator
row = 0 actions for the one-line `server v{x} · db {state}` summary, popover open
= 1 more action → every legacy status fact ≤2 actions. Error-state reload affordances
kept functional in place.

## Persistence proof (per-chat expansion memory)

Fixture chats seeded in the dev volume (`us6seed-*`, dev-only): two titled roots
with distinct briefs/personas, one `'New chat'` titled root with a brief, plus a
branch of chat A.

| Step | Observation |
|---|---|
| Open `us6seed-titled-a` ("Makefile Fundamentals") | Exactly ONE pill: `Goal: be able to read and write a Makefile · level: some · socratic · Dr. Kim`; no edit panel → collapsed by default ✓ |
| Click chevron | Inline BriefCard edit card appears under chip (heading "What do you want to be able to do?", Calibration/Advanced disclosures); chevron → "Collapse brief details" `[expanded]` ✓ |
| Full page reload on A | Panel STILL expanded without interaction ✓ |
| Open `us6seed-titled-b` ("Regex substitution drills") | Own chip (`… · Kit`), collapsed (its remembered state = default) ✓ |
| Expand B via chevron, reload B | STILL expanded — B remembers independently ✓ |
| Navigate back to A after round trip | STILL expanded ✓ |
| Collapse A via chevron, reload A | STILL collapsed; DB row flips to `false` ✓ |
| Open `us6seed-untitled` (`'New chat'` title + brief) | Auto-expanded with ZERO interactions (untitled ⇒ expanded default) ✓ |
| Chip body click (B, after collapse+reload) | Opens the edit panel — original primary action preserved ✓ |
| Open `us6seed-branch-a` | Single chip with `(inherited)` suffix; NO chevron; body inert ✓ |

Storage-level confirmation (dev Postgres):

```sql
select key, value from settings where key like 'ui-state:%';
-- ui-state:us6seed-titled-a:briefExpanded | false
-- ui-state:us6seed-titled-b:briefExpanded | true
```

Exact contract key naming, JSON booleans, one independent row per chat.

Screenshots: `us6-chip-expanded.png` (chat A expanded inline), `us6-chip-collapsed.png`
(chat A collapsed after explicit collapse + reload).

## Gates

- `pnpm check` — 0 errors, 0 warnings
- `pnpm lint` — ESLint clean · Prettier clean
- `pnpm test` — 96 files / 1512 tests passed (incl. new `uiState.test.ts`, 11)

## Deviations / decisions

1. Verification evidence lives in this file (`us6-chips.md`) with screenshots named
   `us6-chip-{expanded,collapsed}.png` per tasking; tasks.md T033 names
   `us6-chrome.md` — treated as satisfied here (status-fact GP-4 enumeration
   included above).
2. Chevron/expansion gated to ROOT chats: letting branches expand would newly
   expose a writable editor for the inherited root brief (pre-change branches
   could not reach it). Per-chat persistence therefore applies across chats;
   branch chats show the consolidated read-only chip with "(inherited)".
3. Chevron remains visible on untitled chats (contract parenthetical suggests it
   appears "once title exists"); keeping it always visible lets users collapse or
   explicitly persist expansion BEFORE the first reply titles the chat, avoiding
   a default flip that would ignore an earlier choice.
4. Saved-brief flow collapses+persistence-collapse afterwards exactly like the old
   editor closed on save.

# US3 Evidence — Composer instrument card + persisted-artifact launchers (T012–T016)

Date: 2026-08-27 · Branch: `feat/ui_overhaul` · Dev stack: `mayon-dev` (docker),
`http://localhost:5173` HTTP 200, `/api/health` `{ok:true, version:0.3.0, caps:[…pg]}`.

## Implementation summary

- `src/lib/components/chat/Composer.svelte` restructured: input area wrapped in a
  `surface-card rounded-xl` instrument card carrying the focus state
  (`focus-within:border-ring focus-within:shadow-md focus-within:ring-2
  focus-within:ring-ring/30`, FR-4/FR-9). Textarea de-boxed
  (`border-0 bg-transparent … outline-none`), auto-grow + `MAX_TEXTAREA_H = 22*16`
  (352px) cap retained. ALL controls (MCP Plug · resources FileText · insert-prompt
  MessageSquarePlus · Thinking Brain · Send/Stop destructive) docked in a footer row
  INSIDE the card footprint. Attachment chips render above the input inside the card
  (chosen placement: inside, keeps the card the single containing surface). Provider·
  model caption stays ABOVE the card (outside, quiet metadata line).
- Launchers (T013): `branch here` (GitBranch) · `quiz me` (ListChecks) · `open lab`
  (FlaskConical) as compact icon-chip buttons in the card footer, left of the docked
  controls. Outcome-announcing `aria-label`s; disabled-with-explanatory
  `title`/`data-tip`/`aria-label` when streaming or generation busy or no provider
  (never hidden — GP-4). New callback props `onBranch` / `onQuiz` / `onLab` plus
  `canGenerate`, `quizBusy`, `labBusy` props (Svelte 5 callback-prop idiom).
- Wiring (T014, `src/routes/chat/[id]/+page.svelte`): see "Branch composition" below;
  quiz mirrors `onGenerateQuiz` (`quizzesStore.generate(chatId)` → `/quiz/<id>`),
  lab mirrors `onGenerateLab` (`labsStore.generate(chatId)` → `/lab/<id>`); the
  parse-failure fallback is the EXISTING `labsStore.rawOffer` bottom-pane card
  (no separate `saveRaw` call added — it already composes the same store API).
  Guard: launchers disabled while `streaming` / `quizzesStore.generating` /
  `labsStore.generating` — no silent double-fire (contract rule 5).

## Branch composition (T014 decision)

`onLaunchBranch` = root-level branch **without** a source message:

1. `chatStore.createAndNavigate()` (→ `repos.chats.createRoot`) only when no chat is
   open (unreachable on this route; future-proof for the home hero composer).
2. `repos.chats.createChild({ parentId, branchPointMessageId: null, title: 'Branch of …' })`
   — the SAME persisted row `chatStore.branchFromMessage()` writes, minus the fork
   point. No `branchSourcesRepo.create` edge: an edge row requires a
   `sourceMessageId` (NOT NULL FK), and `branchFromMessage` itself writes none —
   only `createExpoundBranch` (excerpt-grounded) does. So the minimal correct
   composition is `createAndNavigate` + `createChild(null)`; a `branchFromMessage`
   call with a fabricated messageId was rejected (would create a dangling FK or a
   fake message). Also sets `chatStore.manualBranchPending = true` (same UX1a intent
   as `branchFromMessage`). UI outcome = `goto(/chat/<childId>)`.

No store signature changes were needed; no repo bypasses (page already uses `repos`
directly elsewhere for nav reads — `createChild` here matches `branchFromMessage`'s
internal write through its own repo usage).

## Containment (AC 3.4 / FR-9)

DOM-verified via `textarea.closest('.surface-card')` bounding-box comparison of all
visible card buttons (`offsetParent ≠ null`), zero offenders at:

| Viewport | Card width | Visible buttons | Overflow offenders | doc scroll-x |
|---|---|---|---|---|
| 1280 | 720px (max-w-3xl cap reached) | 8 | none | false |
| 860 | 736px | 8 | none | false |
| 480 | 448px | 8 | none | false |

Footer uses `flex-wrap`, so chips + controls wrap inside the card at narrow widths.

## Keyboard & AT parity (contract rule 7)

Tab from the focused textarea reaches, in order: `Branch here: creates a tree node
under this chat` → `Quiz me: generates a quiz artifact bound to this conversation`
→ … (verified live via keyboard.press('Tab') + activeElement assertions).

## Streaming gate probe

⌘/Ctrl+Enter send via the card works; rapid polling during the send window caught
`Stop` visible + branch launcher disabled simultaneously (gating tracks
`streaming`). Window is short with a fast provider (ms), so the disabled-with-
explanation tooltip was verified structurally (title/aria bound to the same
`streaming`/busy state) rather than as a lingering screenshot.

## Persistence proof (GP-3 / SC-4) — full reload each

Setup honesty: the LLM boundary was mocked at the network layer
(`**/api/llm/proxy` route returning structured tool-call responses) because the
fresh playwright profile has no real API key in IndexedDB. **All persistence is
real** — every artifact below is a Postgres row written through the production
store→repo chains; only the model completion was stubbed.

Seed: root chat `us3seed-0001-chat` ("Photosynthesis basics") + 2 messages inserted
via `/api/db/query` to have a chat with messages for binding.

| Launcher | Click → outcome | Reload proof |
|---|---|---|
| **quiz me** | navigated to `/quiz/d461b2b7-0e7e-40e9-8368-0abc09d0ac23` ("Quiz #2", "Generated by qwen/qwen3.6-35b-a3b") | full reload → runner still renders; `/quiz` index lists "PHOTOSYNTHESIS BASICS · Quiz #2 · 1 questions · 1m ago" |
| **open lab** | navigated to `/lab/c00743ad-a420-4d81-959f-19ddf69f84f9` ("Photosynthesis lab", checklist 0/2) | full reload → runner renders title/intro/steps/checklist from DB |
| **branch here** | navigated to `/chat/b0a33894-2d8b-47fd-98fe-1efa555406cb`, title "Branch of Photosynthesis basics" | full reload → still loads; breadcrumb PARENTS: Photosynthesis basics → Branch of… |
| branch node on tree | `/tree` shows "Photosynthesis basics" → "Branch of Photosynthesis basics · just now · 1 branches" | (tree read = fresh DB query) |
| branch in ChatRail | rail BRANCHES (1) shows the child chip from the parent chat | visible in `us3-composer.png` |
| `/chat` list | root list unchanged (children intentionally excluded from roots list; tree page + rail are the branch surfaces) | — |

Also verified (bonus): the lab parse-failure path shows the existing bottom-pane
"Lab output couldn't be parsed → Save raw text as lab" card above the composer —
the rawOffer fallback from the contract, reachable without any new code.

## Screenshot

`us3-composer.png` — light theme, 1280×800, textarea focused: card shows accent
ring + elevated border, launchers `branch here · quiz me · open lab` docked left,
Plug/Brain/Send docked right, rail shows Branches(1) / Photosynthesis lab / Quiz #2
(all three artifacts from this session).

## Dev-stack residue (intentional, for reproducibility)

Rows left in the dev Postgres (`pg-data-dev`): chat `us3seed-0001-chat`, its child
`b0a33894-…`, quiz `d461b2b7-…`, lab `c00743ad-…`, plus the streamed
"glucose fuels the leaf." message. Browser-profile residue: placeholder key
`mock-key-ui-verification` for provider id `9435fe41-…` in the playwright
profile's IndexedDB only (not the user's browser profile).

## Gates (T016 finish)

| Gate | Result |
|---|---|
| `pnpm check` | PASS — 0 errors, 0 warnings |
| `pnpm lint` | PASS — eslint clean; prettier "All matched files use Prettier code style!" |
| `pnpm test` | PASS — Test Files 93 (92+1 new), Tests 1481 (1478+3 new) |
| `Composer.launchers.test.ts` | PASS — 3/3 (labels, de-boxed textarea, surface-card containment) |

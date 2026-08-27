# Phase 1 Data Model: UI Visual Articulation Pass

**Feature**: `012-ui-visual-articulation` | **Date**: 2026-08-27

> **Headline**: This feature introduces **zero database schema changes**. Every entity below either already exists in `src/lib/db/schema.ts` (consumed via `repos.*` only), is an existing client-side store/service shape being re-presented, or is a virtual entity encoded through the settings KV contract (`contracts/settings-keys.md`). No drizzle migration will be generated.

## Entities

### Conversation (chat) — *existing, read/write via launchers & home*

| Field (as used here) | Type | Role |
|---|---|---|
| id | uuid | identity / route param `/chat/[id]` |
| title | text \| null | drives home resume-card labeling, chip consolidation trigger (FR-19: "once a chat title exists"), RowCard title slot; may be unset until generated |
| parentId | uuid \| null | tree ancestry root vs. branch nodes |
| provider/model | text | docked-in-composer display caption today (unchanged behavior) |
| updatedAt | timestamp | recency ordering; resume heuristic ("in-progress"); RowCard timestamp |
| brief | json | summarized by chip consolidation (`summarizeBrief`) and starter derivation |

**Relationships**: has many messages; optionally anchors quizzes/labs/branch-sources.
**State transitions used**: none new — creation via launcher ensure-chat path follows existing `createRoot`; "in-progress" is a derived view predicate (latest activity + not completed), not a stored status.

### Message — *existing, untouched structurally*

Content unit inside a conversation; hover action row (copy/branch/regenerate) anchors to assistant rows. Branching continues to express itself as a **new conversation row + branch-source link**, never by mutating message ancestry. Regenerate keeps existing semantics (delete dangling reply → re-send preceding user turn).

### Branch Source (tree node edge) — *existing*

`(parent chat, branch-point message ref, child chat)` triple created by `branchSourcesRepo.create`. The tree page already models from this; the feature adds presentation (caret rotation, connector lines) over the same rows. Parent/child relationships that FR-17 must visualize are exactly these records.

### Quiz Artifact (+ questions, attempts) — *existing; list gains derived progress meta*

| View field | Derivation |
|---|---|
| label/title | current `Quiz #n` convention or topic-inherited naming (A-7 for launcher-created) |
| progress meta | question count (already rendered) as the baseline; optional last-attempt score if attempt data is cheaply available to the listing query — tasks decide; if not cheap, ship baseline (spec allows: "progress meta" satisfied by count) |

**State transitions referenced**: quiz lifecycle (created → attempted → scored) already exists via `quizAttemptsRepo.start/finish`; unified RowCard only reads it.

### Lab Artifact — *existing*

Created by composer launcher via `labsStore.generate(chatId)` (or `saveRaw` fallback); lists gain RowCard adoption only. Completion derives from existing checklist state (home already computes unfinished labs).

### Per-chat Display Preference — *NEW virtual entity (settings KV, no schema)*

Encoded per `contracts/settings-keys.md`:

```
key:   ui-state:<chatId>:briefExpanded
value: true | false        (JSON scalar)
absence ⇒ default rule: untitled/new chats expanded · titled chats collapsed
```

**Fields**: key components above; no timestamps (KV table's own columns serve).
**Validation rules**: chatId must be an active-owned chat id; value strictly boolean; writer = `lib/chat/uiState.ts` (only authorized caller).
**Lifecycle**: survives reloads/sessions by KV nature (FR-19 persistence scenario 4); deleted implicitly when user deletes chat (orphan keys acceptable today exactly like `'draft:'` orphans — precedent).

### Status Readout — *existing ephemeral service state, re-presented*

Composition consumed by the compact indicator:
- `serverStatus`: connected | caps set (`stdio-mcp`, `llm-proxy`, `sandbox-db`, `backup`, `pg`) | version | restoring
- `dbStatus`: initializing | ready | error | runtime label | self-check state

Nothing persisted; aggregate color rule (green/amber/red/gray) defined in `contracts/design-tokens.md` §status roles so presentation can't contradict GP-4's "facts stay reachable".

### Starter Suggestion — *derived, non-persisted*

Produced at render time by `lib/chat/starters.ts`: prefers seeds grounded in available curriculum/brief context of recent activity; falls back to a small generic study-seed set on fresh instances (A-3). Activation = seed text entering the composer/chat send flow (never silent side-effect writes beyond the honest artifact creation it visibly triggers).

### Theme Token Set — *configuration data in CSS (contracted, not migrated)*

Per-theme definitions owned by `src/app.css` token blocks; authoritative names/roles/usages live in `contracts/design-tokens.md`. Treat as versioned interface: any consumer-visible addition/removal edits that contract in the same change.

## Entity relationship sketch (feature-relevant slice)

```text
Chat ──1:N──▶ Message
Chat ──0..1:N──▶ BranchSource ──N:1──▶ Chat (parent)
Chat ──0..N──▶ Quiz ──0..N──▶ Attempt
Chat ──0..N──▶ Lab ──(checklist items)
settings KV ◇──◇ ui-state:<chatId>:*       (virtual Per-chat Display Preference)
(ephemeral) serverStatus/dbStatus ──▶ StatusIndicator presentation
(derived)  Chat/Brief context ──▶ StarterSuggestion[]  (render-time only)
```

## Validation rules carried into implementation

1. Launcher-created artifacts MUST survive full reload (SC-4) — structurally guaranteed by routing creation through repos; quickstart asserts manually.
2. Per-chat pref writer confined to `uiState.ts`; reads tolerate absent/corrupt values by falling back to defaults (defensive JSON.parse mirroring settings conventions).
3. Aggregate status states enumerate exhaustively (unknown/off treated as gray degraded-visible, never blank).
4. No writes to generated search columns anywhere introduced (vacuous but restated per constitution II).

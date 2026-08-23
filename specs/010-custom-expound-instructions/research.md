# Research: Customizable Expound Instructions

**Feature**: `010-custom-expound-instructions` | **Date**: 2026-08-23

Phase 0 output. All Technical Context unknowns resolved via two explore-agent reports (expound data flow; settings architecture) plus direct file reads. No NEEDS CLARIFICATION markers remain.

## R-1: Where the instruction list lives

- **Decision**: A single JSON settings key `expoundInstructions` (array of `{ id, name, description?, builtin? }`) in the existing `settings` KV table, read/written only via `repos.settings`.
- **Rationale**: The `settings` table is a generic key-value store (`src/lib/db/schema.ts:208-213`); adding a key requires **no drizzle migration** (migrations run server-side only — `server/src/pg.ts:104-115` — and no table/column changes are needed). Two strong precedents exist: `mcpServers` (`Record<id, McpServerConfig>`, `src/lib/db/repositories/mcp.ts:8`) and `learnerProfile` (seeded object, `settings.ts:49-50`). Values are non-secret display text, satisfying the constitution's "no secrets in settings" rule.
- **Alternatives considered**:
  - New `expound_instructions` table + repo: rejected — needs a migration, a new repository, and backup/restore surface area for what is a per-user preference list with no query dimensions (never queried by column, always loaded whole).
  - IndexedDB: rejected — every other settings section uses `repos.settings`; splitting storage would break the single-source-of-truth pattern and backup coverage.

## R-2: How existing installs get the two new built-ins (FR-007)

- **Decision**: Add a null-guarded seed to `settingsRepo.seedDefaults()` (`src/lib/db/repositories/settings.ts:47-51`): `if (get('expoundInstructions') === null) set('expoundInstructions', DEFAULT_EXPOUND_INSTRUCTIONS)`.
- **Rationale**: `seedDefaults()` already runs at every boot from the root layout (`src/routes/+layout.svelte:25`) and is idempotent per key (insert-if-absent). Existing installs lack the key, so the first boot after upgrade seeds all five built-ins with zero user action; once seeded it is never overwritten, so user customizations survive restarts. Fresh installs seed identically. The repo already imports a default from `$lib/chat/` (`DEFAULT_PROFILE` from `$lib/chat/brief.ts`, `settings.ts:4`), so importing `DEFAULT_EXPOUND_INSTRUCTIONS` from the new module follows established precedent.
- **Alternatives considered**:
  - Server-side data migration (`server/src/schema-migrations.ts` + `schemaVersion` bump): rejected — that registry exists for cross-version schema repairs; a null-guarded seed achieves the same with no version bump and no restore-compatibility implications (backups restore the settings row verbatim; a restored backup from before the feature simply re-seeds on next boot).
  - Lazy defaults-on-read only (no seed row): rejected — the Settings UI and picker can fall back to defaults when the key is absent, but seeding makes "reset to what's actually stored" semantics uniform with `learnerProfile`.

## R-3: What gets stored in `branch_sources.add_formats` going forward

- **Decision**: Serialize the selected instructions' **display names** verbatim (`serializeAddFormats(names)` stays `JSON.stringify`; `parseAddFormats` returns `string[]`).
- **Rationale**: FR-012 requires branches to keep displaying their recorded instruction names after the instruction is renamed or removed. Names recorded at creation satisfy this with zero indirection — `ExpoundCard` renders stored strings directly (dropping its `TOGGLE_LABELS` lookup). The column is nullable `text` (`schema.ts:104`) and already stores a JSON string array; the format change is string-content-only.
- **Alternatives considered**:
  - Store instruction `id`s and resolve through the settings list: rejected — renames/deletes orphan the ids, directly violating FR-012.
  - Denormalize into a side table at creation: rejected — new table/migration for data already carried by `add_formats`.

## R-4: Backward compatibility with rows stored by the current version

- **Decision**: Read-time legacy mapping in `parseAddFormats`. Existing rows store toggle **keys**: `'["diagrams","tables"]'` (asserted in `src/lib/stores/chat.svelte.test.ts:949-966`). The parser keeps a frozen `LEGACY_TOGGLE_LABELS` map (`diagrams → 'Diagrams (prompt diagrams)'`, `tables → 'Comparison Tables'`, `code → 'Code Examples'`), maps known legacy keys to labels, and passes every other string through **verbatim** (no more valid-set filtering — today's filter drops unknowns at `expound.ts:82-83`, which would violate FR-012 for custom entries). Malformed JSON / non-array / non-string entries still degrade to `[]`, matching current tests (`chat.svelte.test.ts:935-941`).
- **Rationale**: Historical rows are never rewritten (cheap, preserves FR-012 exactly, no backfill migration). The one existing test asserting unknown-dropping (`parseAddFormats('["diagrams","unknown"]') → ['diagrams']`, `chat.svelte.test.ts:943-945`) changes semantics by design: unknown values are now preserved as recorded names.
- **Alternatives considered**:
  - One-time backfill rewriting rows: rejected — touches historical data for no user-visible gain; also complicates backup/restore interplay.
  - Keep filtering unknowns: rejected — would break FR-012 for any removed/renamed custom instruction.

## R-5: How the picker obtains the current list (SC-002: no restart)

- **Decision**: `ExpoundPromptConstructor.svelte` loads the list via `getExpoundInstructions()` in `onMount` (it is mounted fresh each time the user opens the expound flow), and the Settings section loads its own copy on mount — the codebase's established "re-read settings at time of use" pattern (e.g., `labPrompt` is re-read per generation, `src/lib/ai/generate/generate.ts:64`). No new global settings store.
- **Rationale**: Research confirms **no settings Svelte store exists** (`src/lib/stores/` has chat/labs/quizzes/theme/toasts/diagnostics/db only); settings sections keep local `$state` loaded in `onMount` (McpServers `load()`, LearnerProfileConfig, LabPromptConfig). Because the picker remounts per invocation, every opening reflects the latest saved list — SC-002 holds with zero reactive infrastructure.
- **Alternatives considered**:
  - New `settings.svelte.ts` store with cross-component reactivity: rejected — no existing consumer needs it; adds a new architectural element where the re-read pattern suffices.

## R-6: Settings section UX pattern

- **Decision**: `ExpoundInstructionsConfig.svelte` modeled on `LearnerProfileConfig`/`McpServers`: `onMount` load → local `$state` array → whole-list persist on every mutation (`repos.settings.set`, mirroring `McpServers.persist()` whole-map overwrite) → inline `role="status"`/`role="alert"` feedback. Inline editing (name input required, description input optional) with commit-on-change; "Add" appends a draft entry; remove filters. Restore-defaults behind a shadcn `Dialog` confirmation (destructive-action precedent: `DataSection` import confirm, `McpServers` trust banner). Raw `<input>`s with the shared Tailwind `inputClass` constant pattern (`McpServers.svelte:66-67`); `Button`, `Dialog`, `Badge` from existing shadcn wrappers; `Built-in` badge via `builtin` flag.
- **Rationale**: Constitution III requires composing from the existing component vocabulary and matching visual conventions; the surveyed settings components establish exactly these patterns (inline status text, no per-item save, Dialog for confirms). No `input`/`select` shadcn wrappers exist in the repo — raw inputs are the convention.
- **Alternatives considered**:
  - Draft-then-save single Save button (LearnerProfile style): viable, but inline commit matches the list-manipulation feel of McpServers and avoids a dirty-state tracker; restore-defaults still confirms via Dialog since it discards multiple edits.
  - Toasts for feedback: rejected — settings sections use inline status text; the toast store is reserved for global events.

## R-7: Validation rules (FR-010)

- **Decision**: Name: required, trimmed non-blank, unique within the list (case-insensitive on the trimmed value), max 60 chars. Description: optional, max 200 chars. Violations show inline `role="alert"` messages and block persist of the offending change.
- **Rationale**: Names are user-facing identifiers carried into prompts and stored on branches; uniqueness keeps the picker unambiguous and the serialized format collision-free. Bounds keep picker rows and pills usable (spec edge case: "unreasonably long" input). 60/200 are documented reasonable defaults (spec Assumptions allow such defaults).
- **Alternatives considered**: Case-sensitive uniqueness (rejected — "Mermaid Diagram" vs "mermaid diagram" would render as duplicates to users); no length bounds (rejected — spec edge case explicitly asks for bounded input with feedback).

## R-8: Identifier strategy for list entries

- **Decision**: Opaque string `id`: literal slugs for the five built-ins (`diagrams`, `tables`, `code`, `mermaid-diagram`, `focus-callouts` — kept aligned with the legacy keys where they overlap) and `uuid()` (`src/lib/db/ids.ts`) for user-added entries.
- **Rationale**: Stable ids key the Svelte `{#each}` and the picker's `SvelteSet` selection; the built-in slugs matching legacy keys keeps mental-model continuity (ids never persist to `add_formats` — only names do, per R-3). `uuid()` is the established new-id helper (McpServers drafts).
- **Alternatives considered**: uuid for built-ins too (rejected — noise; restore-defaults equality checks are simpler with stable slugs); name-as-id (rejected — renames would break keyed rendering/selection).

## R-9: Blast radius of removing `ExpoundToggle` / `TOGGLE_LABELS`

- **Decision**: Replace `ExpoundOptions.toggles: ExpoundToggle[]` with `toggles: string[]` (display names); delete `ExpoundToggle` and `TOGGLE_LABELS` exports; move the legacy label map into `expound.ts` as a private constant used by `parseAddFormats`.
- **Rationale**: Whole-repo sweep (research task 1, §8) found the complete consumer set — `expound.ts`, `expound.test.ts`, `chat.svelte.ts` (serialize call only), `chat.svelte.test.ts`, `+page.svelte` (cast to drop), `ExpoundPromptConstructor.svelte`, `ExpoundCard.svelte`, `Highlighter.svelte` (type-only), `rows/AssistantMessage.svelte` (type-only), `schema.ts` (column, untouched), `branch-sources.ts` (`string` already). Zero references in `server/` and `packages/`. Renaming the field (e.g. `instructionNames`) would ripple through `Highlighter`/`AssistantMessage` type-only imports for no behavioral gain; keeping `toggles` minimizes the diff.
- **Alternatives considered**: Keep `ExpoundToggle = string` alias: rejected — a type alias named "Toggle" describing free-form names misleads; plain `string[]` with a doc comment is clearer.

## Consolidated unknown-resolution table

| Technical Context unknown        | Resolved by                                                   |
| -------------------------------- | ------------------------------------------------------------- |
| Storage mechanism for the list   | R-1 (settings KV, no migration)                               |
| Upgrade path for new built-ins   | R-2 (null-guarded boot seed)                                  |
| Serialization/persistence format | R-3 (names verbatim), R-4 (read-time legacy mapping)          |
| Picker freshness without restart | R-5 (load per mount, re-read pattern)                         |
| UI primitives/conventions        | R-6 (McpServers/LearnerProfile patterns, shadcn + inputClass) |
| Validation semantics             | R-7 (blank/duplicate/length)                                  |
| Type migration surface           | R-8, R-9 (ids, string toggles, full consumer list)            |

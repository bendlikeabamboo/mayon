# Implementation Plan: Customizable Expound Instructions

**Branch**: `010-custom-expound-instructions` | **Date**: 2026-08-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-custom-expound-instructions/spec.md`

## Summary

Replace the three hardcoded expound "added instruction" toggles (`ExpoundToggle` / `TOGGLE_LABELS` in `src/lib/chat/expound.ts`) with a user-editable list of `{ id, name, description? }` entries persisted as a JSON settings key (`expoundInstructions`) — no schema migration, following the `mcpServers`/`learnerProfile` settings-KV precedent. The default list expands to five built-ins (adds "Mermaid Diagram" and "Focus Callouts"), seeded idempotently at boot via `settingsRepo.seedDefaults()`. A new Settings section provides add/edit/remove with name validation, plus restore-defaults behind a confirmation dialog. The expound picker (`ExpoundPromptConstructor`) reads the list at mount time; selected instruction **names** flow into the prompt, are serialized verbatim into `branch_sources.add_formats`, and render verbatim on `ExpoundCard` — so historical branches keep displaying recorded names even after edits/removals. Legacy stored keys (`diagrams`/`tables`/`code`) are mapped to their display labels at read time; no historical rows are rewritten.

## Technical Context

**Language/Version**: TypeScript on Node 22 (`.nvmrc`), pnpm 10; Svelte 5 runes.

**Primary Dependencies**: SvelteKit (static SPA, `@sveltejs/adapter-static`), Svelte 5 runes (`$state`, `SvelteSet`), Tailwind v4 + shadcn-svelte (bits-ui) components, drizzle ORM over the `StorageDriver` seam.

**Storage**: Postgres via the `settings` KV table (`key` PK, JSON `value` text — `src/lib/db/schema.ts:208-213`), accessed only through `repos.settings` (`src/lib/db/repositories/settings.ts`). New key `expoundInstructions`; **no migration required** (generic KV store). Existing `branch_sources.add_formats` (text, `schema.ts:104`) is reused unchanged.

**Testing**: Vitest with the pglite test driver (`pnpm test`; `useFileTestDb()` from `src/lib/db/driver/pg-test.ts`). Store tests beside stores; module tests beside modules.

**Target Platform**: Browser SPA (dev: Vite in Docker; prod: static bundle served from `ghcr.io/.../mayon`).

**Project Type**: web-app (SPA + Node server; this feature is SPA-only — no server/ or packages/ changes).

**Performance Goals**: No new runtime dependencies; settings read happens once per expound-picker mount and once per Settings-section mount (same cost class as `mcpServers`). No measurable impact expected; no perf-probe run required (no render-path changes beyond the picker's existing mount).

**Constraints**: Constitution gates — `pnpm check`, `pnpm lint`, `pnpm test` must pass; no secrets in settings; app code touches repos only; expound offset/selection mechanics untouched.

**Scale/Scope**: ~1 new lib module, 1 new settings component, 6 small file edits, 4 test files touched. Single user, single global list.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Verdict | How satisfied |
| --- | --- | --- |
| I. Layering: app code calls repositories only | PASS | New component + module call `repos.settings` exclusively; no `db` import outside `src/lib/db/`. The repo→`$lib/chat` import precedent (`settings.ts:4` imports `DEFAULT_PROFILE` from `$lib/chat/brief`) is followed in reverse for defaults. |
| I. `StorageDriver` is the only storage seam | PASS | No driver changes; all access via `settingsRepo.get/set`. |
| I. `pnpm check` + `pnpm lint` before merge | PASS | Listed as task gates. |
| I. No secrets in `settings` | PASS | Values are user-authored display text (name + optional description) only. |
| I. No `+`-prefixed non-route files | PASS | No new route files. |
| II. Tests accompany new `src/lib/` behavior | PASS | New module `expound-instructions.ts` ships with `expound-instructions.test.ts`; updated behavior in `expound.ts` (parse/serialize/prompt) and `settings.ts` (seeding) covered by updated/new tests. |
| II. `pnpm test` (pglite) green | PASS | Task gate. No server-side changes → server tests unaffected. |
| III. UI from existing Tailwind v4 + shadcn vocabulary | PASS | Reuses `Button`, `Dialog`, `Badge` + the raw-`<input>`-with-shared-`inputClass` pattern used by `McpServers.svelte:66-67`; inline `role="status"`/`role="alert"` feedback per `DataSection`. |
| III. Progressive degradation | PASS | Settings KV is the same storage every settings section already uses; no new capability dependency. |
| III. Expound offsets via source map; no substring heuristics | PASS | Selection/offset/overlap code paths untouched; only the instruction-label source changes. |
| IV. Bundle growth justified | PASS | Zero new dependencies. |
| IV. Drizzle migrations via `pnpm db:generate` | PASS/N.A. | No schema change — no migration generated; nothing hand-edited. |

No violations → Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/010-custom-expound-instructions/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── expound-instructions-settings-key.md
│   └── branch-add-formats-format.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── chat/
│   │   ├── expound-instructions.ts              # NEW — entity type, DEFAULT_EXPOUND_INSTRUCTIONS (5 built-ins),
│   │   │                                         #   sanitize/validate helpers, get/save over repos.settings
│   │   ├── expound-instructions.test.ts         # NEW — defaults, sanitize, validation tests
│   │   ├── expound.ts                           # EDIT — drop ExpoundToggle/TOGGLE_LABELS; toggles: string[];
│   │   │                                         #   buildExpoundPrompt joins names; parseAddFormats maps legacy keys,
│   │   │                                         #   keeps unknown strings (recorded names) verbatim
│   │   ├── expound.test.ts                      # EDIT — new prompt/parse semantics incl. legacy mapping
│   │   └── (selection.ts untouched)
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ExpoundInstructionsConfig.svelte  # NEW — Settings section: list/add/edit/remove/validate/
│   │   │   │                                     #   restore-defaults (Dialog confirm), persists whole list
│   │   │   ├── ExpoundPromptConstructor.svelte   # EDIT — options from getExpoundInstructions() at mount;
│   │   │   │                                     #   description helper text; submit selected names
│   │   │   └── ExpoundCard.svelte                # EDIT — render stored names verbatim (no label lookup)
│   │   └── (ui/ primitives reused: button, dialog, badge)
│   ├── db/
│   │   ├── repositories/
│   │   │   ├── settings.ts                      # EDIT — seedDefaults() seeds expoundInstructions (null-guarded)
│   │   │   └── repositories.test.ts             # EDIT — seeding coverage
│   │   └── (schema.ts untouched — no migration)
│   └── stores/
│       └── chat.svelte.test.ts                  # EDIT — round-trip tests with names instead of toggle keys
└── routes/
    ├── settings/+page.svelte                    # EDIT — mount <ExpoundInstructionsConfig /> after LearnerProfileConfig
    └── chat/[id]/+page.svelte                   # EDIT — parseAddFormats result typed string[] (drop cast)
```

**Structure Decision**: Single-project SPA layout (Option 1) — the feature is confined to `src/lib/chat/` (domain module + tests), `src/lib/components/chat/` (settings section + two edited chat components), `src/lib/db/repositories/settings.ts` (seed line), and two route edits. No `server/` or `packages/shared` changes; settings placement follows the existing feature-domain convention (LearnerProfileConfig in `components/chat/`, McpServers in `components/mcp/`).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — table left empty.

# Contract: `expoundInstructions` settings key

**Feature**: `010-custom-expound-instructions` | **Date**: 2026-08-23

Internal persistence contract for the customizable expound instruction list. Consumers: the Settings section (`ExpoundInstructionsConfig.svelte`), the expound picker (`ExpoundPromptConstructor.svelte`), and `settingsRepo.seedDefaults()`.

## Key

- **Table**: `settings` (generic KV: `key` PK, `value` = JSON text — `src/lib/db/schema.ts:208-213`).
- **Key name**: `expoundInstructions`.
- **Access**: only via `repos.settings.get` / `repos.settings.set` (`src/lib/db/repositories/settings.ts`). No other read/write path is permitted (constitution I).

## Value shape

```json
[
	{ "id": "diagrams", "name": "Diagrams (prompt diagrams)", "builtin": true },
	{ "id": "tables", "name": "Comparison Tables", "builtin": true },
	{ "id": "code", "name": "Code Examples", "builtin": true },
	{
		"id": "mermaid-diagram",
		"name": "Mermaid Diagram",
		"description": "Render flows and relationships as Mermaid diagrams",
		"builtin": true
	},
	{
		"id": "focus-callouts",
		"name": "Focus Callouts",
		"description": "Emphasize key takeaways with callout blocks",
		"builtin": true
	}
]
```

- `id`: string, unique within the array. Built-in slugs are stable (`diagrams`, `tables`, `code`, `mermaid-diagram`, `focus-callouts`); user entries use `uuid()`.
- `name`: string, required. Trimmed non-blank, unique case-insensitively within the array, ≤ 60 chars.
- `description`: string, optional. ≤ 200 chars; absent/empty means "no description".
- `builtin`: boolean, optional (absent = false). Display-only origin marker.
- Array order = presentation order in Settings and the picker.

## Semantics

1. **Replace-on-write**: every mutation persists the **entire** array via `repos.settings.set` (precedent: `mcpServers.saveServers` whole-map overwrite). There is no per-entry update endpoint.
2. **Seed-on-boot, null-guarded**: `settingsRepo.seedDefaults()` inserts `DEFAULT_EXPOUND_INSTRUCTIONS` iff `get('expoundInstructions') === null`. Runs at every app boot (`src/routes/+layout.svelte:25`). Consequences:
   - Fresh installs: five built-ins present with zero user action (FR/SC-003).
   - Upgraded installs: key is absent pre-upgrade → first boot seeds all five (FR-007), including the two new built-ins.
   - Existing customized values are never overwritten (null-guard, not upsert).
   - A backup restored from a pre-feature version re-seeds on the next boot; a backup with a stored list restores that list verbatim.
3. **Sanitize-on-read**: consumers use `getExpoundInstructions()` (in `src/lib/chat/expound-instructions.ts`), which runs `sanitizeInstructions` — invalid elements dropped; missing/corrupt value → `DEFAULT_EXPOUND_INSTRUCTIONS`. Readers never crash on bad data.
4. **Secret policy**: values are non-secret, user-authored display text only (constitution I: "No secrets in settings").

## Invariants

- `name` is the sole user-visible identifier carried into prompts and `branch_sources.add_formats`; `id` and `description` never leave display contexts.
- `description` is display-only (Settings + picker helper text); it is never part of the expound request (spec Assumptions).
- The key is deleted only conceptually by "restore defaults" — which in fact **overwrites** the value with `DEFAULT_EXPOUND_INSTRUCTIONS` (a literal `delete` would cause re-seeding; overwrite is the canonical reset).

## Versioning

- v1 (this feature). No version field: the shape is additive and sanitize-on-read absorbs future fields/legacy garbage. Breaking changes to element shape require a read-time migration in `sanitizeInstructions` analogous to the `add_formats` legacy key map.

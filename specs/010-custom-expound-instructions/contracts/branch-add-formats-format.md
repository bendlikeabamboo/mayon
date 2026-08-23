# Contract: `branch_sources.add_formats` storage format

**Feature**: `010-custom-expound-instructions` | **Date**: 2026-08-23

On-disk contract for the expound selection record carried by `branch_sources.add_formats` (nullable `text`, `src/lib/db/schema.ts:104`), and the expound prompt line derived from the same selection. Consumers: `chatStore.createExpoundBranch` (writer), `src/routes/chat/[id]/+page.svelte` + `ExpoundCard.svelte` (readers).

## Stored format

- `NULL` — expound created with no selected instructions (existing behavior; renders `(none)`).
- A JSON string encoding an array of strings:

```text
v2 (this feature onward): JSON array of instruction display names, in selection-list order
    '["Mermaid Diagram", "Focus Callouts"]'

v1 (current released format, read-only legacy): JSON array of toggle keys
    '["diagrams","tables","code"]'
```

- Written by `serializeAddFormats(names: string[]): string` = `JSON.stringify(names)` — content-only change from v1 (names instead of keys); the encoding is identical.
- Historical v1 rows are **never rewritten** (no backfill). Compatibility is read-time only.

## Read rule

`parseAddFormats(raw: string | null | undefined): string[]` (`src/lib/chat/expound.ts`):

1. `null`/`undefined`, malformed JSON, or non-array → `[]` (unchanged).
2. Non-string elements dropped (unchanged).
3. Each string element:
   - If it is a legacy v1 key — `diagrams`, `tables`, `code` — map to its display label:
     `diagrams → 'Diagrams (prompt diagrams)'`, `tables → 'Comparison Tables'`, `code → 'Code Examples'`.
   - Otherwise keep **verbatim** — including names of instructions since renamed or deleted (FR-012) and arbitrary/unknown strings (no valid-set filtering).

Returned strings are rendered as-is by `ExpoundCard` pills (no label lookup) and are ordered as stored.

## Prompt line contract

`buildExpoundPrompt` (`src/lib/chat/expound.ts`) embeds the selected names into the branch's first user message:

```text
With the following instructions:
<custom instructions or "(none provided)">

Adding [Name A, Name B] whenever possible.
```

- Zero selections → `Adding no extra formats whenever possible.` (unchanged).
- Names are joined with `", "` in selection-list order; brackets wrap the joined list only when non-empty (unchanged shape, new content source).
- The names in the prompt line and the names in `add_formats` for the same expound are identical strings captured at submit time.

## Invariants

- One write, at branch creation; `add_formats` is immutable thereafter.
- Stored names are point-in-time snapshots: they deliberately do **not** resolve through the `expoundInstructions` settings key at read time (renames/removals must not affect historical branches).
- Legacy mapping is frozen: the three v1 keys and their labels are permanent constants; they may never be re-pointed.
- Column type/schema unchanged — no migration accompanies this contract.

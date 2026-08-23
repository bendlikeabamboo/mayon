# Data Model: Customizable Expound Instructions

**Feature**: `010-custom-expound-instructions` | **Date**: 2026-08-23 | **Plan**: [plan.md](./plan.md)

Entities extracted from [spec.md](./spec.md) Key Entities. Storage contract details live in [contracts/](./contracts/); this file defines shapes, validation, and lifecycle.

## Entity: ExpoundInstruction

A selectable "added instruction" option offered during expound. The unit of the user-editable Settings list.

- **Definition site**: `src/lib/chat/expound-instructions.ts` (new module; pure data + helpers, no DOM).

```ts
interface ExpoundInstruction {
	id: string;            // opaque unique key; see ID rules below
	name: string;          // required, unique (case-insensitive, trimmed), ≤ 60 chars
	description?: string;  // optional helper text, ≤ 200 chars; display-only
	builtin?: boolean;     // true for the five defaults; drives the "Built-in" badge only
}
```

- **ID rules**: built-ins use stable slugs `diagrams`, `tables`, `code`, `mermaid-diagram`, `focus-callouts` (chosen to align with the legacy `add_formats` keys where they overlap); user-added entries use `uuid()` from `src/lib/db/ids.ts`. IDs never leave the settings list — only `name` is serialized into prompts and `add_formats`.
- **Default list** (`DEFAULT_EXPOUND_INSTRUCTIONS`, in order):

| id | name | description (helper text) | builtin |
| --- | --- | --- | --- |
| `diagrams` | Diagrams (prompt diagrams) | — | true |
| `tables` | Comparison Tables | — | true |
| `code` | Code Examples | — | true |
| `mermaid-diagram` | Mermaid Diagram | Render flows and relationships as Mermaid diagrams | true |
| `focus-callouts` | Focus Callouts | Emphasize key takeaways with callout blocks | true |

  The first three names match today's `TOGGLE_LABELS` exactly (including the parenthetical on `diagrams`) so existing-user prompts and pills read identically. Descriptions for the two new built-ins are suggested helper text; final wording may be adjusted at implementation review without a spec change (spec fixes names, not helper copy).

- **Validation rules** (enforced by `validateInstruction(list, draft)` in the module; also enforced defensively by `sanitizeInstructions` on read):
  - `name`: trimmed non-blank; unique within the list comparing `trim().toLowerCase()`; max length 60.
  - `description`: optional; trimmed; max length 200; empty string normalizes to `undefined`.
  - Invalid entries are rejected at the UI with an inline `role="alert"` message and are not persisted (FR-010).
- **Sanitization on read**: `sanitizeInstructions(raw: unknown): ExpoundInstruction[]` validates every element of a stored value; invalid elements are dropped; a missing/corrupt value yields `DEFAULT_EXPOUND_INSTRUCTIONS` (mirrors the defensive style of `parseAddFormats` and the learner-profile invalid-enum dropping in `repositories.test.ts`).
- **Lifecycle / state transitions**: none beyond list CRUD (append, edit-in-place, remove). The list is stored as a whole (replace-on-write); there is no per-entry persistence or reordering in scope.

## Entity: Expound Selection Record

The set of instruction names chosen for one specific expound, recorded on the resulting branch at creation time. Immutable for display purposes; independent of later changes to the instruction list (FR-012).

- **Carrier**: existing `branch_sources.add_formats` column (nullable `text`, `src/lib/db/schema.ts:104`) — unchanged. Written once by `chatStore.createExpoundBranch` → `repos.branchSources.create` via `serializeAddFormats(names)` (`JSON.stringify`).
- **Shape**:

```ts
// stored string: JSON array of display names, in list order at selection time
'["Mermaid Diagram", "Focus Callouts"]'
```

- **Read rule** (`parseAddFormats(raw): string[]` in `src/lib/chat/expound.ts`):
  - `null` / malformed JSON / non-array → `[]`.
  - Non-string elements dropped.
  - String elements: legacy keys map through the frozen table below; **all other strings pass through verbatim** (recorded names of since-removed/renamed instructions must still render — no valid-set filtering).
- **Legacy mapping table** (frozen; applies at read time only; historical rows are never rewritten):

| legacy stored key | displays as |
| --- | --- |
| `diagrams` | `Diagrams (prompt diagrams)` |
| `tables` | `Comparison Tables` |
| `code` | `Code Examples` |

- **Display**: `ExpoundCard` renders each returned string as a pill verbatim (no label lookup); empty array renders `(none)` (existing behavior).

## Entity: Settings key `expoundInstructions` (aggregate)

The persisted whole list. See contract [contracts/expound-instructions-settings-key.md](./contracts/expound-instructions-settings-key.md) for the storage semantics (seed-on-boot null-guard, replace-on-write, sanitize-on-read).

## Relationship diagram

```text
Settings ("expoundInstructions" key)
  └── ExpoundInstruction[] { id, name, description?, builtin? }
        │  (read at mount: picker + settings section)
        ▼
ExpoundPromptConstructor  ──selected names──▶  buildExpoundPrompt  ──▶  branch first user message
        │                                                     (names embedded in prompt text)
        └──selected names──▶ serializeAddFormats ──▶ branch_sources.add_formats (JSON array of names)
                                                        │
                                                        ▼ (read: parseAddFormats + legacy map)
                                                  ExpoundCard pills (verbatim names)
```

The settings list is the **only** writable source of instruction definitions; `add_formats` values are point-in-time snapshots that intentionally detach from the list after creation.

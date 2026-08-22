# Donor Sources

Reference copies extracted from the Svelte AI Elements registry JSONs.
These files are **not** imported by application code — they are reference material
for the implementation tasks (T010, T016, T023).

## Donor Dependencies (NOT installed)

| Donor | Declared deps | Notes |
| --- | --- | --- |
| `model-selector` | `bits-ui@^2.16.3` | Already in repo (v2.18+) — no new install |
| `confirmation` | `runed@^0.37.1` | Replaced with native Svelte 5 runes (`$derived`/`$effect`) per research D2 |
| `tool` | `@lucide/svelte@^1.16.0`, `runed@^0.37.1` | `runed` replaced per D2; `@lucide/svelte` already in repo |

## Per-Block File Decisions

### model-selector (15 files → 11 KEEP, 4 DROP)

**KEEP** (11):
- `model-selector.svelte` — root
- `model-selector-trigger.svelte`
- `model-selector-dialog.svelte`
- `model-selector-content.svelte`
- `model-selector-input.svelte`
- `model-selector-list.svelte`
- `model-selector-item.svelte`
- `model-selector-empty.svelte`
- `model-selector-group.svelte`
- `model-selector-separator.svelte`
- `model-selector-name.svelte`
- `index.ts`

**DROP** (4, per research D1):
- `model-selector-logo.svelte` — provider logos, unused
- `model-selector-logo-group.svelte` — provider logo group, unused
- `model-selector-shortcut.svelte` — keyboard shortcut hint (⌘K), unused

### confirmation (9 files → all 9 KEEP)

All files kept per research D1. The `runed` `watch()` usage in
`confirmation.svelte` and `confirmation-context.svelte.ts` will be replaced
with native Svelte 5 runes during implementation (research D2).

### tool (6 files → structural reference only)

All 6 files staged for reference. Key decisions per research:
- **DROP** donor `tool-context.svelte.ts` auto-open behavior — our rows are
  collapsed-by-default per spec FR-004, driven by user intent (research D2)
- **SKIP** donor `code.json` dependency — our `ToolResultBody.svelte` handles
  output rendering; the donor code block (Shiki-themed) is not adopted (research D4)

---

Source: `https://svelte-ai-elements.vercel.app/r/{model-selector,confirmation,tool}.json`
Extracted: 2026-08-21
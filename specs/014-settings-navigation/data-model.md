# Phase 1 Data Model: Settings Page Navigation

**Feature**: 014-settings-navigation | **Date**: 2026-08-28

No database entities are introduced. The feature's "data" is a static in-code section registry plus small runtime UI state. Existing storage seams (`StorageDriver`, repositories, `settings` table) are untouched.

## Entities

### SectionEntry (static registry record)

One navigable section of `/settings`. Defined in `src/lib/settings/sections.ts`.

| Field | Type | Rules |
|-------|------|-------|
| `id` | `string` | Stable anchor slug, matches the section's DOM `id`. Unique; lowercase kebab. Enum: `providers`, `mcp`, `learner-profile`, `expound-instructions`, `lab-prompt`, `quiz-prompt`, `data`, `sandbox-db`. |
| `label` | `string` | Mirrors the real `h2` heading text verbatim ("Providers", "MCP Servers", "Learner profile", "Expound Instructions", "Lab generation prompt", "Quiz generation prompt", "Data", "Sandbox DB"). Never paraphrased. |
| `aliases` | `string[]` | Lowercase synonyms users might type (e.g. `data` → `["backup", "restore", "export", "import"]`; `sandbox-db` → `["sandbox", "sqlite"]`). May be empty. Duplicates across the registry are allowed in the index but each entry's own list is unique. |
| `cap` | `ServerCap \| null` | Capability gate for conditional sections (`'sandbox-db'` for Sandbox DB; `null` = always present). Reuses the existing `ServerCap` type from `packages/shared/src/protocol.ts` — no new capability vocabulary. |
| `order` | number (implicit) | Position = array index in `SETTINGS_SECTIONS`; must equal DOM order on the page. |

**Validation rules** (unit-tested): unique `id`s; `label`s exactly match the rendered headings; `aliases` lowercase and unique within an entry; conditional `cap` values are valid `ServerCap`s.

**Maintenance rule** (FR-011): adding/renaming/removing a section updates this registry and the matching wrapper/`id` in the route file in the same change.

### Derived: VisibleSections

`visibleSections(SETTINGS_SECTIONS, serverStatus.caps)` → the subset whose `cap` is `null` or currently advertised. Re-computed reactively from `serverStatus` (the existing `src/lib/services/status.svelte.ts` runes singleton). Drives the rail, search item list, and mobile sheet — so capability changes (boot, sandbox enable/disable) update all three affordances together.

## Runtime State (all ephemeral, in-memory; nothing persisted)

### activeSectionId: `string | null`

The section currently in view per the scroll-spy.

- Set by the IntersectionObserver reducer while the user scrolls (highlight + hash `replaceState`, no history entry).
- Set optimistically by an explicit jump (target becomes active immediately, then spy confirmations refine it).
- `null` when no section top has crossed the band (e.g. above the first section).

### Hash sync state machine

Guards the "push on explicit jump only" discipline. States and transitions:

```text
        ┌────────────────────────────────────────────────────────┐
        │ idle                                                   │
        │  ├─ user jump(target)     → smooth-scroll; pushState;  │
        │  │                          state = jumping(target)   │
        │  └─ hashchange(id)        → treat as back/forward or   │
        │                             manual edit: land(id)      │
        └────────────────────────────────────────────────────────┘
jumping(target)                       (entered only by explicit jumps)
  ├─ scroll settles at target (spy reports target / timer)
  │     → replace hash is already correct; state = idle
  ├─ another jump(target2)            → retarget (no extra push beyond
  │                                      duplicate rule); state = jumping(target2)
  └─ spy reports other section while scrolling
        → highlight updates but hash stays at target; NO replaceState
          until settled (prevents hash flicker mid-flight)
```

**Rules table** (normative; mirrored in contracts/settings-navigation.md):

| Event | Scroll effect | History effect | Hash effect |
|-------|---------------|----------------|-------------|
| Rail click / search hit / sheet pick (target ≠ current section) | smooth scroll to target top | +1 entry (`pushState`) | `#target` |
| Same as above but already settled at target | none | none (duplicate suppressed) | unchanged |
| Scroll-spy detects new section at rest | — | none (`replaceState` only) | `#section` |
| Back/Forward (`hashchange` with history traversal) | deterministic land at target top (overrides browser offset) | traversal (browser-managed) | already `#id` |
| Deep link `/settings#id` (load, id present) | instant land (no animation), rAF-retried | — | unchanged |
| Deep link with absent/unknown id (`#sandbox-db` when capability off) | none | — | unchanged (graceful) |
| Manual hash edit in address bar | same as back/forward land | — | — |

### Search field state (inside SettingsSearch)

`query: string` (cmdk-managed), derived `matches: SectionEntry[]` via the custom alias filter, `open list` boolean (cmdk-managed). All ephemeral; cleared/reset on route leave. cmd-K only focuses the field — no global palette state exists.

### Mobile sheet state (inside MobileSectionJump)

`open: boolean` (bits-ui Sheet bindable). Selecting an entry closes the sheet, then jumps. Dismissal mutates nothing else.

## State transitions of the page itself

None — FR-001/FR-016: all eight section components stay mounted for the life of the route. Navigation changes only scroll position, highlight, hash, and the transient flash/sheet state. In-progress edits inside sections (e.g. provider forms) are never discarded by navigation.

## Relationships

- `SETTINGS_SECTIONS` (1) → (8) `SectionEntry`; array order = page order = rail order = sheet order.
- `SectionEntry.id` → DOM element `id` on the section wrapper (route file / `ProviderConfig` shell).
- `visibleSections` consumes `serverStatus.caps` (existing singleton) — read-only.
- Nothing in this feature reads or writes the database.

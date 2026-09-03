# Data Model: Diátaxis Documentation Website

No runtime data. The model below is the **content model** that governs how pages are filed and validated.

## Entities

### Section

A top-level navigation group.

- **kind**: one of `tutorial` | `how-to` | `reference` | `explanation` | `dev-notes` | `history`
- **directory**: one `docs/` child directory, 1:1 with kind (FR-001, FR-003)
- **intent_description**: short text shown on the landing page / section entry (FR-006)
- Rules: the four Diátaxis kinds are the quadrants; `dev-notes` and `history` are dedicated non-Diátaxis shelves and MUST NOT be labeled as quadrants (FR-003).

### Page

A single documentation document (`.qmd` or `.md`).

- **file**: path under `docs/`
- **section**: exactly one Section (FR-002) — enforced by directory location
- **orientation**: `learning` | `task` | `information` | `understanding` | `chronicle`, derived from section
- **aliases**: list of previous public URLs this page must answer to (may be empty for new pages)
- **split_from**: optional reference to the pre-cutover page this content was split out of
- Validation rules:
  - A page whose body substantially interleaves two orientations MUST be split (FR-004); minor mixing is tolerated (owner ruling, ~3/4 strict).
  - Every page existing before cutover that kept ≥1 paragraph and moved MUST carry an alias for its old URL.
  - Zero pages outside the six section directories (SC-001).

### Alias (redirect)

- **old_url**: previous public path (e.g., `/guide/providers.html` style as rendered pre-cutover)
- **target**: the Page now holding that content
- Rule: aliases exist only for previously published URLs; new pages need none (R3).

## State transitions

Single cutover, no long-lived states:

1. `unfiled (book tree)` → `filed (website tree)` — every page moves exactly once, same change as the `_quarto.yml` flip.
2. `filed` → `split` — a mixed page divides into 2+ Pages, each re-filed by orientation; originals are removed, aliases updated to the split targets.
3. Post-cutover steady state: new pages are born `filed` (placement is an authoring decision — see edge cases in spec).

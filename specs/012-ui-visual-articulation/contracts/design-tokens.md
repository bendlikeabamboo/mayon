# Contract: Design Tokens & Surface Roles

**Scope**: The application's visual vocabulary for feature `012-ui-visual-articulation`. This is the authoritative reference for token names, roles, and usage rules; consumers (components) and reviewers treat deviations from this file as defects. Owner file on disk: `src/app.css` (`:root` and `.dark` blocks + `@theme inline` mappings).

## 1. Accent system (GP-5)

| Token | Light (:root) | Dark (.dark) | Role |
|---|---|---|---|
| `--primary` | warm amber/terracotta solid — hue anchored to the existing `--highlight #a54d27` family, button-suitable lightness | same perceptual hue family, dark-tuned lightness | actionable emphasis fills: primary buttons, active nav item, launcher chips, selected/current states |
| `--primary-foreground` | readable-on-accent text at GP-1 softness | dark variant | text/icon color over primary |
| `--ring` | accent-family focus ring tone | dark variant | ALL focus-visible indicators |

**Rules**
1. Exactly these three slots constitute "the accent". No other token may introduce a competing emphasis hue.
2. Existing status greens (emerald pills in Db/ServerStatus readouts) remain **status-only** and never share accent slots.
3. Decoration/illustration MUST NOT use `--primary`.
4. Dark-theme accent value differs from light only where luminance demands it; perceptual identity must survive a side-by-side squint test (SC-1 walkthrough criterion).
5. Known legitimate ripples to review rather than suppress: user-message bubble (`dark:bg-primary`), tree current-node fill, suggested-choice pill emphasis.

## 2. Surface ladder (GP-1)

Three roles per theme. Adjacent levels separate by hairline edge first, gentle shadow second, small luminance step last.

| Level | Token slot | Applies to | Treatment |
|---|---|---|---|
| L0 canvas | `--background` (+/-foreground) | page backdrop under `<main>` | flat, no border/shadow |
| L1 panel | `--sidebar*` family; header regions | sidebar, structural bands | quietest in light theme (≤ canvas emphasis); **darkest** region in dark theme; hairline separator borders only |
| L2 raised card | `--card` + `--card-foreground` | interactive containers: RowCard list rows, composer instrument card, resume card, brief/status popovers | hairline `border-border` + soft shadow recipe + radius scale |

**Elevation recipes** (component-layer classes or Tailwind `@utility`, exact names fixed here):
- `surface-card` → `rounded-lg border border-border bg-card shadow-[--shadow-card]`
- `shadow-card` custom property = single soft diffuse shadow tuned per theme (subtle by design; visible-but-quiet). No stacked multi-layer dramatic shadows.

**Rules**
1. Every themed region maps to exactly one level (FR-6); mixed ad-hoc `bg-*` outside these slots requires justification in review.
2. Adjacent-level OKLCH lightness delta stays within ~2–3 percentage points unless an exception is documented here (none planned).
3. Cards always carry border **and** shadow together (FR-7).

## 3. Typography rules (GP-2)

- One family everywhere: current `'Bpmf Huninn', Fira Sans, sans-serif` stacks (`--font-sans`; `--font-serif` aliases it).
- Hierarchy tools allowed: size, weight, `text-muted-foreground` tone within existing envelope, spacing.
- Prohibited: any serif introduction; contrast increases as depth substitutes.

## 4. Motion & loading

| Rule | Value |
|---|---|
| Route entry stagger | per-child delay ≈ 40–60 ms, total ≤ 500 ms (FR-22) |
| Hover feedback | color/shadow transitions ≤ 200 ms (existing idiom) |
| Caret rotation | transform transition, snapping under reduce-motion |
| Reduce-motion | every added animation suppressed via extended `prefers-reduced-motion` block in `app.css` + `motion-reduce:` utilities (SC-9) |
| Skeletons | appear ONLY where load measured > ~300 ms; none shipped initially (FR-23/A-6) |

## 5. Status roles (GP-4)

Aggregate indicator color mapping (exhaustive):

| Aggregated state | Presentation |
|---|---|
| db ready + server connected | status green dot (unchanged semantics) |
| self-check pending/warn | amber variant |
| error / unreachable | red variant |
| server off / unknown at boot | neutral gray, still visible + popover explains unknowns |

Detail popover contents = union of all facts previously shown anywhere in the two legacy rows (runtime label, version string, capability list, restoring flag, self-check result).

## Change policy

Any addition/removal/semantic change of tokens here must update this contract file in the same PR, so downstream plan/tasks/review artifacts stay truthful.

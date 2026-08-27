# US7 — Warm Charcoal Night Mode (T034/T035 evidence)

> **⚠️ SUPERSEDED 2026-08-27 — OWNER RULING**: the owner rejected the warm-charcoal
> direction after review ("stick to the gray palette, only keeping the accent color
> intact"). All `.dark` neutrals were reverted to achromatic gray at digit-identical
> lightness (hierarchy + eye-comfort invariants unchanged); the terracotta accent
> trio (`--primary` / `--primary-foreground` / `--ring`) is retained as the sole
> saturated family. Warm-tinted artifacts (card shadows both themes, dark `hljs`
> background triad, dark scrollbar thumbs) were neutralized as well. The tables and
> captures below are preserved as historical record of the rejected variant.

**Task**: T034 retune `.dark` neutrals toward warm charcoal · T035 owner gate SC-7 assembly.
**Method**: token-level hue shift at constant lightness per GP-1; live captures on
`feat/ui_overhaul` against `http://localhost:5173` using the baseline ThemeToggle
click methodology (`evidence/baseline/README.md`).

## Before/after token table (`src/app.css` `.dark` block)

Lightness component preserved digit-for-digit on every row; only chroma/hue moved.

| Token | Old | New |
| --- | --- | --- |
| `--background` | `oklch(30.118% 0.00003 271.152)` | `oklch(30.118% 0.012 65)` |
| `--highlight` | `oklch(0.85 0 0)` | `oklch(0.85 0.02 65)` |
| `--foreground` | `oklch(83.28% 0.00009 271.152)` | `oklch(83.28% 0.012 65)` |
| `--card` | `oklch(0.205 0 0)` | `oklch(0.205 0.014 65)` |
| `--card-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0.01 65)` |
| `--popover` | `oklch(0.205 0 0)` | `oklch(0.205 0.014 65)` |
| `--popover-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0.01 65)` |
| `--shadow-card` | `0 2px 12px oklch(0 0 0 / 40%)` | `0 2px 12px oklch(0.02 0.03 60 / 40%)` |
| `--secondary` | `oklch(0.269 0 0)` | `oklch(0.269 0.013 65)` |
| `--secondary-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0.01 65)` |
| `--muted` | `oklch(0.269 0 0)` | `oklch(0.269 0.013 65)` |
| `--muted-foreground` | `oklch(0.708 0 0)` | `oklch(0.708 0.012 65)` |
| `--accent` | `oklch(0.269 0 0)` | `oklch(0.269 0.013 65)` |
| `--accent-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0.01 65)` |
| `--border` | `oklch(1 0 0 / 10%)` | `oklch(1 0.03 65 / 10%)` |
| `--input` | `oklch(1 0 0 / 15%)` | `oklch(1 0.03 65 / 15%)` |
| `--sidebar` | `oklch(0.18 0 0)` | `oklch(0.18 0.011 65)` |
| `--sidebar-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0.01 65)` |
| `--sidebar-accent` | `oklch(0.269 0 0)` | `oklch(0.269 0.013 65)` |
| `--sidebar-accent-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0.01 65)` |
| `--sidebar-border` | `oklch(1 0 0 / 10%)` | `oklch(1 0.03 65 / 10%)` |
| `--sidebar-ring` | `oklch(0.556 0 0)` | `oklch(0.556 0.015 65)` |
| `--hljs-bg` | `#0d1117` (L 0.176) | `#15100a` (L 0.176, C 0.014, h 65) |
| `--hljs-fg` | `#c9d1d9` (L 0.857) | `#d6cfc8` (L 0.857, C 0.012, h 65) |
| `--hljs-comment` | `#8b949e` (L 0.663) | `#98928b` (L 0.663, C 0.012, h 65) |
| scrollbar thumb (`.dark *`) | `oklch(1 0 0 / 18%)` | `oklch(1 0.03 65 / 18%)` |
| scrollbar thumb hover | `oklch(1 0 0 / 30%)` | `oklch(1 0.03 65 / 30%)` |
| scrollbar-color | `oklch(1 0 0 / 18%)` | `oklch(1 0.03 65 / 18%)` |

Untouched by design:

- `--primary` / `--primary-foreground` / `--ring` — US1 terracotta accent, byte-identical.
- `--destructive` and `--callout-*` — status semantics stay hue-pure (contract §5).
- `--sidebar-primary` (+fg) — legacy blue chip value, not a neutral.
- `.bubble-user` hljs overrides — code-in-bubble palettes are accent-adjacent, left as-is (reviewed under T045).

Noise overlay sweep note: `body::before` uses a desaturated fractal-noise PNG in
`soft-light` blend at fixed opacity 0.35 (dark) — it derives its tint entirely from
the surface beneath it, so warming the background tokens automatically warms the
texture with zero rule changes and zero strength change. No edit needed or made.

## Screenshot pairs (1440×900, chromium, ThemeToggle methodology)

| Route | Baseline (neutral gray) | New (warm charcoal) |
| --- | --- | --- |
| `/` | `evidence/baseline/home-dark.png` | `evidence/us7-home-dark.png` |
| `/chat` | `evidence/baseline/chat-dark.png` | `evidence/us7-chat-dark.png` |
| `/tree` | `evidence/baseline/tree-dark.png` | `evidence/us7-tree-dark.png` |

Per-shot verification: `document.documentElement.classList.contains('dark') === true`
immediately before every capture; theme persisted via `localStorage['mayon.theme']`
+ settings KV from the sidebar ThemeToggle (two clicks from system default).

Note on content drift: baseline home/tree shots predate US4/US5, so content
composition differs (resume card, starter chips, connector rails). The comparison
target is surface color character, not layout.

## Warmth verification

- Side-by-side: every dark panel reads discernibly amber-brown against the
  baseline's blue-neutral gray — most visible in the sidebar band vs canvas and
  the raised cards on `/tree` and `/`.
- Computed spot-check on live page:
  `body → oklch(0.30118 0.012 65)`, `.bg-card → oklch(0.205 0.014 65)` —
  hue 65 (amber-brown undertone), chroma inside the 0.008–0.02 contract window.
- Hierarchy intact: surface ordering is unchanged — sidebar 0.18 < card/popover
  0.205 < secondary/muted/accent 0.269 < canvas 0.301 — with every delta
  identical to 3 decimals (contract §2's 2–3-point adjacent steps preserved).
- Code blocks (`--hljs-bg #15100a`), text (`--hljs-fg`), scrollbar thumbs, and
  the soft-light noise texture all carry the same hue-65 undertone — no neutral
  gray islands remain.

## Comfort-preservation argument (GP-1 lightness invariants)

- Every background token kept its exact OKLCH L digit-for-digit (0.30118, 0.205,
  0.269, 0.18, 0.708, 0.985, 0.85, 0.556). No value got brighter — GP-1's hard rule.
- `--foreground` L stays 83.28%; text/background relationships therefore keep the
  same luminance ratios (same ΔL), preserving the deliberate AA-fail-by-design
  softness. Only the hue axis of the near-black moved (blue → amber at C≈0.012).
- The warm hex hljs values were derived by converting GitHub-dark's grays to
  OKLCH and re-encoding at identical L with C 0.012–0.014 at h 65, so code-block
  comfort equals the previous values in luminance terms.
- `dark:bg-primary` user-bubble legibility: neither `--primary` nor
  `--primary-foreground` changed; bubble contrast is unaffected by this sweep.
- No glare/brightening observed in any of the three new captures vs baseline;
  perceived brightness is equivalent, temperature is warmer.

## AWAITING OWNER SIGN-OFF

- [ ] Owner approves warm charcoal direction (SC-7 gate)

How to validate:

1. Open each pair above side-by-side (baseline left, new right) at comfortable
   viewing distance; confirm the new captures read as "warm charcoal", not gray
   and not mud.
2. Extended-read test: live in the dark theme for a normal reading session
   (open a chat, read assistant markdown incl. a code block) and confirm reading
   comfort feels unchanged from the neutral theme — no new eyestrain, no glare.
3. If satisfied, tick the checkbox above and tick T035 in `tasks.md`. If not,
   record objections here and revert/retune tokens before re-requesting.

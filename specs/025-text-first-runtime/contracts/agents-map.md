# Contract: The Agent's Map

**Audience**: implementing agents and new contributors. One page, FR-006/FR-007/FR-008/FR-009
of [spec.md](../spec.md). Home: `docs/reference/agent-map.qmd` (Quarto-rendered), linked
from the docs sidebar, `docs/index.qmd`, and `AGENTS.md` → "Where to look".

## Required sections (all four, one page)

1. **Where features live** — the placement policy: if a feature's logic can live behind
   the repository/driver boundary without much effort, it **must** (decisions and
   consequences behind the seam; pixel/animation behavior stays in the UI). Name the
   seam documents as authoritative: `docs/reference/seams.qmd`,
   `docs/explanation/architecture.qmd`. Call out the DOM-married straddlers (streaming
   render, expound offsets, selection mapping) and how the policy splits them, so
   placement stops being relitigated.
2. **How features are proven** — the default proving path: seed state through `repos`
   via the PGlite test harness (`useFileTestDb()`), assert on text outcomes, no browser.
   Point at one exemplar logic-layer test as the pattern to copy (e.g. the chat context
   assembly test). State the harness is formalized policy, not new tooling.
3. **Where the browser is allowed to matter** — browser coverage only for what logic
   cannot reach (UI-only wiring/behavior); visual checks are camera-style
   (screenshot + review), rare; the browser is demoted from courtroom to camera, not
   eliminated. RC-time live-stack checks go through the existing doors: `/api/health`
   and `/api/db/query`.
4. **Enforcement & escape hatches** — where the boundary rules live
   (`eslint.config.js`, the direction-check script), what a violation report looks
   like, and that exceptions require a reviewed, justified entry in the hatch block.

## Style constraints

- **Reference, don't duplicate**: the map links to seams/architecture docs and the
  enforcement config for normative detail; it never restates rule lists or façade
  exports inline (anti-drift requirement, FR-006 acceptance 4).
- One page; no narrative history (that belongs to `docs/history/`).
- Tone: direct, neutral (project docs-tone correction applies — no snark).

## Acceptance (from the spec)

- An agent with no other Mayon context, given only this page, plans a sampled feature
  correctly: logic behind the seam, text-first proof, browser only for UI-only
  behavior (SC-003).
- Map stays true when rules change: references, not copies.

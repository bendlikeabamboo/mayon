# Contract: 0.10.0 release record

Scope: `package.json`, `server/package.json`, `packages/shared/package.json`,
`CHANGELOG.md`. Normative for tasks; mirrors CI's `verify-version`
(`docker-publish.yml:59-74`) and AGENTS.md "Releasing & versioning".

## Manifests

- All three `version` fields read exactly `0.10.0` (the tag base). Nothing else in the
  manifests changes.

## CHANGELOG structure

```markdown
# Changelog
...(preamble unchanged)...

## [Unreleased]

## [0.10.0] - 2026-11-10

### Added

- (027 back-propagation tool) ...
- (028 mermaid containment + repair) ...
- (029 micro-thoughts / per-segment reasoning) ...
- (030 image generation) ...
- (031 split test suites + per-shard e2e) ...

### Fixed

- (fold: #69 provider key leak / SSRF — from current ## [Unreleased]) ...
- (fold: #70 assistant image replies / finalize paths — from current ## [Unreleased]) ...
- (PR #77 image e2e engine seam) ...

## [0.9.0] - 2026-11-03
...(unchanged below)...
```

Rules:

1. `## [Unreleased]` keeps its header and has **zero** entries (its two entries move
   into `## [0.10.0]` → `### Fixed`).
2. Entry inventory and ordering are normative: research.md **D9** (five Added bullets,
   three Fixed bullets; no vite/rolldown entry — D3).
3. Style: one bolded lead phrase per bullet, Keep-a-Changelog categories, wrapped like
   the `## [0.9.0]` section; file must pass `prettier --check CHANGELOG.md`.
4. Date is the RC-preparation date `2026-11-10` (D1).
5. Accumulation policy (D2): until a stable `v0.10.0` tag exists, later fixes append
   into this section; after the tag, new work goes under `## [Unreleased]`.

## Prohibitions (release safety)

- No `git tag`, no tag push, no `gh release`, no GitHub Release body edits from this
  feature. Tagging `v0.10.0-rc1` (and later promotion) is the maintainer's action per
  AGENTS.md's RC cycle.

# Dependency vuln bumps (medium+high) → ship 0.8.3

## Context

86 Dependabot alerts on `bendlikeabamboo/mayon`; after the v0.8.2 hardening, **5 packages
remain in `open` state** (low-severity alerts — `@sveltejs/kit` major-3, `katex` — are out of
scope). Goal: bump all open medium/high packages, validate, and ship **0.8.3 via the standard
RC cycle** (user decision). Strategy follows the v0.8.2 precedent: bump direct deps, force
transitives via `pnpm.overrides` (root `package.json` already carries the v0.8.2 override set).

| Alert(s) | Severity | Package | Current → Target | Mechanism |
|---|---|---|---|---|
| #86 | high | undici | 7.30.0 → 7.30.1 | raise existing override `^7.29.1` → `^7.30.1` |
| #81 | high | zod | 4.4.3 → 4.6.6 | bump direct root dep `^4.4.3` → `^4.6.6` (7 files import zod) |
| #66 | high | source-map-js | 1.2.1 → 1.2.2 | add override `^1.2.2` (dependents: `@tailwindcss/node`, `css-tree`, `postcss@8.5.28`; 1.2.2 already in tree via postcss@8.5.31) |
| #74, #73 | medium | @vitest/mocker | 4.1.11 → 4.1.12 | bump `vitest` devDep `^4.1.11` → `^4.1.12` (root + server) |
| #67 | medium | postcss-selector-parser | 7.1.4 → 7.1.6 | add override `^7.1.6` (sole dependent: `svelte-eslint-parser`, dev-only) |

## Tasks

1. **Edit root `package.json`**
   - `dependencies.zod`: `^4.4.3` → `^4.6.6`
   - `devDependencies.vitest`: `^4.1.11` → `^4.1.12`
   - `pnpm.overrides`: `undici` → `^7.30.1`; add `"source-map-js": "^1.2.2"`;
     add `"postcss-selector-parser": "^7.1.6"`
2. **Edit `server/package.json`**: `devDependencies.vitest` `^4.1.11` → `^4.1.12`
3. **Regen lockfile**: `pnpm install`, then verify in `pnpm-lock.yaml`:
   `undici@7.30.1`, `zod@4.6.6`, `vitest@4.1.12` + `@vitest/mocker@4.1.12`,
   `postcss-selector-parser@7.1.6`, and **no** `source-map-js@1.2.1` remaining.
4. `pnpm --filter @mayon/shared build`
5. **Validate**: `pnpm check` && `pnpm lint` && `pnpm test` &&
   `pnpm --filter @mayon/server test` && `pnpm build`
   - zod is the risk point (two minor versions of a validation-critical lib); if anything
     fails, triage zod first.
6. Deps changed → `pnpm dev:build` and quick dev-stack smoke (boot, one chat round-trip).
7. Commit the bumps to `main` (fix commit). Do **not** sweep the untracked
   `ideas/011-plug-in-system/` into it — it belongs to other work.
8. **Release prep**: `"version": "0.8.3"` in all three `package.json`s; add
   `## [0.8.3] - YYYY-MM-DD` section to `CHANGELOG.md` (keep fresh `## [Unreleased]`
   above it — note the security bumps). Commit.
9. **RC**: `git tag v0.8.3-rc1 && git push origin v0.8.3-rc1`. CI publishes
   `:0.8.3-rc1` + `:rc` and a prerelease GitHub Release.
10. **Populate the RC release body** (mandatory): paste the `## [0.8.3]` CHANGELOG section
    via `gh release edit v0.8.3-rc1 --notes ...` — join each paragraph/list item into one
    line (no hard-wrap); preserve code fences/list structure.
11. **Verify RC**: RCs are `make_latest: false`, so install explicitly with
    `MAYON_VERSION=0.8.3-rc1 ~/.mayon/install.sh install`. Smoke test; if fixes are needed,
    land on `main`, tag `v0.8.3-rc2` (no file edits), re-populate its body.
12. **Promote**: `git tag v0.8.3 && git push origin v0.8.3` (no file edits). CI tags
    `:0.8.3` + `:latest`. Populate the stable release body same as step 10.
13. **Confirm alerts clear**: after Dependabot rescans `main`,
    `gh api repos/bendlikeabamboo/mayon/dependabot/alerts --jq '.[] | select(.state=="open") | [.number, .dependency.package.name]'`
    should no longer list 86, 81, 74, 73, 67, 66.

## Risks / notes

- **zod minor jump**: watch for behavior tweaks in schema parsing across 7 importing files;
  the vitest suites + `svelte-check` are the gate.
- **Overrides force all dependents**: both transitives get patch-level bumps that their
  dependents' ranges already permit; `source-map-js@1.2.2` already coexists in the tree — low risk.
- **CI release contract**: tag base version must equal all three `package.json` versions and
  `CHANGELOG.md` must contain `## [0.8.3]` or `verify-version` fails.
- Known `install.sh` sentinel bug (CI sed clobbers `@MAYON_INSTALLER_VERSION@` in the
  self-test) exists but does not block this flow; do not rename/remove the marker.

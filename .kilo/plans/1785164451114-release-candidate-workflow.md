# Release Candidate (RC) workflow

Make a release `vX.Y.Z-rcN` tag act as a canary that exercises the *entire*
release pipeline (build, push, tag, bake, attach) without ever disturbing the
stable channel. After the RC is accepted, promoting to the real release is a
**tag-only operation — zero file edits.**

## Decisions (confirmed with user)

- **package.json versions = base `X.Y.Z`** across `rc1..rcN` AND into the final
  release. No per-RC bump, no promotion bump. The RC number lives only in the
  git tag.
- **Tag scheme:** RC = `v0.2.0-rc1`, `v0.2.0-rc2`, … (valid SemVer prerelease;
  already matches the existing `v*` trigger). Final = `v0.2.0` (unchanged).
- **Image tags:** RC publishes `:0.2.0-rc1` (exact) + `:rc` (floating latest
  candidate). **Never** `:latest`, never `:0.2.0`. Final publishes `:0.2.0` +
  `:latest` (unchanged).
- **GitHub Release for RC** = `prerelease: true`, `make_latest: false`, with a
  baked/functional `install.sh` + `docker-compose.yml` attached (full end-to-end
  canary).
- **`install.sh` stays generic** — the only change is widening `is_semver`. All
  RC-vs-release intelligence lives in CI keyed on the tag. No installer edit at
  promotion (the user's hard constraint).
- **CHANGELOG:** `## [0.2.0]` section must already exist before tagging `rc1`
  (required by `verify-version` for both RC and final).
- **Single workflow file:** fold RC branching into the existing
  `docker-publish.yml` so the RC runs the *identical* pipeline as a release.

## Files touched

- `.github/workflows/docker-publish.yml` — main change.
- `install.sh` — one-line `is_semver` widening.
- `AGENTS.md` — "Releasing & versioning" + "Release contract" sections.
- `CHANGELOG.md` — entry for this change (ships with next release).

No app source, DB, schema, or build-order changes. `deploy-pages.yml` triggers
only on `main` branch push, so RC tags do not affect it.

---

## Implementation steps

### 1. `install.sh` — widen `is_semver`

`install.sh:44-46`, change:

```bash
is_semver() {
	[[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-rc[0-9]+)?$ ]]
}
```

This is the **only** installer change. Consequences (all already data-driven,
no further edits):
- `0.2.0-rc1` is now a valid pin → `ensure_version_pin` writes
  `MAYON_VERSION=0.2.0-rc1` into `.env`, pulling the RC image.
- `compose_url_for` / `installer_url_for` resolve to
  `raw/.../v0.2.0-rc1/docker-compose.yml` and
  `releases/download/v0.2.0-rc1/install.sh`.
- After promotion, the **same code** with `0.2.0` resolves `v0.2.0`. No edit.

The floating `:rc` tag is NEVER used by the installer (it always pins the exact
baked version); `:rc` is only for manual `MAYON_VERSION=rc` test runs.

### 2. `.github/workflows/docker-publish.yml`

#### 2a. New `classify` job (runs first, outputs feed everything else)

Parse `${GITHUB_REF_NAME}` (e.g. `v0.2.0-rc1` or `v0.2.0`):

```yaml
classify:
  runs-on: ubuntu-latest
  outputs:
    version: ${{ steps.c.outputs.version }}        # full: 0.2.0-rc1 or 0.2.0
    base_version: ${{ steps.c.outputs.base_version }} # 0.2.0
    is_rc: ${{ steps.c.outputs.is_rc }}            # 'true' / 'false'
  steps:
    - id: c
      shell: bash
      run: |
        set -euo pipefail
        ref="${GITHUB_REF_NAME#v}"
        base="${ref%%-rc*}"
        if [[ "$ref" =~ ^[0-9]+\.[0-9]+\.[0-9]+-rc[0-9]+$ ]]; then
          echo "is_rc=true" >> "$GITHUB_OUTPUT"
        else
          echo "is_rc=false" >> "$GITHUB_OUTPUT"
        fi
        echo "version=$ref"       >> "$GITHUB_OUTPUT"
        echo "base_version=$base" >> "$GITHUB_OUTPUT"
```

(`build-and-push` and `release-assets` both add `classify` to their `needs:`.)

#### 2b. `verify-version` — relax + base-match

Replace the strict regex + exact-match block (`docker-publish.yml:29-53`) with:

```yaml
verify-version:
  needs: [classify]
  runs-on: ubuntu-latest
  outputs:
    version: ${{ needs.classify.outputs.version }}
  steps:
    - uses: actions/checkout@v4
    - name: Verify release contract
      shell: bash
      env:
        VERSION: ${{ needs.classify.outputs.version }}
        BASE: ${{ needs.classify.outputs.base_version }}
        IS_RC: ${{ needs.classify.outputs.is_rc }}
      run: |
        set -euo pipefail
        # Accept X.Y.Z or X.Y.Z-rcN only.
        if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-rc[0-9]+)?$ ]]; then
          echo "::error::Tag '$VERSION' is not 'X.Y.Z' or 'X.Y.Z-rcN'"
          exit 1
        fi
        # All three package.json versions must equal the BASE (target release).
        for f in package.json server/package.json packages/shared/package.json; do
          v=$(jq -r .version "$f")
          if [ "$v" != "$BASE" ]; then
            echo "::error::$f version '$v' != base '$BASE'"
            exit 1
          fi
        done
        # CHANGELOG must have the BASE version's section (RC and final alike).
        if ! grep -Eq "^## \[${BASE//./\\.}\]" CHANGELOG.md; then
          echo "::error::CHANGELOG.md has no '## [${BASE}]' section"
          exit 1
        fi
        echo "Release contract satisfied for v${VERSION} (base ${BASE}, rc=${IS_RC})."
```

Note the output `version` now comes from `classify` (full version, e.g.
`0.2.0-rc1`), which `release-assets` already consumes via
`needs.verify-version.outputs.version`.

#### 2c. `build-and-push` — gate floating tag on `is_rc`

Change `needs:` to `[ci, classify, verify-version]`. Replace the `metadata-action`
`tags:` block (`docker-publish.yml:80-82`) with conditional `enable=` lines:

```yaml
      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ${{ matrix.image }}
          tags: |
            type=semver,pattern={{version}}
            type=raw,value=latest,enable=${{ needs.classify.outputs.is_rc == 'false' }}
            type=raw,value=rc,enable=${{ needs.classify.outputs.is_rc == 'true' }}
```

Result:
- RC `v0.2.0-rc1` → `:0.2.0-rc1` + `:rc`. (`type=semver,pattern={{version}}`
  yields the full prerelease string for the git tag.)
- Final `v0.2.0` → `:0.2.0` + `:latest` (unchanged behavior).

GitHub Actions evaluates `${{ }}` in `with:` block scalars before the action
runs, so `enable=true`/`enable=false` reach `metadata-action` correctly. (Fallback
if this proves flaky: build the `tags:` string in a prior `run:` step and pass via
a step output / `$GITHUB_ENV`.)

#### 2d. `release-assets` — prerelease for RC

Change `needs:` to `[ci, classify, verify-version, build-and-push]`. Make the
`softprops/action-gh-release` step conditional (`docker-publish.yml:109-116`):

```yaml
      - uses: softprops/action-gh-release@v2
        with:
          name: ${{ needs.classify.outputs.is_rc == 'true' && format('Mayon {0} (Release Candidate)', needs.verify-version.outputs.version) || format('Mayon {0}', needs.verify-version.outputs.version) }}
          prerelease: ${{ needs.classify.outputs.is_rc == 'true' }}
          make_latest: ${{ needs.classify.outputs.is_rc == 'false' }}
          files: |
            out/install.sh
            out/docker-compose.yml
          generate_release_notes: true
          fail_on_unmatched_files: true
```

`make_latest: false` for RC is what guarantees `releases/latest/download/install.sh`
keeps pointing at the last stable release. The bake step
(`docker-publish.yml:100-108`) is unchanged — it now bakes `0.2.0-rc1` for an RC,
and the grep assertion `grep -q "MAYON_INSTALLER_VERSION=\"${VERSION}\""` still
holds because `is_semver` now accepts rc.

### 3. `AGENTS.md` — document the RC flow

In **"Releasing & versioning"**:
- Add an **RC cycle** subsection: bump all three `package.json` to base `X.Y.Z`;
  ensure `## [X.Y.Z]` exists in CHANGELOG; commit; tag `vX.Y.Z-rcN`; CI publishes
  `:X.Y.Z-rcN` + `:rc` (no `:latest`) and a **prerelease** GitHub Release with a
  functional baked `install.sh` + `docker-compose.yml`.
- Add the **promote** step: once an RC is accepted, just `git tag vX.Y.Z && git
  push origin vX.Y.Z` — package.json is already `X.Y.Z` and CHANGELOG already has
  the section, so **no file edits** are required.

In **"Release contract"**:
- Note `verify-version` now accepts `X.Y.Z-rcN` and compares package.json against
  the tag's **base** version, and requires the base version's CHANGELOG section
  for both RC and final.

Add to **"Release assets"**: for RC, the GitHub Release is marked `prerelease`
with `make_latest: false`, so it never becomes the `latest` release.

### 4. `CHANGELOG.md`

Add an entry under `## [Unreleased]` (or fold into the next release section)
describing the RC workflow addition. This ships with the next release.

---

## What the RC canary exercises (that dev cannot)

1. `verify-version` base-version + CHANGELOG gate (the "version mismatch check").
2. Both GHCR images build & push with correct tags and **no** `:latest`.
3. `:latest` is NOT overwritten — `docker compose pull` (default) still returns
   the last stable image.
4. `releases/latest/download/install.sh` still resolves to stable (RC is
   `make_latest: false`).
5. `install.sh` bake (sed substitution + grep assertion) succeeds for an rc
   version.
6. Baked RC installer is functional end-to-end: a tester running
   `releases/download/vX.Y.Z-rcN/install.sh` gets an install pinned to the RC
   image.
7. The RC GitHub Release is correctly marked prerelease.

## Maintainer runbook (concrete)

**Start RC cycle:**
1. Set `"version": "0.2.0"` in `package.json`, `server/package.json`,
   `packages/shared/package.json`.
2. Add `## [0.2.0] - YYYY-MM-DD` to `CHANGELOG.md` (keep `## [Unreleased]`
   above it).
3. Commit, then `git tag v0.2.0-rc1 && git push origin v0.2.0-rc1`.
4. CI runs the full pipeline → publishes `:0.2.0-rc1` + `:rc` and a prerelease.
5. Test: `MAYON_VERSION=0.2.0-rc1 docker compose up -d`
   (or `MAYON_VERSION=rc` for the newest candidate).

**Iterate:** fix on `main`, then `git tag v0.2.0-rc2 && git push origin
v0.2.0-rc2`. (package.json stays `0.2.0`; no edits.)

**Promote:** `git tag v0.2.0 && git push origin v0.2.0`. Same code path; CI tags
`:0.2.0` + `:latest` and makes it the latest release. **No file edits.**

## Risks / edge cases

- **Force-pushed / re-used RC tags:** out of scope — each RC is a fresh tag.
- **RC base ≤ last released version:** not blocked. Optional future hardening:
  compare against the latest git tag and fail if the new base isn't greater.
- **`metadata-action` `enable=` reliability:** a well-trodden pattern; documented
  fallback is to compose the `tags:` string in a prior `run:` step.
- **`:rc` floating tag** spans minor versions once a newer RC line starts — only
  use `MAYON_VERSION=rc` when you genuinely want the newest candidate across all
  lines; prefer the exact `:X.Y.Z-rcN` for reproducible testing.

## Validation

- Lint/format: `pnpm lint`, `pnpm format` (check).
- Type-check/build are unaffected (no app source touched).
- Manual dry validation of the bash classify/regex logic: feed `0.2.0-rc1`,
  `0.2.0`, `0.2.0-rc10` through the regex locally to confirm `is_rc`, `base`,
  and `version` outputs.
- End-to-end validation is the first real RC tag itself (`v<next>-rc1`) — that is
  the point of the canary.

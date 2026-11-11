# Research: Test-infrastructure accuracy fixes (038)

All file:line claims below were re-verified against the CURRENT tree on
2026-11-11 (the issue was filed against an older tree; #71 and #74 landed
since). Stale-issue findings are flagged.

## Evidence table

| # | Claim (issue) | Verified on current tree | Status |
| --- | --- | --- | --- |
| 1 | `tests/e2e/image-round-trip.spec.ts:26-40` selects by first project mounting the base compose file | `mockRequestCount` at :26-40; `COMPOSE_FILE = ${cwd}/docker-compose.dev.yml` at :21; `projects.find(p => p.ConfigFiles.split(',').includes(COMPOSE_FILE))` at :31. Shard stacks add `docker-compose.dev.shard.yml` on top of the SAME base file (`scripts/dev-compose.mjs:87-95`), so `mayon-dev`, `mayon-dev-shard-1`, `mayon-dev-shard-2` all match; `find` returns the first. | CONFIRMED |
| 2 | Drift guard reads only `server.mjs` + `kitchen-sink.ts` | `classification-markers.test.ts:21-28` reads exactly those two sources; mirrors exist at `chat.svelte.test.ts:927-929` (`PROPAGATE_TRIGGER`, `PROPAGATE_UNAVAILABLE_REPLY` re-typed; comment at :922-926 says "byte-matches"), `quizzes.svelte.test.ts:486/:510/:570` (lever triggers inline; comment at :419-421 says "Values are duplicated (not imported)… keep the two in sync"), `loop.test.ts:99` (mock tool def `id: 'propagate_to_parent'` mirrors `PROPAGATE_TOOL_NAME`). The issue's `MOCK_IMAGE_REPLY_*` name is stale — no such mirrors; the real mirrors are these constants. | CONFIRMED (naming stale) |
| 3 | No toast-absence assertions anywhere in the backprop journey | `backprop-tool.spec.ts` (226 lines): zero toast assertions; its own comment (:80-81) defers "ask/toast absence sweeps" to the fast tier, and `backprop-endstate.test.ts` asserts rows/asks but never observes toasts. `toasts.svelte.test.ts` (63 lines): push/auto-dismiss/dismiss/clear, all positive. Toast emission sites: `+page.svelte:328-341` (`runPropagation` toast-iff-`lastPropagation`), `chat.svelte.ts:1648-1650` (`notifyLowRiskImpl` pushes into `toastState`). Latch: `chat.svelte.ts:1786-1796` (refused call clears `lastPropagation` — 037's fix; `propagation.test.ts:357-378` proves latch mechanics, no toast pin). The e2e "Dismiss" wording re-anchors to today's UI: approval cards expose Approve/Decline (`rows/AskEntry.svelte:168-169`); the toast layer's own control is `aria-label="Dismiss"` (`Toaster.svelte:30-37`). | CONFIRMED (wording re-anchored) |
| 4 | Merge formula written 3× | `connection-test.test.ts:352` (`[...discovered, ...config.models.filter(...)]`), `ProviderConfig.svelte:215` (refreshModels) and `:272` (testConnection; `:273` auto-fills `defaultModel` when empty). Sibling precedent: `mergeModelContextWindows` already lives in `src/lib/ai/model-discovery.ts:82` and is consumed by the same call sites. | CONFIRMED |
| 5 | `.github/workflows/ci.yml:76-86` no cache, shards 21/11 | STALE in part: pnpm cache IS present now (`ci.yml:20` web job, `:78` e2e job — landed after the issue). Uncached work remaining: image builds — the e2e job's `pnpm dev:shard:up` (`ci.yml:85`) triggers compose builds with no cache config, and the web job's `docker build .` / `docker build -f server/Dockerfile .` (`.github/actions/ci/action.yml`) have no cache flags. Split measured on this tree: 21 tests/7 files vs 12 tests/3 files (33 total; issue's 11 → 12 because #71 G5 added a render e2e). Per-file: backprop 4, image 1, lab 1, mock-classification 3, onboard 3, prompt-contract 2, provider-picker 7, quiz 2, render 7, telemetry 3. | PARTIALLY STALE (scope corrected) |
| 6 | 031 artifacts claim no CI edits | `specs/031-split-text-e2e-tests/plan.md:103` (".github/workflows/ci.yml # UNCHANGED — verified, not edited (D6)"), `research.md:142-148` (D6 decision), `tasks.md:174-176` (Notes: "no CI edits (research D6)"). #74/034's ledger work is unrelated (that fixed the e2e README ledger, not these artifacts). | CONFIRMED |
| 7 | Reload parity pins only `streamText` (~:2234 stale) | Actual home: `chat.svelte.test.ts:2674-2698` test "(d) reload hydration serves the image from the persisted row" — captures `mockedStreamText` count (:2681) and asserts unchanged across `load()` (:2686). Mocks for `generateObject`/`generateText` already exist (:61-63, :121-123). Verified `load()` fires no AI calls (brief inference is inside `send()`: `chat.svelte.ts:659-663`), so extending the pin is green today and mutation-provable. | CONFIRMED (line re-anchored) |

## Decisions

### D1 — Shard-log selection: pure selector keyed on project name from the base URL

**Decision**: new module `src/lib/dev/compose-project.ts` exporting
`expectedComposeProjectName(baseUrl)` and
`selectComposeProject(projects, opts)`. Port 5173 → `mayon-dev`; ports 5201-5299
→ `mayon-dev-shard-${port-5200}` (mirrors `shardProject`/`shardWebPort` in
`scripts/dev-compose.mjs:25-29`). Selection = find by exact project `Name`, then
verify `ConfigFiles` contains this checkout's absolute
`docker-compose.dev.yml` (plus `docker-compose.dev.shard.yml` for shards);
fail with an error naming the expected project and start command on any miss.
The e2e spec (`image-round-trip.spec.ts`) keeps doing `compose ls --format
json` and passes the parsed entries to the selector; `E2E_BASE_URL` (set by
`scripts/dev-shard.mjs:180`, default `http://127.0.0.1:5173` in
`playwright.config.ts:13`) is the input.

**Rationale**: project names are deterministic (`-p` is always passed by
`dev-compose.mjs:86,107`), the base URL is exactly what the runner targets, and
name+file verification is immune to sibling stacks mounting the same base file.
Unit-testable with synthetic listings (no Docker).

**Alternatives considered**: match on the shard override file alone (breaks
unsharded runs against the base stack); parse `docker compose ls` per-service
ports (not exposed); env-var plumbing from dev-shard.mjs (leaky; the spec
already receives E2E_BASE_URL).

### D2 — Selector placement: `src/lib/dev/` (fast-tier importable, e2e-consumable)

**Decision**: `src/lib/dev/compose-project.ts` + `compose-project.test.ts`,
following the dev-tooling precedent of `src/lib/dev/strategy-lint.ts`. The e2e
spec imports it (Playwright compiles `src/` TS; no tsconfig conflict because
Playwright transpiles independently). Vitest's include (`vite.config.ts:73`)
requires the test under `src/`.

**Rationale**: the fast tier can only run tests under `src/**`; conversely
`tests/` is tsconfig-excluded so a `tests/`-home would force a
`fileURLToPath`-dynamic-import contortion (the markers/strings precedent) for
no benefit; `src/lib/dev/` already exists for exactly this class of code.

### D3 — Drift guard: single explicit mirror registry, byte-containment patrol

**Decision**: extend `classification-markers.test.ts` with a `MIRRORS` const —
one entry per patrolled file `{ label, path, constants: [...] }` — iterated by
one `it` per file asserting the file's source `toContain` each constant's exact
value (and, for named-const mirrors, that the local const does not carry a
divergent literal — one containment assertion per constant catches both drift
directions: fixture renames make the old value unfindable; mirror edits make
the fixture value unfindable). Registry covers today's mirrors:
`chat.svelte.test.ts` → `PROPAGATE_TRIGGER`, `PROPAGATE_UNAVAILABLE_REPLY`,
`PROPAGATE_TOOL_NAME`; `quizzes.svelte.test.ts` → `LEVER_TRIGGER_CORRECT`,
`LEVER_TRIGGER_WRONG`; `loop.test.ts` → `PROPAGATE_TOOL_NAME`; plus the two
already-patrolled files stay as-is. Update the mirror files' stale "keep the
two in sync" comments to point at the guard, and the `strings.mjs` header to
document the registry.

**Rationale**: one place to add the next mirror (spec FR-004); keeps
duplicates-at-use-site (house readability pattern) with zero churn to three
suites' mechanics; guard failure names both files.

**Alternatives considered**: convert mirrors to dynamic imports of
`strings.mjs` (rejected: rewires three suites' fail ergonomics and their
documented rationale for a coverage goal the patrol achieves directly);
repo-wide scan for fixture values (rejected: false positives from incidental
uses, e.g. `generate-quiz.test.ts:465` embeds `should be wrong.` inside an
adversarial prompt payload on purpose).

### D4 — No-toast assertions: store tier is authoritative; e2e sweeps maintainer-verified

**Decision**: (a) `src/lib/stores/chat.svelte.test.ts` gains two assertions
observing `toastState.toasts` — declined propagate-approval turn → length 0
throughout; second `propagateToParent` while the latch is held → no push and
exactly one artifact row in the parent (importing `toastState` from
`#lib/stores/toasts.svelte.js`, the same singleton `chat.svelte.ts:79` pushes
into). (b) `toasts.svelte.test.ts` gains negative assertions (no-op dismiss
adds nothing — extends :46-50; a toast dismissed manually never re-emits
another). (c) `backprop-tool.spec.ts` gains absence sweeps using
`page.locator('button[aria-label="Dismiss"]')` — unique to the toast layer
today (brief-intake Dismiss buttons are text-labelled, `+page.svelte:937`) —
asserted `toHaveCount(0)` after the Decline journey and after the
approval-success settle. E2e runs only on a dev stack (documented, never
skipped — 035 T018 pattern).

**Rationale**: the toast guarantee is store-level state; the fast tier pins it
container-free (fleet-verifiable), the e2e sweep pins the wired UI (maintainer).

**Alternatives considered**: e2e-only assertions (rejected: unverifiable by
the implementer tier); adding a testid/role to the Toaster (rejected:
product-file churn for a selector that is already unique).

### D5 — Discovery merge: one helper in `model-discovery.ts`

**Decision**: export `mergeDiscoveredModels(discovered: string[], existing:
string[]): string[]` from `src/lib/ai/model-discovery.ts` (next to
`mergeModelContextWindows`, its sibling at :82, which the same call sites
already pair it with). Implementation is the current formula verbatim:
`[...discovered, ...existing.filter((m) => !discovered.includes(m))]`. Both
`ProviderConfig.svelte` call sites (:215, :272) and `connection-test.test.ts`
(:352) consume it. Unit tests in `model-discovery.test.ts` pin: discovered
order first, dedupe, manual tail preserved, empty discovery → existing
unchanged, empty both → empty.

**Rationale**: parity by construction (the tested path and the shipped path
call the same function); the module is already the home of discovery-shaped
pure helpers; the refactor is behavior-identical with the existing
`['a','b','manual-keep']` expectation as the net.

**Alternatives considered**: export the helper from the component module
(rejected: components are not import surfaces for `src/lib/ai` tests);
duplicating the assertion against the component's source text (rejected:
string-matching tests are the fragility this issue exists to remove).

### D6 — CI cache: buildx + actions cache, pre-built under compose tags

**Decision**: in `ci.yml`'s e2e job, before `dev:shard:up`, add
`docker/setup-buildx-action@v3` and two explicit builds:
`docker buildx build --cache-from type=gha --cache-to type=gha,mode=max --load
-t mayon-dev-shard-${{ matrix.shard }}-web -f Dockerfile.dev .` and the same
for `-server -f server/Dockerfile.dev`. Compose's default image name for
project `mayon-dev-shard-N` service `web`/`server` is exactly
`mayon-dev-shard-N-web`/`-server`, and the shard path runs plain `up -d` (no
`--build`, `dev-shard.mjs:147`), so pre-loaded images are adopted as-is. In
`.github/actions/ci/action.yml`, switch the two `docker build` lines to
`docker buildx build` with the same cache flags (same cache scope — keys are
content-derived per Dockerfile, so dev and prod images cache independently;
both shard legs share the dev-image cache). Keep every step commented for
maintainers.

**Rationale**: no compose-file changes (local `pnpm dev` untouched — `type=gha`
export errors outside Actions runners, so baking cache config into
`docker-compose.dev.yml` would break local builds); minimal workflow delta.

**Alternatives considered**: `cache_from: [type=gha]` in the compose build
stanzas (rejected — breaks local builds, see above); building once in a
separate job and sharing via artifacts (rejected — bigger workflow surgery
than the issue's "conservative" ask).

### D7 — Shard rebalance: describe-boundary file split, listing-verified

**Decision**: split `provider-picker.spec.ts` (7 tests: grouped-picker
describe :14 = 4 tests, tool-capability describe :58 = 1, connection-coaching
describe :113 = 2) along its describe boundary — the connection-coaching pair
moves to a new `tests/e2e/provider-picker-coaching.spec.ts` (alphabetically
after `provider-picker.spec.ts`, before `quiz.spec.ts`). Playwright's
`--shard` packs whole files; with the 4+1 vs 2 cut the measured target is
18/15 (verified empirically at plan time by simulating the file list — the
implementer re-measures with `pnpm exec playwright test --list --shard=1/2`
and `--shard=2/2`, container-free). Acceptance: ≤18/15. If measurement lands
worse, adjust which describe moves (fallback: also move the tool-capability
test) — never split a describe mid-way. The e2e README ledger gets a row for
the new file and the existing provider-picker row is updated (policy 1: every
new spec ships its row in the same change).

**Rationale**: files are the shard unit; the straddling 7-test file is the
imbalance source (cumulative counts: 4,5,6,9,12,14,21 — provider-picker spans
the 16.5 midpoint); describe-boundary moves are copy-paste with shared
fixtures already imported per-file; the listing oracle needs no Docker.

**Alternatives considered**: replacing `--shard` with an explicit per-shard
file map (rejected: rewires `dev-shard.mjs`'s telemetry-owner detection and CI
matrix semantics — invasive); pruning/migrating coaching tests to the fast
tier (rejected: they are classified `retained-live-path` in the ledger;
deletion needs a disposition this issue doesn't grant); splitting
`render.spec.ts` instead (no effect: it already sits inside shard 2).

### D8 — 031 artifacts: dated addenda, history intact

**Decision**: append a one-line dated addendum directly beneath each of the
three claims (`plan.md:103`, `research.md` D6 section, `tasks.md` Notes
bullet): e.g. "*(2026-11-12, feature 038 / issue #75: the CI workflow WAS
subsequently edited — cache-backed image builds + shard rebalance; see
`specs/038-test-infra-accuracy/`.)*" — original text untouched.

**Rationale**: the claims were true when made; annotation keeps both the
decision history and the present truth readable.

### D9 — Reload parity: three-counter delta across `load()`

**Decision**: extend `chat.svelte.test.ts` test (d) (:2674-2698): capture
`mockedStreamText`, `mockedGenerateObject`, `mockedGenerateText` call lengths
after the turn (:2681 today, stream only) and assert all three unchanged after
the re-`load()` (:2686). Mutation red-proof documented in the task: calling
any of the three inside the hydration path must flip the suite red.

**Rationale**: same pattern, two more counters; the mocks already exist in the
file; verified `load()` is AI-call-free today so the extension is green and
the pin is regression-only.

## What is explicitly NOT in scope

- No product behavior changes: `ProviderConfig.svelte` edits are a
  call-site swap only; `Toaster.svelte` untouched; toast copy untouched.
- No e2e test deletions (ledger dispositions untouched except the new row for
  the split file).
- No pnpm-cache work (already present — evidence item 5).
- No server-package changes (server suite untouched).
- No release activity (version bumps/tags are the maintainer's; CHANGELOG
  entry only, inside `## [0.10.0]` per the release train).

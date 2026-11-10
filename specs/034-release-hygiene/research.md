# Research — 034 release-hygiene

All file:line claims below were verified against the working tree on 2026-11-10
(branch `fix/issue-74-release-hygiene`, post #69/#70 merges). Line numbers refer to
the current tree unless prefixed with a commit.

## D1 — Changelog section date: RC-preparation date, 2026-11-10

**Decision**: The `## [0.10.0]` section is dated **2026-11-10** — the date the section
is authored (RC preparation), not the future stable-tag date.

**Rationale**: 0.9.0 precedent — the `## [0.9.0] - 2026-11-03` section and version bump
were authored in `1947fe6` ("chore: prepare 0.9.0 release", 2026-11-03) which is also
`v0.9.0-rc1`'s content; the stable `v0.9.0` tag came later (`35d363b`, 2026-11-08,
after rc1–rc4). AGENTS.md's RC cycle keeps `package.json` at the base version through
RC iterations, so the section is written once, at RC prep.

**Alternatives considered**: (a) stable-tag date — rejected: would require editing the
section at promotion time, which the RC flow explicitly avoids ("no file edits");
(b) placeholder date — rejected: the release workflow greps for `## [0.10.0]`
(`docker-publish.yml:70-73`) and a concrete date is the repo's established format.

## D2 — Where #71–#75 land: accumulate inside the open `## [0.10.0]` section

**Decision**: Until a stable `v0.10.0` tag exists, later fleet fixes append their
entries inside `## [0.10.0]` (under its Added/Changed/Fixed subsections). The empty
`## [Unreleased]` header stays directly above it per AGENTS.md ("keep a fresh empty
`## [Unreleased]` above it"). After the stable tag, new work lands under
`## [Unreleased]` again.

**Rationale**: One staging area at a time. The alternative — parking new entries in
`## [Unreleased]` while `## [0.10.0]` waits untagged — creates two candidate homes and
guarantees a fold-in step per merge; the release contract only checks that the
`## [X.Y.Z]` section exists (`docker-publish.yml:70-73`), so accumulating in it is
contract-safe while the tag is absent.

**Alternatives considered**: keep `## [Unreleased]` as the accumulator — rejected
(fold-in churn, risk of tagging with entries stranded in the wrong section).

## D3 — No vite/rolldown changelog entry: the issue's parenthetical is stale

**Decision**: The `## [0.10.0]` section contains **no** vite/rolldown entry.

**Rationale**: Verified there is no such change in the release window:
`git log v0.9.0..HEAD -S rolldown` matches only `20729c6` (027 feature commit;
lockfile churn, no vite/rolldown dependency change), `git diff v0.9.0..HEAD --
pnpm-lock.yaml | grep -ci rolldown` → 0, and the manifest diff since v0.9.0 touches
only `scripts` (dev:shard:*). Vite has been `^8.1.6` since before 0.8.2, and the
8.1.0→8.1.6 bump was already changelogged under `## [0.8.2] - 2026-10-24`.

**Alternatives considered**: writing a hedged "toolchain" entry anyway — rejected
(changelog must contain only real changes). Residual surfaced in spec Open Questions
for the maintainer.

## D4 — Version bumps land now (this change = RC preparation, minus the tag)

**Decision**: All three manifests (`package.json:3`, `server/package.json:5`,
`packages/shared/package.json:3`) are set to `0.10.0` in this change, together with
the changelog section.

**Rationale**: AGENTS.md release steps 1–2 are exactly this (set versions + add
changelog section, commit), and step 3 (tag) is the human's. RC iterations then need
"no file edits". The verify-version gate requires manifest == tag base
(`docker-publish.yml:63-69`) and the changelog section (`:70-73`).

**Alternatives considered**: bumping at tag time — rejected: that ordering is exactly
the "RC preparation" the issue assigns to this work; splitting it leaves the tree
unreleasable if the maintainer tags right after merging the fleet's branches.

## D5 — Idea tombstone: restore `ideas/history-map.md` with sentinel 013

**Decision**: Recreate `ideas/history-map.md` (content recoverable from
`84389bf^`) with the sentinel advanced to **013** (highest existing idea directory:
`ideas/013-code-artifacts`; idea number 011 was never used — noted as an aside), plus
two retirement records for the vanished files. Loose-file retirement records are a new
table in the same file (the old file explicitly said loose `ideas/*.md` "remain live" —
that rule is what the deletion violated).

**Rationale**: The tombstone is the established mechanism (specs counterpart:
`specs/history-map.md`); the sentinel must live next to the numbered directories it
protects. Restoring is strictly better than a `docs/history/` note, which Idea-file
readers never see.

**Alternatives considered**: recording retirements only in `docs/history/` — rejected
(invisible at the point of use; the 0.9.0 CHANGELOG cites the tombstone file itself).

## D6 — Dispositions for the two vanished ideas

**Decision**:
- `llm-mocks.md` (1 line, `84389bf^`) — **delivered**: the wish for "a bogus provider…
  a mock llm provider… static reply" is the shipped mock-llm fixture
  (`tests/fixtures/mock-llm/`, built by specs/017-mock-llm-chat-tests +
  020-rc-ui-verification). Retirement record points there.
- `security-scan.md` (3 lines, `84389bf^`) — **partially delivered, remainder
  re-homed**: posture detection + Dependabot shipped as spec 019
  (`docs/history/019-security-posture-detection.qmd`); the exfiltration concern was
  addressed by #69 relay hardening (already in `## [Unreleased]` → folded into
  0.10.0); the open remainder (triage the backlog to zero known-highs) already lives
  in `ideas/dependency-vulnerability-backlog.md` (verified: that file carries the
  Dependabot/Trivy backlog ask). Retirement record points to all three.

**Rationale**: Retirement records must say where the content went; both files' intents
are traceable to shipped or surviving artifacts (verified by reading
`84389bf^:ideas/llm-mocks.md`, `84389bf^:ideas/security-scan.md`, and the surviving
backlog idea).

**Alternatives considered**: resurrecting `security-scan.md` as a live idea — rejected
(duplicates the backlog idea's scope; the tombstone record with pointers preserves the
original wording's intent without a stale copy).

## D7 — Langfuse stub: handle faults at the request path, no process handlers

**Decision**: In `tests/fixtures/langfuse-stub/server.mjs`:
1. Delete `process.on('unhandledRejection')` and `process.on('uncaughtException')`
   (`server.mjs:90-95`).
2. Make `readBody` settle on aborted bodies: reject on `req` 'error' (already present,
   `server.mjs:30`) **and** resolve-with-error on early client abort ('aborted'/'close'
   before 'end'), so the abort is an ordinary failure the route can answer.
3. In the OTLP route, the existing try/catch (`server.mjs:45-53`) keeps answering 400
   on malformed/aborted bodies, but `sendJson` must never write to a dead socket:
   guard with `res.writableEnded`/`socket.writable` (or attach a no-op `res.on('error')`)
   — a write to a destroyed response is the unhandled fault the process handlers were
   masking (they were added by `86e83db` for the abort race; the route's own catch was
   never the problem, the dead-socket write was).
4. Keep `server.on('clientError')` (`server.mjs:96-99`) — that is the correct
   per-connection handler.

**Rationale**: The issue's prescribed shape ("handle the abort/parse error where it
occurs (answer 400), keep process-level handlers out"). The original flake motivation
(`86e83db` "keep langfuse-stub alive through in-flight export races") is preserved by
(2)+(3): aborts become ordinary 400s (or silent dead-socket drops) that cannot crash
the process, while genuine logic faults now terminate loudly.

**Alternatives considered**: (a) keep process handlers but `process.exit(1)` after
logging — rejected (an aborted body is NOT a genuine fault; exiting reintroduces the
flake); (b) add a permanent vitest harness for the stub — rejected (`tests/fixtures/`
is tsconfig-excluded by design; the standalone probe in quickstart S5 is the
regression evidence).

## D8 — Item 6 is verify-only (already fixed on main)

**Decision**: No edit task for the e2e engine seam or ledger; ship verification
evidence instead, and cover PR #77's fix in the changelog (D9 inventory).

**Rationale**: Verified on the current tree:
- `tests/e2e/image-round-trip.spec.ts:2,23` resolves the engine via
  `resolveEngine()` from `scripts/dev-compose.mjs` (added by `d881d75`, merged as PR
  #77) — no hardcoded `docker` remains (grep shows only engine-resolved invocations,
  lines 29/35).
- `tests/e2e/README.md` ledger (`README.md:24-35`) contains a row for
  **`backprop-tool.spec.ts`** (`README.md:34`, present since the 031 inventory commits
  `1ce2d7a`/`48e8fb2`, i.e. before the issue was filed) and counts 10 rows for the 10
  `tests/e2e/*.spec.ts` files (verified by ls + row count).

**Alternatives considered**: adding a "duplicate row just in case" — rejected (would
break the one-row-per-spec policy, README:39-41).

## D9 — Changelog entry inventory for `## [0.10.0]`

**Decision**: Section structure and content, compiled from
`git log v0.9.0..HEAD --oneline` (read-only) + existing `## [Unreleased]` entries:

**Added**
1. **Back-propagate a branch's outcome into its parent (027)** — `propagate_to_parent`
   tool with a shared in-flight latch, per-turn gating and offer-once etiquette in the
   capabilities preamble, approve/decline UI, durable branch-artifact rows; mock-llm
   dispatch modes + e2e coverage (PR #65, commits `20729c6`..`0578fbb`).
2. **Mermaid diagrams that fail to render are contained and self-repaired (028)** —
   styled error block instead of raw render errors (`suppressErrorRendering`), pure
   parse-verified source-repair rules, one deterministic repair pass at the render
   seam, "repaired" badge with original-source disclosure, fix-diagram follow-up
   affordance (PR #64, commits `7c41261`..`b6499ae`, `6788baa`, `3238e9b`).
3. **Interleaved micro-thoughts / per-segment reasoning (029)** — segment-aware stream
   consumption, live interleaved reasoning/text blocks, arrival-ordered persistence of
   anchored per-segment reasoning rows, reorderTurn v2, per-segment reasoning in the
   turn trace + diagnostics panel (PR #66, commits `ab57f73`..`5ac35a0`).
4. **Image generation in chat (030)** — vision-gated assistant image parts with
   capability flag + budget, stream recognition of image parts (raw-chunk shim),
   per-turn pending images, atomic assistant-parts persistence, live placeholder, URL
   materialization at finalize, segmented assistant rendering, shared lightbox with
   download, `[image]` markers in back-propagated artifacts (PR #67, commits
   `24a567d`..`9a52cff`).
5. **Faster, split test suites (031)** — behavior invariants migrated to fast-tier
   homes (`useFileTestDb()`), e2e inventory as classification + parity ledger,
   single-source fixture strings with drift guard, direct onboarded-fixture seeding,
   per-shard e2e stacks via `pnpm dev:shard:up` (PR #68, commits
   `5e1846f`..`1589d0f`).

**Fixed**
6. **Provider credential leak / SSRF via model-supplied image URLs (#69 / 032)** — fold
   the existing `## [Unreleased]` entry verbatim-in-substance
   (`CHANGELOG.md:27-38`).
7. **Assistant image replies / finalize paths (#70 / 033)** — fold the existing entry
   (`CHANGELOG.md:12-26`).
8. **Image e2e engine hardcoding (PR #77)** — `image-round-trip.spec.ts` resolves the
   container engine (Docker **or** Podman) through the dev-compose seam instead of
   hardcoding `docker` (`d881d75`).

Non-entries (documented, not changelogged): `84389bf` idea bookkeeping (this feature
restores the tombstone), `04045e3` AGENTS.md (contributor meta, may be folded into the
031 bullet's wording at the implementer's discretion — keep out by default), #74's own
docs/fixture hygiene (this change; folded into 0.10.0 only if the maintainer tags
after it merges — per D2 it would accumulate into the section).

**Rationale**: every train's user-visible behavior is represented; nothing invented
(D3).

**Alternatives considered**: separate ### Added subsection per feature — rejected
(match 0.9.0 style: one bolded bullet per feature).

## D10 — Docs wording targets (exact, verified)

**Decision**: Surgical edits at exactly these points (nothing else in the two files):

1. `docs/reference/seams.qmd:74` — projection Rules line. Replace with:
   `user_message` → `user` text, or ordered text+image parts when the row carries
   `parts` (user image parts keep the 018 AI SDK image shape); `assistant_message` →
   `assistant` text, or ordered text+image parts **only for vision-capable targets**
   (`projectEntries` `visionCapable` option; resolved via `supportsVision`) where each
   image becomes a provider **file part** `{ type:'file', mediaType, data }` (base64
   body) — non-vision or parts-less rows project text-only, silently; the remaining
   kind mappings unchanged. Verified against `src/lib/chat/projection.ts:88-118,
   169-177, 276-312`.
2. `docs/reference/seams.qmd` — new subsection under "Presentation seams (feature
   004)" (section starts `seams.qmd:158`): **Mermaid render seam (feature 028)** —
   serialized per-block rendering (module render chain), success contract
   `{ svg, theme: 'light'|'dark', repaired: false }`, on failure exactly one
   deterministic repair pass (`repairMermaidSource`; unchanged source ⇒ reject with
   the original error; failed repair ⇒ reject with the repaired attempt's error),
   callers contain rejects as a styled error block + fix-diagram affordance (never raw
   error text). Source: `src/lib/markdown/mermaid.ts:60-98`,
   `src/lib/components/chat/Markdown.svelte:93-145`,
   `specs/028-mermaid-error-repair/contracts/render-pipeline.md`.
3. `docs/explanation/architecture.qmd:306` — `assistant_message` semantics: ordered
   text+image parts (`messages.parts`), segmented rendering, image-only rows possible;
   legacy rows are text-only.
4. `docs/explanation/architecture.qmd:307` — `reasoning` semantics: one row per
   reasoning **segment**, persisted arrival-ordered with
   `metadata: { iteration, anchored: true }` (`ReasoningMeta`,
   `src/lib/chat/kinds.ts:86-89`); legacy per-iteration rows (no `anchored`) still
   readable and splice before the assistant row. Source:
   `specs/029-micro-thoughts/contracts/persistence-and-display.md:11-50`.
5. `docs/explanation/architecture.qmd:330-331` — projection table `user_message` /
   `assistant_message` rows updated to match (1).
6. `docs/explanation/architecture.qmd:292` — external lane: "assistant text and image
   parts rendered for the user" (minor).
7. `docs/explanation/architecture.qmd` UI stack (after the markdown pipeline bullet at
   `:77`): one bullet for the mermaid pipeline — render seam contract summary +
   pointer to the seams section and the 028 render-pipeline contract.

**Rationale**: The issue names exactly these stalenesses; AGENTS.md makes these two
files the authority, and #69 already rewrote the relay paragraph (`seams.qmd:58`) —
untouched here.

**Alternatives considered**: rewriting the whole projection section — rejected (scope
discipline; only false sentences change).

## D11 — Mock-llm README extension shape

**Decision**: Extend the existing 030 bullet (`tests/fixtures/mock-llm/README.md:66-70`)
with: (a) classification — the trigger phrase classifies the request as `image_reply`
(`server.mjs:412`, `server.mjs:621`); (b) route split — OpenAI-compatible requests
stream the image on `POST /v1/chat/completions` via `choices[0].delta.images[]`
data-URL frames (`server.mjs:239-266`), while Google requests never reach the
completions path — they hit `POST /models/{model}:streamGenerateContent?alt=sse` and
carry a candidate part `inlineData { mimeType, data }` (`server.mjs:79-82,294-306,606-623`);
(c) the SDK-compat note (the OpenAI shape mirrors the provider spike's raw-chunk shape;
the SDK strips `delta.images` at its layer, hence the raw-chunk shim);
(d) pacing — image frames are deliberately slower than the standard 150 ms cadence so
the live caption is observable in CI (`server.mjs:242-245`).

**Rationale**: The README is the fixture's source of truth and the guardrail doc named
by `specs/030-image-generation/research.md:103`; the four omissions are exactly the
issue's list. Directory is Prettier-ignored — match its current prose style.

**Alternatives considered**: documenting in specs/030 only — rejected (spec dirs are
per-feature history; the README is the living entry point).

## D12 — Verification approach per artifact (capped, no Docker)

**Decision**: quickstart carries: the release-contract replication loop (jq + grep
mirroring `docker-publish.yml:59-74`), scoped `pnpm exec prettier --check` on
Prettier-covered changed files, `node --check` on the stub, a standalone stub probe
(start on a free port via a single node script; malformed body → 400; aborted body →
no crash, no phantom batch; `__received`/`__reset` still work; process handlers absent
from the source), and grep assertions for the docs wording (vision gate present at
`seams.qmd:74` area; "per … segment" reasoning text; mermaid contract present).
No vitest expected; if any becomes necessary, the fleet wrapper applies:
`systemd-run --user --scope -p MemoryMax=500M --setenv=NODE_OPTIONS=--max-old-space-size=384
pnpm test:low-spec <files>` (SPA) / `… pnpm --filter @mayon/server exec vitest run
--maxWorkers=1 --no-file-parallelism <files>` (server).

**Rationale**: Fleet test policy + no-Docker constraint; everything this feature
changes is verifiable statically or standalone.

**Alternatives considered**: running the telemetry e2e — rejected (requires the dev
stack; maintainer validation, noted in quickstart).

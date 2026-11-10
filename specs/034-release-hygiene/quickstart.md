# Quickstart — 034 release-hygiene validation

Runnable proof that the feature is complete. Everything here runs on a plain checkout
(no Docker, no dev stack). Machine profile check first per AGENTS.md (`nproc`,
`free -h`) — only relevant if a vitest run ever becomes necessary (none is expected).

## S1 — Release contract passes locally (US1)

Prerequisites: edits landed (manifests + CHANGELOG).

```bash
BASE=0.10.0
for f in package.json server/package.json packages/shared/package.json; do
  test "$(jq -r .version "$f")" = "$BASE" || { echo "FAIL $f"; exit 1; }
done
grep -Eq "^## \[0\.10\.0\]" CHANGELOG.md || { echo "FAIL changelog section"; exit 1; }
# fresh empty Unreleased: no non-empty lines between it and the next ## header
awk '/^## \[Unreleased\]/{u=1;next} u&&/^## /{exit 0} u&&NF{print "FAIL entries in Unreleased"; exit 1}' CHANGELOG.md
```

Expected: no FAIL output; exit 0. (Mirrors `docker-publish.yml:59-74`.)

Also verify: `git tag --list 'v0.10.0*'` is EMPTY — this feature must not tag.

## S2 — Authoritative docs are accurate (US2)

```bash
grep -c 'visionCapable\|vision-capable' docs/reference/seams.qmd   # ≥1
grep -c 'file part' docs/reference/seams.qmd                        # ≥1
grep -c 'per reasoning segment\|per-segment' docs/explanation/architecture.qmd  # ≥1
grep -ci 'one entry per agent-loop iteration' docs/explanation/architecture.qmd # 0 (old text gone)
grep -c 'repaired' docs/reference/seams.qmd                        # ≥1 (mermaid contract)
grep -n 'mermaid' docs/explanation/architecture.qmd                # render-seam mention beyond expound bullet
```

Expected values in comments; then eyeball the edited passages against
`src/lib/chat/projection.ts:88-118`, `src/lib/chat/kinds.ts:86-89`,
`src/lib/markdown/mermaid.ts:60-98` (research D10 is the wording source).

## S3 — Idea tombstone restored (US3)

```bash
test -f ideas/history-map.md
grep -q 'Last used idea number: 013' ideas/history-map.md
grep -q 'llm-mocks' ideas/history-map.md && grep -q 'security-scan' ideas/history-map.md
git status --porcelain ideas/ | grep -v '^??' | grep '^ D' && exit 1 || true
```

Expected: tombstone present, both retirements recorded, no idea file deleted.

## S4 — Mock-LLM README complete (US4)

```bash
for t in image_reply 'delta.images' inlineData streamGenerateContent pacing; do
  grep -qi "$t" tests/fixtures/mock-llm/README.md || { echo "MISSING $t"; exit 1; }
done
```

Expected: all five concepts present (research D11 is the content source).

## S5 — Langfuse stub fails loudly, survives aborts (US5)

```bash
node --check tests/fixtures/langfuse-stub/server.mjs
grep -c "process.on(" tests/fixtures/langfuse-stub/server.mjs   # 0
grep -c "clientError" tests/fixtures/langfuse-stub/server.mjs   # ≥1
```

Standalone probe (single process, no Docker): boot the stub on a free port from a
throwaway node script under `/tmp/kilo`, then (a) POST a malformed JSON body to
`/api/public/otel/v1/traces` → expect `400`; (b) open a request and destroy the
socket mid-body → stub stays alive, `/__received` gains no phantom batch;
(c) `POST /__reset` → `200`; (d) kill the stub. Detailed shape:
contracts/stub-fault-surface.md.

## S6 — E2e engine seam + ledger verified (US6)

```bash
grep -c resolveEngine tests/e2e/image-round-trip.spec.ts            # ≥1
grep -n "'docker compose\|\"docker compose" tests/e2e/image-round-trip.spec.ts  # no matches (engine always via $ENGINE)
ls tests/e2e/*.spec.ts | wc -l                                       # 10
grep -c 'spec.ts` *|' tests/e2e/README.md                            # 10 (one row per spec, incl. backprop-tool)
```

Expected: engine resolved via the shared seam; ledger rows == spec files. No edit
unless a count mismatches (then fix the drift minimally and re-run).

## Full gates (cheap, expected green)

```bash
pnpm exec prettier --check package.json server/package.json packages/shared/package.json CHANGELOG.md ideas/history-map.md tests/e2e/README.md
```

(`pnpm check` / `pnpm lint` full gates if the implementing worktree touched anything
type-relevant — not expected for this feature.)

## Maintainer follow-up (out of scope, recorded only)

Tag `v0.10.0-rc1` per AGENTS.md RC cycle; populate the RC GitHub Release body from the
`## [0.10.0]` section (single-line paragraphs, no hard wrap); telemetry e2e re-run on
the dev stack to double-cover S5 in situ.

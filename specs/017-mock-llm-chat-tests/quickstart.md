# Quickstart: Mock-LLM Chat Test Suite

Validation guide — proves the feature works end to end. Prerequisites, commands,
expected outcomes. Implementation detail lives in `tasks.md`; contract detail in
[contracts/](contracts/) and [data-model.md](data-model.md).

## Prerequisites

- Node 22 (`.nvmrc`), pnpm 10 (`packageManager`), Docker or Podman (`MAYON_DEV_ENGINE`)
- Fresh checkout: `pnpm install && pnpm --filter @mayon/shared build`
- One-time browser install: `pnpm exec playwright install --with-deps chromium`

## Bring up the stack

```bash
pnpm dev:up
```

Expected: project `mayon-dev` running `web` (:5173), `server` (:4319 internal), `db`,
and the new `mock-llm` service (internal only). Verify:

```bash
docker compose -p mayon-dev ps            # mock-llm shows healthy/running
docker compose -p mayon-dev exec server wget -qO- http://mock-llm:<port>/v1/models
# → {"data":[{"id":"mock-sink","object":"model"}]}
```

`http://localhost:5173` loads the app after the BootGate clears. No host port exists
for `mock-llm`; the model-list check must run from inside the `server` container
(that IS the network constraint under test).

## Run the suite

```bash
pnpm test:e2e
```

### Validation scenario 1 — P1 round trip (maps to spec US1, SC-001/SC-005/SC-006)

`tests/e2e/onboard.spec.ts`, one fresh browser context, zero providers/keys:

1. Open Settings → Add provider → "LiteLLM (self-hosted)" template.
2. Edit Base URL → `http://mock-llm:<port>/v1`; Default model → `mock-sink`.
   (Model discovery auto-fires and resolves against the mock — no error.)
3. Save placeholder key via the real "Save key" flow; Set active.
4. New chat → type a message → Send.

**Expected**: assistant reply streams in and completes; rendered content matches the
kitchen-sink fixture's substance. Whole scenario < 5 min from a cold stack. No
external network requests. Product `src/`/`server/src/` diff remains empty.

### Validation scenario 2 — P2 rendering depth (maps to spec US2, SC-004)

`tests/e2e/render.spec.ts`, against the same deterministic reply:

- Markdown structure (headings, lists, tables, blockquotes, links) present in DOM
- Inline + display math rendered to KaTeX output
- Mermaid fence rendered as diagram (not raw `language-mermaid` code)
- Code blocks carry working `.md-copy-btn` copy affordance
- Source alignment: selection/offset assertions through the product's alignment path
  match the fixture's known raw-markdown offsets

**Negative check (manual, once)**: break one capability in the renderer — only the
corresponding test fails, with a failure localized to that capability.

### Validation scenario 3 — determinism + CI (maps to spec US3, SC-002/SC-003)

```bash
pnpm test:e2e && pnpm test:e2e   # identical verdicts, twice
```

CI (on the PR): the new `e2e` job runs steps 1–5 of [contracts/e2e-stack.md](contracts/e2e-stack.md)
— green with no secrets configured and no traffic beyond image pulls. The existing
`web` job still gates `pnpm check` / `lint` / `test` / builds.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| BootGate never clears | stack not fully up — check `docker compose -p mayon-dev ps`, then reload |
| Send fails with missing-key error | key wasn't saved through the UI flow (placeholder must go through "Save key") |
| Reply never arrives, request hangs | base URL unreachable from `server` — re-check the `mock-llm` service and port |
| Stream errors with "ended without a finish reason" | mock regression: terminal `finish_reason` frame missing (contract violation) |
| Model discovery fails | only fatal if `/models` shape violates [contracts/mock-llm-api.md](contracts/mock-llm-api.md); discovery failure alone is tolerated by the app |

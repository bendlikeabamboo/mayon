# Quickstart: Brave Search MCP Service — end-to-end validation

**Feature**: specs/001-brave-search-mcp | **Revised**: 2026-08-19 (keystore custody, research.md R-9)

Runnable proof that the feature works. Prerequisites: Docker + pnpm 10 toolchain, a
Brave Search API key (https://brave.com/search/api/), repo checked out.

## 0. Quality gates (before any manual validation)

```bash
pnpm install
pnpm --filter @mayon/shared build
pnpm check && pnpm lint && pnpm test
pnpm --filter @mayon/server test
```

Expected: all green.

## 1. Bring up the dev stack (nothing Brave-specific to configure)

```bash
pnpm dev            # or pnpm dev:up
```

The connection is added entirely in the app — no `.env` keys, no compose profiles.

## 2. Connect in the app

1. Open http://localhost:5173 → Settings → MCP servers → Add Server.
2. Pick **Brave Search**; enter your API key when prompted; complete the trust prompt.
3. Test connection → healthy, ~8 tools listed (`brave_web_search` at minimum).

Negative check (guidance path): stop the server container → the stdio template is
unavailable with guidance; everything else in the app keeps working.

## 3. Fresh, source-backed answer (SC-002/SC-003)

1. New chat; ensure the connection is enabled (Composer MCP toggle).
2. Ask something that postdates the model's training data, e.g.
   "Search the web for this week's AI news and summarize the top 3 stories."
3. Expected: model calls `brave_web_search`; the reply reflects current results; the
   tool row beneath the reply lists consulted sources as links (FR-004). Reload the
   page — citations persist (rendered from stored metadata).

## 4. Degradation & recovery drill (SC-005, FR-006/FR-007)

1. **Missing key**: delete the stored credential in the app → next turn fails fast
   with a missing-key error; the turn still completes with a notice.
2. **Invalid key**: replace the key with a bogus value → searches return a clear
   credential/quota error in the tool row; plain chat is unaffected.
3. **Recovery**: restore the real key → the next message searches again. No app
   restart, no stack restart, no `.env` edits (FR-005).

## 5. Timing sanity (SC-004)

Ask the same factual question with the connection toggled off vs on; the augmented
reply should complete within ~10 s of the plain one (expect a small per-turn spawn
cost of a second or two while enabled; first use also downloads the pinned package
inside the server container).

## 6. Prod-stack parity (FR-008)

```bash
docker compose pull && docker compose up -d
```

Repeat steps 2–4 against http://localhost:8080 — identical behavior, zero stack-level
Brave configuration.

## References

- Connection template & runtime: [contracts/mcp-connection-template.md](./contracts/mcp-connection-template.md)
- Citations: [contracts/tool-result-sources.md](./contracts/tool-result-sources.md)
- Entities: [data-model.md](./data-model.md)
- Custody revision rationale: [research.md](./research.md) §R-9

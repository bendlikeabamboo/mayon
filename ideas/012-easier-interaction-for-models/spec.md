# Enforceable text-first runtime tier

**What**: AI agents can implement and verify new Mayon features end-to-end, with browser automation no longer the bottleneck of feature work.
**Why**: Agent-driven feature work funnels through Playwright-style UI testing, which is slow and brittle, even though most of a feature's risk lives below the UI — in data and logic that text can reach directly.

## The path

Declare and freeze the two-tier boundary that already exists: data model and execution logic live behind the repository/driver seams (repos behind `getDb()`, `StorageDriver`/`RemotePgDriver`, pure modules like `context.ts`/`assembly.ts`), and the web UI is a thin passenger on top. No new tier is extracted and no REST/MCP client is built — the implementing agent's text interface is the existing vitest + pglite harness (seed state through repos, assert on text), with `/api/db/query` and `/api/health` as live-stack doors for RC-time checks. Make the boundary machine-enforceable: lint boundary rules (only `src/lib/db/**` imports db internals; components import only the repos façade) plus CI dependency-direction checks, and write the one-page agent's map (where features live, how they're proven, where the browser is allowed to matter). Placement policy: if a feature's logic can live behind the boundary without much effort, it must — features are proven as text in logic-layer tests; the browser only tests what logic can't reach, and visual checks happen browser-as-camera (screenshot + vision review), rarely.

## Known snags

- Boundary fights recur for DOM-married logic (streaming render, expound offsets, selection mapping) — every straddling feature relitigates; policy: consequences and decisions go behind the seam, pixel/animation behavior stays UI.
- Discipline decay is the failure mode — mitigated by the lint wire + CI direction rules; without the wire the guarantee rots (today `eslint.config.js` enforces nothing — see research.md).
- Stragglers move opportunistically — the policy covers new features; legacy component-entangled logic walks down only when touched.
- Nothing enforces test _quality_ — presence checks are gameable; honest tests stay review discipline.
- Prompt-quality evaluation ("is the prompt good") is out of scope — owned by Langfuse outside Mayon's codebase (decisions.md scope note).

## Accepted trade-offs

- No REST/MCP client surface — a long-lived external text client gets nothing to attach to; revisit only if such a client materializes.
- UI features keep a browser story forever — the browser is demoted from courtroom to camera, not eliminated.
- Legitimate exceptions need explicit, reviewed escape hatches in the lint/direction config.
- The win partly ratifies the present: harness and seams already exist — the new work is naming, freezing, wiring, and mapping, not re-architecture.

## The bet

This wins if the enforcement wire holds (agents are physically steered to the logic layer), the text-reviewable fraction of features keeps growing as logic lands behind the seam, and the residual browser story stays small — UI wiring plus occasional visual snapshots.

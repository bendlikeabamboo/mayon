---
card: 003
name: codify-existing-seams
origin: dealt
bet: Wins if agents fail from disorientation, not architecture — the missing piece is the map, not the terrain
played: yes
---

# Card 003 — The split already exists; codify it (contrarian)

## Story

You build nothing new and instead write the agent's map of Mayon: repositories behind `getDb()`, the `StorageDriver`/`RemotePgDriver` boundary, `POST /api/db/query`, the server's capability handshake — plus a standing instruction that implementing agents work and prove features at those seams before touching the UI. The two tiers the idea asks for are already in the codebase; what was missing is a canonical, pointed-to contract. The next agent reads one page and starts at the logic layer unprompted.

## Playthrough (2026-10-31)

- **How it goes**: Day one you write the agent's map — one page in the operating docs: where features live (repos behind `getDb()`, pure modules like `context.ts`/`assembly.ts`), how they're proven (vitest + pglite, seed via repos, assert on text), where the browser is allowed to matter, plus the live-stack doors (`/api/db/query`, `/api/health`) for RC checks — and it becomes the mandatory "start here" for every implementing agent. The next agent session starts at the logic layer unprompted; velocity improves immediately with zero code changed. Research during this playthrough: the seam is convention-only (`eslint.config.js` has no boundary rules — see research.md), so the map's authority is entirely social.
- **Snags**: (1) A map is just a map — nothing forces an agent to read or obey it; directly conflicts with the user's stated need for machine guardrails. (2) Maps rot — every seam change needs a doc update, and a stale map misleads agents confidently, which is worse than no map. (3) It documents the present: moves no stragglers, adds no gate, builds no client door.
- **Trade-offs**: Zero code improvement — pure documentation; freshness discipline is the ongoing cost; compliance stays voluntary.
- **Delivers the what?**: Partially — removes the disorientation tax (per agent testimony, the biggest per-feature cost), which is real and immediate; but "browser not a bottleneck" holds only as strongly as agent compliance.
- **Difficulty vs payoff**: difficulty S · payoff M · time-to-first-value immediate (next agent session).
- **Your take**: User paused to ask, as principal engineer: "how do we enforce these kinds of things?" — Answer recorded (also relevant to the verdict, as surfaced direction material): an enforcement ladder. (1) Lint wire: `no-restricted-imports` or `eslint-plugin-boundaries` in `eslint.config.js` — only `src/lib/db/**` imports db internals; components import only the `repos`/`getDb` façade; bites in seconds inside the agent's own loop since agents run lint before finishing. (2) Direction rules in CI: dependency-cruiser (or equivalent) encoding the layer graph (UI → stores → repos → db), failing any PR that draws a forbidden arrow; rules reviewed like code. (3) Agent-loop permissions: a scoped agent config that cannot edit the wrong layers for a given task — earliest and strongest fence, but rigid, scoped per task. (4) Not cheaply enforceable: "the feature _has_ logic-layer tests" — presence checks are gameable; stays review discipline. Combined cost of 1+2: roughly a day of config, no architecture change; notable that the wire can be built on the existing seams without Card 001's tier.

---
card: 003
name: live-workspace-sync
origin: dealt
bet: Wins if the real pain is staleness and ferry-work — live access beats any paste you will forget to update
played: yes
---

# Card 003 — Live workspace sync

## Story

You connect Mayon to your project folder once, and from then on the model sees the live tree: it lists, greps, and reads files on demand when a question touches them. You stop ferrying code by hand entirely — when you refactor, the next turn automatically sees the refactored code. The source of truth stays the IDE; Mayon just has a window into it.

## Playthrough (2026-11-09)

- **How it goes**: Connect-a-folder plus model tools (list/grep/read) over the live tree delivers the idea doc's dream on first contact — a grounded answer with zero pastes; with per-task morphing code, live reads are the correct semantics, not merely convenient. The expected "huge" work is real and concentrates in three places: the trust boundary (a chat server that reads the filesystem needs a path jail, allow-lists, size caps — a mandatory posture change), repo scale (ignore-aware traversal, grep output caps), and per-project ceremony (Docker mounts/config per project). Smaller than feared in one place: Mayon's server already runs model-facing tools (stdio MCP runner), so the tool seam exists. Live tree also means mid-conversation movement plus the unsaved-buffer blind spot (model sees saved disk, not the dirty IDE), and answers reference bytes the transcript never captured — old chats lose their code unless reads are recorded.
- **Snags**: Trust boundary — bites at first connection — bad and mandatory. Repo scale/ignore handling — bites on the first real repo — medium. Per-project mount/config friction — bites at each new project — medium; couples Mayon to local deployment. Moving target + unsaved buffers — bites when answer and editor diverge — mild/medium. Provenance loss on replay — medium; no record of the bytes behind old answers.
- **Trade-offs**: Gives up curation and the bounded working set (whole-repo exposure unless scoped); gives up portability (local-machine coupling); permanent security-posture change; transcript no longer self-contained.
- **Delivers the what?**: The why fully — zero ferry-work, staleness structurally dead, unbounded growth. The what's letter only partially — code does not live in Mayon as durable tracked artifacts; it lives in the IDE and Mayon borrows it. Outcome delivered, mechanism inverted.
- **Difficulty vs payoff**: difficulty L · payoff H · time-to-first-value ~3–4 weeks to a safe MVP.
- **Your take**: Excited about this direction going in, while expecting "HUGE" work upfront. Then: Mayon does NOT run on the same machine as the code — the code lives in a GitHub repo, so the local-folder flavor as dealt doesn't fit the user's reality; floated making the repo public to avoid auth work, and a future token-based git integration granting Mayon access to specified repos. Likes whole-project visibility and proactive change awareness ("I see you updated this and that"). Raised open design questions: dedicated docker sandbox container vs one generic sandbox, server-side vs client-side execution. Consequences: the git-flavored mutation restores portability but freshness degrades to last-push (saved-but-unpushed morphs invisible — and the user's code morphs per task); a public repo trades privacy for zero auth work; token custody is real secret-handling design weight in a codebase that keeps secrets out of settings. Then leaned into a platform direction: a general sandbox VM foundation hosting all sandboxing needs (MCP, micro-VMs e.g. Firecracker, other runtimes), asking whether such a foundation unlocks much more. Noted: existing idea files `sandbox.md` (interactive script/graph sandboxes) and `plug-in-system.md` (pluggable engines/tools/MCPs) are consumers of exactly that seam; table ruling — build the generic sandbox seam as an abstraction, defer micro-VM runtimes until execution is a pulled need; the foundation idea deserves its own future pre-spec rather than folding into 013.

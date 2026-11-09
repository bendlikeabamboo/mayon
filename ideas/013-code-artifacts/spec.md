# Live workspace sync — GitHub public-API v1

**What**: Coding conversations ground themselves in the actual repository — the model lists, reads, and diffs your code straight from GitHub — instead of pasted copies in the chat bar.
**Why**: Re-pasting IDE contents into the chat bar is repetitive and lossy and copies drift stale, while the code already lives on GitHub — so Mayon should borrow it from the source of truth instead of keeping copies.

## The path

The server exposes a small model-facing tool seam — list, read, diff-since — whose first backend is the GitHub REST API against public repos: the trees endpoint returns the whole listing in one call, the contents endpoint reads a file, and every result is pinned to the repo's HEAD commit SHA and cached server-side keyed by (repo, sha, path), so immutable content is never fetched twice. Reads land in the transcript as lightweight SHA-pinned artifact references (file@sha) — every answer keeps exact, re-fetchable provenance without inlining full copies. On chat open or before a turn, one cheap call checks HEAD; when it moves, the compare endpoint supplies the file-level diff and the model is told what changed. The generic sandbox is decided for the future — not this story, but certainly coming — and this seam is built as its first tenant: when the sandbox lands, the backend swaps from API reads to a sandboxed checkout (private repos, tokens, execution) and the tool contract stays identical. GitHub auth is deliberately out of scope for v1; it arrives with the private-repo/sandbox story, and the seam leaves a shaped door (optional credential context) so that story changes limits and access, not contracts.

## Known snags

- Freshness is last-push, not last-save — bites whenever code morphs unpushed mid-task — medium; push-as-you-work habit plus SHA-change notices keep it visible.
- Unauthenticated rate limits (60 req/hr per IP) — bites on chatty navigation — medium; the (repo, sha, path) cache makes re-reads free, and a token later lifts this to 5,000.
- Whole-tree visibility with no curation — bites when irrelevant code distracts the model — mild; meaningful paths and selective reads are the mitigation, same as a human navigating.
- Huge repos can truncate the trees listing — bites only at monorepo scale — mild for normal projects.
- Non-GitHub or local-only code — bites at the first such task — out of scope for v1; the sandbox story is the growth path.

## Accepted trade-offs

- Public GitHub repos only, unauthenticated: privacy and non-GitHub code given up for v1 (by decision).
- Provenance is SHA-pinned references, not captured bytes: replay depends on GitHub honoring immutable SHAs — reproducible, but not local.
- No RAG or index: navigation quality rests on meaningful paths and model discipline; a search tool can grow behind the seam later.
- The transcript stops being the sole home of context: answers reference a live external source, so old chats are exact only in what they pinned.

## The bet

This wins if grounding answers in the real repo tree — borrowed live from GitHub, cached by immutable SHA, diffed on change — beats managing pasted copies, and the tool seam ages unchanged into the future generic sandbox.

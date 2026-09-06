---
card: 005
name: auto-detect-local-runtimes
origin: dealt
bet: Wins if "finding the provider" really means zero-config local connection and browser-side localhost probing holds up in practice (CORS, mixed content, ports)
played: yes
---

# Card 005 — Auto-detect local runtimes

## Story

You open the provider picker and Mayon has already probed the well-known local ports — LM Studio's 1234, vLLM's 8000 — and shows "LM Studio detected — connect?". Local users get zero-config onboarding without ever hunting through a list, while cloud providers stay a searchable directory. Discovery becomes something the app does for you rather than something you do in a list.

## Playthrough (2026-09-06)

- **What & why**: What — Mayon users can connect local inference runtimes (LM Studio, vLLM) as providers, and can quickly find the provider they want even as the provider list keeps growing. Why — local/self-hosted inference has no first-class path into Mayon, and the provider list has grown long enough that finding the right entry is friction that compounds with every addition.
- **How it goes**: You ship a quiet probe: when the provider picker or settings opens, the browser checks the well-known local endpoints — LM Studio `localhost:1234/v1/models`, vLLM `localhost:8000/v1/models`, Ollama `localhost:11434` — with a short timeout. Found one? "LM Studio detected — connect?" is one click, zero config, and it's the demo that sells the feature. The ground truth is uneven, though: Ollama answers from a localhost-origin Mayon (its default allowed origins are localhost/127.0.0.1, blocked for LAN/domain origins without `OLLAMA_ORIGINS`); vLLM answers (CORS permissive by default); LM Studio is CORS-off by default, so the probe _fails exactly for the newest local user_ — the runtime that most needs to be found reports as invisible. Honest detection therefore must classify failure reasons (connection refused = not running; CORS-silent = running but locked; junk payload = wrong server) using the existing `classifyFetchError` machinery, and coach per reason. Chrome's Private Network Access preflights add a slow-moving ceiling: probing localhost from a localhost-served Mayon works today, but LAN-IP/domain deployments degrade as Chrome tightens enforcement — a monitoring burden, not a blocker today. And port 8000 is a wildly common dev default (FastAPI, Django): validate the `/v1/models` response shape, never trust a port.
- **Snags**: The LM Studio catch-22 — the flagship first-touch runtime is invisible by default — bites the user detection exists for, unless failure reasons are classified and coached. False positives on shared dev ports (e.g. 8000) — bites early without strict payload validation. PNA tightening for non-localhost deployments — bites slowly, over months, as browser enforcement lands. Detection is per-browser — finds runtimes on _my machine_, never on my network — and nothing here touches cloud-provider findability.
- **Trade-offs**: Background probe traffic and console noise on every picker open; scope-creep pressure ("detect everything, everywhere"); a failure mode surface (silent/ambiguous states) that must be designed, not defaulted.
- **Delivers the what?**: Findability for local runtimes — spectacularly (found, not searched); local onboarding — zero-config when detection works, coached when it doesn't; the cloud half of the what — untouched.
- **Difficulty vs payoff**: difficulty M–L · payoff H · time-to-first-value ~2–3 weeks
- **Your take**: User: "card 005 is too much scope i think" — rejected; detection-and-coaching states noted as sequel material for a future idea.

# Contract: Mock LLM Reasoning Frames (protocol extension)

**Feature**: 029-micro-thoughts | **Owner**: `tests/fixtures/mock-llm/server.mjs` (test
fixture only; production server untouched)

Extends the mock OpenAI-compatible SSE protocol documented in
`docs/history/appendices/020-mock-llm-protocol.md` so interleaved reasoning is testable
offline end-to-end.

## New capability: `reasoning_content` delta frames

Because Mayon's provider is `@ai-sdk/openai-compatible` (parses
`delta.reasoning_content ?? delta.reasoning`, closes/re-opens segments around content —
see [stream-segments.md](./stream-segments.md)), the mock only needs to emit additional
delta shapes. No handshake or capability advertisement exists or is needed.

### Frame shapes

```jsonc
// reasoning delta (same envelope as content frames)
{"choices":[{"index":0,"delta":{"reasoning_content":" considering the date..."},"finish_reason":null}]}

// content frames unchanged
{"choices":[{"index":0,"delta":{"content":"The answer is 4."},"finish_reason":null}]}
```

Terminal frames unchanged (`finish_reason:"stop"` + `data: [DONE]`).

### Trigger: interleaved script

- **Trigger**: the LAST user message contains the literal marker
  `[[interleaved-thoughts]]` (exact token; case-sensitive) AND the request has no tools
  (plain chat stream path, `server.mjs` classification :275-329).
- **Behavior**: stream an interleaved sequence, each frame every `CHUNK_INTERVAL_MS`:
  1. ≥2 reasoning deltas, then 1–2 content deltas,
  2. ≥2 reasoning deltas again (forces the provider to re-open a segment AFTER text —
     the defect case), then 1–2 content deltas,
  3. one final short reasoning delta with NO trailing content (trailing-thought edge
     case),
  then the normal `stop` terminal with the fixed usage frame.
- Marker MUST be removed from what a "user-visible" echo might show — it is plain user
  text; no special handling needed beyond the trigger check.

### Non-goals

- No `reasoning_details`, no `<think>` raw-tag frames (Groq `raw` format), no tool-call +
  reasoning combined script, no Responses-API event shapes — the openai-compatible chat
  path is the app's only wire to the mock, and provider segmentation is already covered
  by SDK behavior. Scripted fullStream unit tests
  (`src/lib/agent/loop.test.ts` pattern) cover exotic part sequences directly.

## Compatibility

- Absence of the marker ⇒ zero behavior change for all existing mock flows
  (`chat_stream`, `chat_plain`, tool propagation, non-streamed kinds).
- Frames carry no usage impact (fixed usage frame as today).

## Verification hooks

- `tests/fixtures/mock-llm/README.md` and the protocol appendix gain a short section
  describing the marker and the frame order (this file is the normative reference).
- Quickstart scenario 1 (interleaved stream in the dev stack) depends on this contract.

# Contract: mock-llm HTTP API

The HTTP contract the `mock-llm` test service MUST serve. Verified against the pinned
client stack (`ai@^7.0.4`, `@ai-sdk/openai-compatible@^3.0.2`) — see
[../research.md](../research.md) for the code references behind every clause.

## Base

- URL as configured in the onboarded provider: `http://mock-llm:<port>/v1`
- Reachability: **server container only** (compose default network). No host port.
- Auth: requests carry `Authorization: Bearer <placeholder>`; the mock MUST accept and
  MAY ignore it. No 401 paths.

## POST {base}/chat/completions

Single endpoint serving both modes. Mode is selected by the request body's `stream`
field. MUST handle concurrent requests (first turn fires up to 3 concurrently).

### Request fields consumed

- `stream: true | undefined` — mode selector
- `model` — echoed back in responses (whatever `defaultModel` the provider card holds)
- `messages` — standard OpenAI chat array (system prompts included); the mock does not
  need to interpret content
- `tools` — may appear on the brief-inference call (a `json` tool); MUST be tolerated
  and ignored

### Streaming mode (`stream: true`)

Response: `200`, `content-type: text/event-stream`, body of SSE frames:

1. First frame: role delta —
   `data: {"id":"<id>","model":"<model>","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}`
2. Content frames: the kitchen-sink reply split across **multiple** `delta.content`
   string chunks (chunk boundaries are arbitrary but MUST be >1 chunk so streaming
   render is actually exercised)
3. Terminal frame: **REQUIRED** — a chunk with `choices[0].finish_reason` (e.g.
   `"stop"`); without it the SDK raises "Response stream ended without a finish reason"
4. Optionally `data: [DONE]` (explicitly ignored by the client)

`usage` MAY be included on the terminal frame. `reasoning_content`/`reasoning` deltas
MUST NOT be emitted (default effort baseline has none; keeping them out keeps the
fixture deterministic across reasoning-effort work).

### Non-streaming mode (no `stream`)

Response: `200`, `content-type: application/json`:

```json
{
  "id": "<id>",
  "model": "<model>",
  "choices": [
    { "message": { "role": "assistant", "content": "<plain prose>" }, "finish_reason": "stop" }
  ],
  "usage": { "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2 }
}
```

Callers: title generation and brief inference — their failures are swallowed by the
app, but correct replies keep the suite deterministic. Content SHOULD be plain prose
(no markdown) drawn from the fixture document.

## GET {base}/models

Response: `200`, JSON `{"data":[{"id":"mock-sink","object":"model"}]}`.

Constraints: exactly one non-embedding entry (`type` omitted or non-`"embedding"`);
`id` MUST match the provider card's Default model so discovery and sending agree.

## Error behavior

- Any other path → `404` (plain).
- Malformed JSON body → `400` (fail fast in test setup rather than hanging).
- The mock MUST respond immediately (no artificial latency): determinism over realism.

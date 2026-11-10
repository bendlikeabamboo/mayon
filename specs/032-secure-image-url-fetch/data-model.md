# Data Model — 032 secure-image-url-fetch

No persisted entities change (no drizzle schema edits, no migrations, no repository changes —
the `StorageDriver` seam is untouched). The only data-shape change is a wire-protocol field.

## Entity: `LlmProxyRequest` (wire contract, `@mayon/shared`)

Existing shape (`packages/shared/src/protocol.ts:45-50`):

```ts
export interface LlmProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
```

**Change**: add one optional field.

```ts
export interface LlmProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /** Hostname the credential headers in `headers` are intended for (032).
   *  The relay forwards authorization / x-api-key / x-goog-api-key only when
   *  this equals the target URL's hostname (normalized); absent or mismatched
   *  → those headers are stripped before the upstream fetch. */
  authHost?: string;
}
```

**Validation rules** (relay side, `server/src/llm-proxy.ts`):

- `authHost`, when present and a string, is normalized (lowercase, trailing `.` stripped,
  IPv6 brackets stripped) and compared for exact equality against the normalized target
  hostname. No subdomain/prefix matching.
- Unknown/absent/invalid `authHost` → credential headers stripped (fail-closed).
- Non-string `authHost` is ignored (treated as absent); it never fails the request on its own.

**State transitions**: none (request-scoped, stateless).

## Entity: credential allowlist (derived, not stored)

Per active provider: the allowlist is the singleton
`normalizeHostname(new URL(config.baseUrl).hostname)` — computed at fetch construction time in
`providerFetchFor` (`src/lib/ai/sdk-factory.ts`), never persisted anywhere. Providers whose
`baseUrl` fails to parse omit the gate (legacy attach behavior) — an unreachable state in
practice (configs are URL-validated at creation).

## Constants introduced (single sources of truth)

| Constant | File | Value |
| --- | --- | --- |
| `MAX_PROXY_RESPONSE_BYTES` | `server/src/llm-proxy.ts` | `64 * 1024 * 1024` |
| `IMAGE_FETCH_MAX_BYTES` | `src/lib/chat/images.ts` | `32 * 1024 * 1024` |
| `IMAGE_FETCH_TIMEOUT_MS` (existing) | `src/lib/chat/images.ts` | `15_000` (unchanged) |
| `CREDENTIAL_HEADERS` (strip set) | `server/src/llm-proxy.ts` | `authorization`, `x-api-key`, `x-goog-api-key` |

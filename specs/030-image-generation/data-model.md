# Data Model: Model-Generated Images in Chat (030)

**Date**: 2026-11-09
**Spec**: [spec.md](spec.md) · **Research**: [research.md](research.md)

No new tables, columns, or migrations. The feature extends how three existing things are **used**; the only new persistent field is one settings-level provider flag.

## Entities

### Message row (existing table `messages`, extended usage)

Defined at `src/lib/db/schema.ts:62-106`. A row of kind `assistant_message` (or `branch_artifact`, see below) may now carry a non-null `parts` JSON-text column alongside `content`.

- **Fields (existing)**: `content` (canonical flat text), `parts` (JSON `MessagePart[]`), `kind`, `metadata`, `ord`, plus existing columns.
- **New rule (by usage, not schema)**: assistant rows may carry parts; `content` remains the concatenation of the row's text parts, exactly (repo-enforced).
- **Relationships**: unchanged — belongs to a conversation, ordered by `ord`.

### MessagePart / ImagePart (existing union, new allowed origin)

Defined at `src/lib/chat/kinds.ts:168-183`.

- `TextPart = { type: 'text'; text: string }`
- `ImagePart = { type: 'image'; data: string /* base64 data-URL */; mimeType: string; width: number; height: number; bytes: number; name?: string }`
- `MessagePart` is an open union (`{ type: string }` catch-all) — unknown kinds survive round-trips untouched.

New semantics for 030:

- An `ImagePart` on an `assistant_message` row is **model-generated** (delivered in the reply); on a `user_message` row it is user-attached (018). Same shape, same renderer.
- Ordering within `parts` is the model-authored sequence; text parts between images concatenate (in order) to `content`.
- `name` (optional) doubles as alt text at render time; for generated images it carries the model-provided label/description when one exists, else a synthesized label (e.g. `Generated image 1`).
- Image-only replies: `content = ''`, no text parts — legal, unsearchable (see Validation).

### Branch artifact row (kind `branch_artifact`, extended usage)

- `insertAnchored` (`src/lib/db/repositories/messages.ts:156-195`) gains an optional `parts` parameter; artifact rows may now carry the propagated turns' `ImagePart`s (≤8, as everywhere).
- Raw-mode payload text gains positioned `[image]` markers where each image sat in the source turn.
- `metadata` (`BranchArtifactMetadata`, `src/lib/chat/kinds.ts:149-157`) is unchanged.

### Provider capability flag (settings KV, new field)

`ProviderConfig` (`src/lib/ai/types.ts:131-188`) gains:

- `imageOutput?: 'auto' | 'on' | 'off'` — sibling of `vision` (164-172). Non-secret handle field (constitution-compliant; keys stay in KeyStore/IndexedDB).
- Companion static allowlist `IMAGE_OUTPUT_MODEL_PREFIXES` + resolver `supportsImageOutput(config, modelId)` in a new module mirroring `src/lib/ai/vision-capability.ts`.

### Turn-scoped ephemeral state (not persisted)

During a streaming reply (`src/lib/stores/chat.svelte.ts` turn lifecycle):

- `pendingImages: ImagePart[]` — complete, recognized image parts awaiting finalize; ordered by arrival relative to text accumulation.
- Live rendering shows a bounded placeholder while non-empty; the array drains into the durable row's `parts` at `appendAssistantText` finalize, or into the interrupted row on abort.

## Validation rules

From `messagesRepo.append` (`src/lib/db/repositories/messages.ts:32-50`) — applied role-agnostically, now including assistant rows:

1. `parts`, when present, must be a non-empty array.
2. At most **8 image parts** per row.
3. Text parts must concatenate **exactly** to `content`.
4. (030 addition) Persisted image payload bounded so the row's insert fits the 16 MiB `/api/db/query` request envelope; output-side caps enforced before finalize (oversized images re-encoded down via the existing canvas pipeline rather than rejected).

From the capability contract (research R-7):

5. `imageOutput` is advisory only — it MUST NOT gate, block, or rewrite any request payload.

## State transitions

Turn lifecycle (one assistant reply):

```text
streaming ──text-delta──▶ streamBuffer (string, paced)
streaming ──image part──▶ pendingImages[i] (atomic; live placeholder only)
finish ─────────────────▶ critic (optional; keeps pendingImages)
finalize ───────────────▶ append(chatId,'assistant', content, {model, parts:[…text+images in order]})
   │                        └─ single atomic row; success leaves no partial state
abort/error ────────────▶ append(…, {parts: pendingImages, metadata:{interrupted:true}})
                          └─ complete images kept with partial text
```

Branch propagation:

```text
branch turns (assistant rows with images)
  ─▶ raw payload: text + positioned [image] markers
  ─▶ artifact row: {content: payload, parts: images (≤8), kind:'branch_artifact'}
  ─▶ parent transcript: renders via shared image presentation; projects to models as text only
```

## Invariants preserved (constitution)

- `search_vec` derives from `content` only (`packages/shared/src/fts.ts:4`); image bytes never enter it — inherited from the 018 construction, guarded by `src/lib/db/repositories/search.test.ts:284-349`.
- Images render outside the Markdown pipeline; sanitize schema and expound sourcemap/DOM alignment are untouched (segmented rendering keeps offsets derivable; containment fallback = menu disable, per research R-5).
- Backup/restore rides `pg_dump`/`pg_restore` untouched — parts are row data, proven by the 018 restore tests and `server/src/pg-import.test.ts:388-425`.

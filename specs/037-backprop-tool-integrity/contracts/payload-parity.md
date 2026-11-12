# Contract: Propagation payload parity (037)

Governs US1/US5/US6 of `specs/037-backprop-tool-integrity/spec.md`. Amends
`specs/027-backprop-tool/contracts/propagate-tool.md` (execution contract, payload
step) in place — see the 037 cross-references there.

## Chrome exclusion set

A branch-timeline row is **propagation chrome** — excluded from every propagation
payload — iff:

```text
row.toolName === 'propagate_to_parent'
```

This covers exactly three row shapes (all carry `toolName`):

| Row | Shape |
| --- | --- |
| tool call | `role: 'assistant'`, `kind: 'tool_call'` (or kind derived from columns), content `''`, `toolCallId` set — persisted before execution |
| approval ask | `kind: 'approval'`, content `"<toolName> — <description>"`, `toolCallId` set |
| tool result | `role: 'tool'`, `kind: 'tool_result'`, content = result summary (incl. `'user declined'`) |

Every other row — user rows, assistant rows, reasoning, other tools' calls/asks/
results, artifacts — is payload content, verbatim, in `ord` order, exactly as the
pre-037 renderer produced it.

Rules:

1. The exclusion applies inside `buildRawPayload` (rendered turns AND collected
   images) and `collectPropagatedImages`, i.e. to BOTH the tool path
   (`deterministic-tools.ts`) and the manual path (`chat.svelte.ts`).
2. A branch whose rows are all chrome yields the empty-turns payload (excerpt rules
   unchanged) — no special case.
3. The branch timeline itself is never modified by exclusion (rows are durable
   history; only the payload projection filters).

## Byte-identity guarantee

For the same branch conversation content (all rows ignoring propagation chrome), the
artifact payload produced via the `propagate_to_parent` tool MUST equal the payload
produced via the manual control, byte for byte: same excerpt resolution, same turn
rendering, same image collection. Both paths share the same builders, so parity holds
by construction; the regression tests pin it against drift.

## Image collection (dedupe + cap)

Collected image parts (both collection paths; also regeneration, US6):

1. Source rows: branch rows in `ord` order, chrome excluded (set above).
2. **Dedupe**: by `part.data`, first occurrence wins, order preserved — applied
   BEFORE the cap.
3. **Cap**: first 8 images after dedupe (repo-wide image cap, unchanged).

Rendering (US5): the artifact image grid MUST NOT key thumbnails solely by image
data; the composite key is `image.data + ':' + index` (Composer pattern,
`src/lib/components/chat/Composer.svelte:418`) so pre-037 rows already storing
duplicates render without duplicate-key errors.

## Regeneration parts update (US6)

`messagesRepo.updateArtifactContent(id, content, metadataPatch, parts?))`:

- `parts: MessagePart[]` — validated by the existing parts invariant (non-empty,
  ≤ 8 image parts, text parts concatenate exactly to `content`), stored atomically
  with content + metadata in ONE update;
- `parts: null` — clears the column to NULL (image-less result);
- `parts: undefined` — column untouched (backwards compatibility).

`regenerateArtifact` passes `artifactParts(summary, collectPropagatedImages(source)) ??
null` — regeneration mirrors fresh propagation's collection rules (chrome exclusion,
dedupe, cap). Failure or abort changes nothing (all-or-nothing).

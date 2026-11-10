# Data Model — Image Output Finalize & Follow-Up Paths (Feature 033)

Phase 1 output. **No database schema changes.** This feature extends in-flight shapes and
composition rules only; the persisted `messages` row shape is already sufficient (030
message-parts contract). Entities below extend the existing ones.

## Entities

### Assistant reply row (existing `messages` row, extended usage)

Fields relevant here (unchanged columns): `content` (canonical flat text), `parts` (nullable
JSON `MessagePart[]`), `metadata` (`interrupted?: true`), `model`, `ord`.

New usage rules (this feature):

| Rule | Source | Validation |
| --- | --- | --- |
| Image-only rows: `content = ''`, parts = images only, no text parts | FR-002, 030 §1 | `validateParts` already permits (text concat = `''`); enforced by composition |
| Interleaved parts: multiple text parts allowed, images between them, **in arrival order** | FR-005, 030 §4 | `validateParts` concat invariant holds by construction (text split at image offsets) |
| ≤ 8 image parts per row, cap applied at finalize with a drop notice | FR-004 | `validateParts` backstop; proactive slice in `composeAssistantParts` |
| Aborted rows carrying parts get `metadata.interrupted: true` | FR-003 | existing store logic (`aborted && parts`) |
| Dropped/corrupt images yield bracketed notices appended to `content` (and its final text part) | FR-004/FR-006 | notice text participates in the concat invariant; FTS stays self-maintaining |

### Stream-recognized image candidate (extended finalize handoff shape)

The loop→store handoff (`appendAssistantText` opts `images` entries) extends
`ImageCandidate` (`{ mediaType?, base64? | url? }`) with:

- `offset?: number` — character offset into the owning row's text where the image arrived
  (captured as the streaming text buffer length at recognition). Optional: absent = append
  after text (legacy position, also the critic-replacement path).

State transitions: recognized (sink push, offset stamped) → assigned to a row by offset range
in `walkPersist` → materialized (URL fetch, 032) → validated (sniff) → capped (8) → budgeted
(bytes) → composed into ordered parts, or dropped-with-notice at any of validate/cap/budget.

### Turn image accumulator & recognized counter (in-flight only)

- `turnImages` (loop): caller-owned accumulation across iterations; `consumeStream` pushes into
  the same array at recognition so aborts cannot lose completed images.
- `streamRecognizedImages` (store, per turn): count incremented via `onImageRecognized`; reset
  at send start; consumed by the failure refinement and the zero-image notice. Independent from
  `pendingImages` (which only reflects images handed to a finalize append).

### Finalize-call marker

`appendAssistantText` opts gain `final?: boolean` — true only on the turn's finalize appends
(walk/critic path, budget path, and abort persists of the final iteration); false/absent on
interim tool-boundary persists. Drives the zero-image notice placement (D7).

## Invariants (validation rules carried into tasks)

1. Text parts of any composed row concatenate byte-for-byte to `content` (repo-enforced).
2. At most 8 image parts per row (repo-enforced; finalize caps first with notice).
3. Image-less turns keep today's exact append shape: parts omitted, 1-arg interim calls
   unchanged (byte-identical history).
4. Persisted image payloads fit the output budget (per-image / per-row caps) — `applyOutputBudget`
   never rejects; per-image failure drops with notice.
5. Notices are plain-language, bracketed, appended to `content` (searchable, contained); never
   raw provider dumps; never markdown image syntax (sanitize strips `data:` URIs).
6. Assistant wire projection for images is `file` parts only (SDK `AssistantContent` constraint),
   gated on vision capability; user projection unchanged.

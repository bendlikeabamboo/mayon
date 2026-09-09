# Phase 1 Data Model: Smooth Streaming (022)

**Date**: 2026-09-09 · No database schema changes. One new persisted settings-KV value; all other state is transient client presentation state.

## Entity 1: Streaming appearance preference (persisted)

| Aspect | Value |
|---|---|
| Storage | `settings` KV table (`key` PK, `value` JSON text) — existing |
| Key | `streamPreset` (camelCase, per 012-settings-keys convention) |
| Value | One of `"calm" \| "standard" \| "expressive"` (JSON string) |
| Default | `"standard"` — resolved at read time on missing/corrupt/wrong-typed value (no migration, no `seedDefaults` entry) |
| Writer | Solely `setStreamPreset()` in `src/lib/chat/streaming/pref.ts` |
| Readers | `getStreamPreset()` accessor; chat page onMount → `chatStore` |
| Validation | Narrow to the union on read; anything else → default (defensive-read rule, appendix 012) |
| Lifecycle | Written from the settings UI (optimistic save, revert on error); effective on the next stream (and the running stream — preset is read per flush) |
| Backup/restore | Captured automatically with the settings table; no special handling |

## Entity 2: Pacer state (transient, per active stream)

Lives inside the pacer module instance owned by `ChatState` for the duration of a turn. No persistence.

| Field | Type | Meaning / rules |
|---|---|---|
| `mode` | `'idle' \| 'streaming' \| 'draining' \| 'flushed'` | `streaming`: text arriving; `draining`: stream ended, easing out remainder; `flushed`: everything arrived is visible (also the abort/error terminal); `idle`: no turn |
| `releasedLength` | number | Character offset into the raw buffer currently visible (`streamBufferRender = streamBuffer.slice(0, releasedLength)` after word-snap) |
| `lastSnap` | number | Length actually released after boundary snapping (≤ `releasedLength`; lookback window ≤ 12 chars) |
| `endedAt` | number \| null | Timestamp of stream end → starts drain ramp; drain hard-bounded ≤ ~1 s total |
| `aborted` | boolean | Abort/error observed → next tick releases everything instantly (FR-005) |

### State transitions

```text
idle ──send()──▶ streaming
streaming ──delta──▶ streaming        (release ticks: word-snapped, adaptive rate)
streaming ──buffer shrink (critic reset)──▶ streaming (releasedLength ← 0)
streaming ──stream end──▶ draining    (ramp rate; edge lift transition armed)
streaming ──abort/error──▶ flushed    (instant full release; store persists raw buffer immediately)
draining ──buffer empty (≤ ~1 s)──▶ flushed (store finalizes: appendAssistantText + teardown, as today)
flushed ──teardown──▶ idle
```

### Validation rules (asserted by tests as bands, per `stagger.test.ts` convention)

- Visible text never splits a word: release index snaps to whitespace/word/block boundary (FR-002).
- While `streaming`: hidden backlog stays within the accepted window (≈ a few hundred ms worth of chars; adaptive rate guarantees catch-up) (FR-003, SC-002).
- While `draining`: everything visible within ~1 s of end; no single tick may release more than a bounded share of the backlog once the ramp starts (FR-004, no terminal dump).
- `flushed` is reached from any mode on abort; nothing arrived may remain hidden (FR-005).
- Reset tolerance: `releasedLength` never exceeds raw length (critic-phase buffer clears).

## Entity 3: Growth-edge overlay state (transient, live row only)

Component-local to `GrowthEdge.svelte`; exists only while the live branch renders.

| Field | Type | Rules |
|---|---|---|
| `variant` | `'blur-fade' \| 'caret'` | Derived from preset: `expressive` → `blur-fade`; `calm` → `caret`; `standard` → component not mounted |
| `edgeRect` | measured rect \| null | Recomputed on each render flush from the trailing text of the last block in the live markdown body; `null` → hidden |
| `suppressed` | boolean | True when the growth edge is a code block or table (FR-008: suppress); lists → soften (weaker/shorter blur), not suppress |
| `lifting` | boolean | Armed at stream end; runs the short un-blur/caret fade-out transition in step with the pacer's drain completion (FR-007) |

## Entity 4: Chat store presentation fields (existing, semantics extended)

| Field | Change |
|---|---|
| `streamBuffer` | **Unchanged** — raw accumulator, persistence contract |
| `streamBufferRender` | Now produced *through the pacer* (safe prefix) instead of verbatim copy; on abort/error it equals `streamBuffer` instantly (existing `finally` flush semantics preserved) |
| `streamPreset` (new) | `$state<StreamPreset>('standard')`, loaded from `getStreamPreset()` at chat page mount; read per flush by the pacer and by the live row |
| Finalization | On normal finish, `appendAssistantText(raw)` + buffer teardown run after drain completes (≤ ~1 s); abort/error path unchanged (immediate, `interrupted: true`) |

## Relationships

- `streamPreset` (1) → configures → pacer behavior (cadence active in `calm` + `expressive`; `standard` = passthrough) and overlay variant.
- Pacer state (1) → feeds → `streamBufferRender` (render copy) and `draining → flushed` timing that the overlay's `lifting` transition syncs to.
- Overlay (0..1 per live row) → mounts inside → live branch of the single in-flight `AssistantMessage`; never on durable rows.

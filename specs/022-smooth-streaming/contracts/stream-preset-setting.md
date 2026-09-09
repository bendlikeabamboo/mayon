# Contract: `streamPreset` settings key

Settings-KV contract following `docs/history/appendices/012-settings-keys.md` (JSON-scalar value, defensive reads with documented defaults, single authorized writer, no secrets). Modeled on the existing rendering-pref precedent `sectionStripEnabled` (`src/lib/chat/strip/pref.ts`) and the enum-narrowing precedent `reasoningEffort` (`src/lib/ai/client.ts:43-46`).

## Key

| Field | Value |
|---|---|
| Key | `streamPreset` |
| Value type | JSON string, one of `"calm" \| "standard" \| "expressive"` |
| Default | `"standard"` (today's behavior — spec FR-012) |
| Migration | None. Schema-less KV row; default resolved at read time; **not** added to `seedDefaults()` (rendering-pref precedent) |
| Persistence | Postgres via `repos.settings` (server-synced, included in backups) |

## Module API (`src/lib/chat/streaming/pref.ts`)

```ts
export type StreamPreset = 'calm' | 'standard' | 'expressive';

export const STREAM_PRESET_KEY = 'streamPreset';

/** Preset → behavior map. Extensible: new presets add entries here + a label,
 *  not a new setting (FR-014). */
export const STREAM_PRESET_OPTIONS: readonly StreamPreset[];
export const STREAM_PRESET_LABELS: Record<StreamPreset, string>;

/** Defensive read: miss / corrupt JSON / unknown value → 'standard'. */
export async function getStreamPreset(): Promise<StreamPreset>;
/** Sole authorized writer. */
export async function setStreamPreset(v: StreamPreset): Promise<void>;
```

## Behavior contract

| Preset | Cadence (paced release) | Growth-edge visual |
|---|---|---|
| `standard` | Off — verbatim render copy (today's behavior, byte-for-byte) | None |
| `calm` | On | Plain caret at the growth edge (no blur) |
| `expressive` | On | Soft blur/fade at the growth edge |

- Default `standard` MUST render a stream exactly as pre-feature code (regression guard: existing `chat.svelte.test.ts` streaming tests pass unchanged when the preset is unset).
- Preset changes apply to the next stream and the running stream (read per flush); no reload required (SC-004).
- The value MUST persist across sessions and devices (settings KV semantics).

## UI contract

- Location: appearance/chat section, `src/lib/components/settings/ChatDisplayConfig.svelte` (mounted at `settings/+page.svelte` `#chat`).
- Control: labeled native `<select bind:value>` over `STREAM_PRESET_OPTIONS` with `STREAM_PRESET_LABELS` (markup pattern: `LearnerProfileConfig.svelte:130-137`).
- Save: optimistic — set local state, `await setStreamPreset(next)`, revert on error (pattern: `ChatDisplayConfig.svelte:14-22`).
- Optional: add `'streaming'`/`'appearance'` aliases to the `chat` entry in `src/lib/settings/sections.ts:13` for settings search/jump.

## Consumer wiring

Chat page (`src/routes/chat/[id]/+page.svelte`) loads the preset on mount into `chatStore` (pattern: `stripEnabled` at `+page.svelte:492`) → store field `streamPreset` gates (a) whether the flush consults the pacer and (b) the live-row overlay variant.

## Tests (mirror `strip/pref.test.ts`)

- Key-name stability (`STREAM_PRESET_KEY === 'streamPreset'`).
- Default on miss, corrupt JSON, and unknown/wrong-typed value → `'standard'`.
- Round-trip set/get.
- Existing streaming store tests pass with preset unset (standard passthrough).

# Contract: Settings-KV UI State Keys

**Scope**: Client-persisted UI preferences introduced by this feature, stored through the existing settings key-value mechanism (`repos.settings.get/set/delete`, JSON values) — **no schema migration**.

## Precedent being extended

String-convention keys already in production use:
- `'draft:<chatId>'` — composer draft text
- `'theme'` — theme preference (mirrored with localStorage)
- `'reasoningEffort'` — global default effort

## New keys

### `ui-state:<chatId>:briefExpanded`

| Aspect | Contract |
|---|---|
| Purpose | Remembers expanded/collapsed state of the consolidated header summary chip's detail panel, per chat (FR-19 scenario: state survives close/reopen per chat while other chats keep their own values) |
| Value shape | `true \| false` (JSON boolean) |
| Default when absent | untitled/new chat ⇒ treated as expanded · titled chat ⇒ collapsed (chevron visible once title exists) |
| Writer | `src/lib/chat/uiState.ts` exclusively |
| Readers | chat page header chip component |
| Visibility | main-screen persistent behavior — expansion happens inline, never as modal-only flow (GP-3) |

## General rules for `ui-state:*` keys

1. Namespace is reserved for view-state keyed by entity id: `ui-state:<entityId>:<facet>`. Add future facets here rather than inventing sibling conventions.
2. Values must be small JSON scalars/plain objects; this namespace is not a data store for content.
3. Reads are defensive: missing key, corrupt JSON, or wrong type falls back to documented defaults without throwing (settings repo returns null on miss — helpers normalize).
4. Orphaned keys after entity deletion are acceptable today (matches existing draft-key precedent); no cascade cleanup machinery may be built for them.
5. Nothing in this namespace may hold secrets or provider credentials (constitution I).

## Testing obligations

- `uiState.ts` unit tests: round-trip set/get, absent-key default resolution (titled vs. untitled), corrupt-value fallback, key naming stability (assert literal `"ui-state:"` prefix composition).

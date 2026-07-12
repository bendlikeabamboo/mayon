# Phase 0 — Remove Tauri, collapse to browser-only

Source of truth: `.kilo/plans/1783749811883-container-forward-web-transition.md` (P0 section).
This plan is the implementation task list extracted and refined from the master plan.

## Pre-flight check

Before starting, run:
```bash
rg '@tauri-apps' src
rg 'isTauri' src
```
to catalog every reference. After all edits, run the same commands — both must return zero results.

---

## Task 1 — Strip Tauri from `package.json`

**File:** `package.json`

- **Delete deps** (lines 43-47):
  - `@tauri-apps/api`
  - `@tauri-apps/plugin-dialog`
  - `@tauri-apps/plugin-process`
  - `@tauri-apps/plugin-sql`
  - `@tauri-apps/plugin-updater`
- **Delete devDep** (line 80):
  - `@tauri-apps/cli`
- **Delete scripts** (lines 21-24):
  - `tauri`, `tauri:dev`, `tauri:build`, `tauri:icon`
- Run `pnpm install` to regenerate lockfile.

## Task 2 — Delete Tauri desktop shell

```bash
rm -rf src-tauri/
rm rust-toolchain.toml
```

## Task 3 — Clean build/config ignores

- **`.dockerignore`** — remove lines 5-6 (`src-tauri/target/`, `src-tauri/gen/`) and line 11 (`.tauri/`)
- **`.gitignore`** — remove lines 12-14 (`# Tauri / Rust`, `src-tauri/target/`, `src-tauri/gen/schemas/`, `# (Cargo.lock IS committed...)`) and line 41 (`.tauri/`)
- **`.prettierignore`** — remove lines 4-5 (`src-tauri/target/`, `src-tauri/gen/`)
- **`eslint.config.js`** — remove `'src-tauri/'` from `ignores` array (line 13)

## Task 4 — Delete CI release workflow (Tauri-only)

- Delete `.github/workflows/release.yml` — the entire workflow builds Tauri desktop installers.

## Task 5 — Collapse `src/lib/db/driver/client.ts`

This is the central runtime fork. Changes:

1. Keep `isTauri()` export but make it return `false`:
   ```ts
   export function isTauri(): boolean {
     return false;
   }
   ```
   (Still consumed by many files; collapsed to false so all downstream code takes the browser path. Removed entirely in Phase 1.)

2. In `createDriver()` — remove the `isTauri()` branch (lines 22-25):
   ```ts
   async function createDriver(): Promise<StorageDriver> {
     if (!opfsAvailable()) {
       throw new Error(
         'OPFS is not available in this browser. Use a modern browser with OPFS enabled.'
       );
     }
     const { createOpfsDriver } = await import('./opfs-driver');
     return createOpfsDriver();
   }
   ```
   Note: the error message changed — removed "Use the Mayon desktop app" since that no longer exists. The P1 sidecar hint can be added later but for P0 keep it simple.

3. In `bootstrapDb()` — simplify runtime (line 60):
   ```ts
   const runtime: DbRuntime = 'browser';
   ```

## Task 6 — Delete `src/lib/db/driver/tauri.ts`

```bash
rm src/lib/db/driver/tauri.ts
```

## Task 7 — Collapse `src/lib/ai/http-transport.ts`

1. Remove `import { isTauri } from '$lib/db';` (line 12)
2. Remove `import { createTauriTransport } from './tauri-transport';` (line 15)
3. In `getHttpTransport()` (line 77):
   ```ts
   export function getHttpTransport(): HttpStreamTransport {
     if (cached) return cached;
     cached = createFetchTransport(createBrowserKeyStore());
     return cached;
   }
   ```

## Task 8 — Delete `src/lib/ai/tauri-transport.ts` + test

```bash
rm src/lib/ai/tauri-transport.ts
rm src/lib/ai/tauri-transport.test.ts
```

## Task 9 — Collapse `src/lib/ai/sdk-fetch.ts`

1. Remove `import { isTauri } from '$lib/db';` (line 1)
2. Remove `import { getHttpTransport } from './http-transport';` (line 4) — no longer used here
3. Simplify `createKeychainFetch()`:
   ```ts
   export function createKeychainFetch(auth: KeychainFetchAuth): typeof globalThis.fetch {
     return createBrowserKeychainFetch(auth);
   }
   ```
4. Delete the entire `createDesktopKeychainFetch` function (lines 47-113) — dead code.
5. Delete helper functions only used by desktop fetch:
   - `headersToRecord` (lines 116-131) — check if used elsewhere first
   - `concatChunks` (lines 133-144) — check if used elsewhere first
   
   Actually, grep for usage — `headersToRecord` and `concatChunks` are only used by `createDesktopKeychainFetch`. Delete them.

## Task 10 — Collapse `src/lib/ai/keystore/client.ts`

```ts
import { createBrowserKeyStore } from './browser';
import type { KeyStore } from './types';

export function createKeyStore(): KeyStore {
  return createBrowserKeyStore();
}
```

## Task 11 — Delete `src/lib/ai/keystore/desktop.ts`

```bash
rm src/lib/ai/keystore/desktop.ts
```

## Task 12 — Update `src/lib/ai/keystore/types.ts`

Update the doc comment to remove desktop/Tauri references:
```ts
/**
 * The runtime-agnostic secret store seam. Implementation: browser
 * (`browser.ts`): IndexedDB — the fetch transport reads the key back
 * into the auth header because the browser has no secure enclave.
 */
```

## Task 13 — Delete `src/lib/mcp/stdio.ts` + test

```bash
rm src/lib/mcp/stdio.ts
rm src/lib/mcp/stdio.test.ts
```

## Task 14 — Update `src/lib/mcp/client-factory.ts`

1. Remove `import { isTauri } from '$lib/db';` (line 1)
2. Remove `import { StdioMcpTransport } from './stdio';` (line 6)
3. Replace stdio branch with clear error:
   ```ts
   if (config.transport === 'stdio') {
     throw new Error('stdio MCP servers require the Mayon sidecar (coming soon)');
   }
   ```
4. Simplify the HTTP branch — remove `isTauri()` secretResolver fork:
   ```ts
   if (config.transport === 'http') {
     if (!config.url) throw new Error('MCP server URL is required');
     const secretResolver: (keyId: string) => Promise<string | null> = async (keyId) =>
       createBrowserKeyStore().get(keyId);
     return new HttpMcpTransport({
       serverId: config.id,
       url: config.url,
       headers: config.headers,
       callTimeoutMs: config.callTimeoutMs,
       secretResolver
     });
   }
   ```

## Task 15 — Update `src/lib/mcp/lifecycle.ts`

1. Remove `isTauri` from the `$lib/db` import (line 10):
   ```ts
   import { repos } from '$lib/db';
   ```
2. The stdio skip condition on line 68 becomes always-true (stdio always skipped):
   ```ts
   if (config.transport === 'stdio') {
     console.info(`[mcp] skipping stdio server in browser (sidecar not connected): ${config.name} (${config.id})`);
     continue;
   }
   ```
   (The `isTauri()` guard was redundant with the `createMcpTransport` throwing — but it prevented the unnecessary factory call. Keep the guard, just drop the `isTauri()` check. P2 will change this to `!sidecarStatus.connected`.)

## Task 16 — Update `src/lib/mcp/templates.ts`

Change description copy for stdio templates: "Desktop only" → "Requires the Mayon sidecar".
The `platforms: ['desktop']` field stays for now (repurposed to sidecar semantics in P2).

Changes:
- Line 7: "...Desktop only." → "...Requires the Mayon sidecar."
- Line 31: "...Desktop only." → "...Requires the Mayon sidecar."
- Line 41: "...Desktop only." → "...Requires the Mayon sidecar."
- Line 52: "...Desktop only." → "...Requires the Mayon sidecar."
- Line 63: "...Desktop only." → "...Requires the Mayon sidecar."

## Task 17 — Delete updater files

```bash
rm src/lib/updater.svelte.ts
rm src/lib/components/UpdaterBanner.svelte
```

## Task 18 — Update `src/routes/+layout.svelte`

1. Remove `import UpdaterBanner from '$lib/components/UpdaterBanner.svelte';` (line 8)
2. Remove `import { isTauri, repos } from '$lib/db';` → change to:
   ```ts
   import { repos } from '$lib/db';
   ```
3. Remove `import { updater } from '$lib/updater.svelte';` (line 13)
4. Remove the updater check block (line 40):
   ```ts
   // DELETE: if (isTauri()) setTimeout(() => void updater.check().catch(() => {}), 3000);
   ```
5. Remove `<UpdaterBanner />` from template (line 48):
   ```svelte
   <AppShell>
     {@render children()}
   </AppShell>
   ```

## Task 19 — Update `src/lib/components/mcp/McpServers.svelte`

1. Change import (line 30):
   ```ts
   import { repos } from '$lib/db';
   ```
2. Change line 60:
   ```ts
   const isDesktop = false;
   ```
3. Update template title for unavailable stdio templates (line 562-564):
   ```ts
   title={!available
     ? 'This template requires the Mayon sidecar.'
     : undefined}
   ```
4. Update the platform icon area (lines 572-576) — the `isDesktop` is always false so `desktop` platform icon never shows. The template text for "Desktop only" should change. Minimal change: just update the title attribute text:
   - Line 575: `'Desktop only'` → `'Requires sidecar'`

## Task 20 — Collapse `src/lib/db/backup.ts`

1. Remove `isTauri` from import (line 1):
   ```ts
   import { getDriver } from './driver/client';
   ```
   Remove the separate import line 2 — merge into line 1:
   ```ts
   import { getDriver, rebootstrapWith } from './driver/client';
   ```
2. In `createBackup()` — keep only the browser path:
   ```ts
   export async function createBackup(): Promise<void> {
     const bytes = await getDriver().snapshot!();
     downloadBlob(bytes, `mayon-${formatDate()}.sqlite`);
   }
   ```
3. Delete `restoreBackupFromPath()` entirely (lines 149-156).

## Task 21 — Update `src/lib/components/settings/DataSection.svelte`

1. Change import (line 3):
   ```ts
   import { repos } from '$lib/db';
   ```
2. Remove `restoreBackupFromPath` from import (line 4):
   ```ts
   import { createBackup, restoreBackupFromBytes } from '$lib/db/backup';
   ```
3. In `handleBackup()` — simplify status message (line 19):
   ```ts
   status = 'Backup downloaded.';
   ```
4. In `handleRestore()` — remove the `isTauri()` branch:
   ```ts
   async function handleRestore() {
     busy = true;
     error = null;
     status = null;
     try {
       fileInputEl?.click();
     } catch (err) {
       error = err instanceof Error ? err.message : String(err);
       busy = false;
     }
   }
   ```

## Task 22 — Update `src/lib/components/mcp/McpServers.svelte` (CORS hint)

Change the CORS fallback hint at line 1162:
```svelte
<span class="block mt-1 opacity-80">
  Use the Mayon sidecar (<code>docker compose up</code>), which proxies
  requests and avoids CORS entirely.
</span>
```
(Wait until Phase 3 for this change — the sidecar LLM proxy doesn't exist yet. For P0, just update the desktop wording to a neutral message or remove it. Actually, the plan says P0.7 docs updates happen here, and the CORS text update is P3. For P0, just neutralize the desktop reference.)

P0 change: "Use the Mayon desktop app, which routes requests through the native shell and avoids CORS entirely." → remove or leave as-is (it's technically still accurate as a statement about what desktop did, just desktop no longer exists). Simplest P0 change: remove the CORS-specific desktop hint span since the desktop app no longer exists.

Actually, re-reading the plan more carefully — P3 is where the CORS hint changes. For P0, just leave it or blank it. Let's leave the CORS hint as-is for P0; it'll get updated in P3.

## Task 23 — Update `src/lib/components/ai/ProviderConfig.svelte`

Line 22 comment: "OS keychain on desktop (plaintext never enters JS)" — update:
```ts
// API keys live in the runtime KeyStore (IndexedDB) — not the local settings store.
```

Line 207-208: "API keys are stored in the OS keychain (desktop) or IndexedDB (browser)" — update:
```svelte
<p class="text-sm text-muted-foreground">
  Configure AI providers. Provider handles persist locally; API keys are stored in IndexedDB,
  never in the local settings store.
</p>
```

## Task 24 — Update `src/lib/utils/runtime.ts`

Remove the `'tauri'` case:
```ts
export function runtimeLabel(r: DbRuntime): string {
  switch (r) {
    case 'browser':
      return 'Web';
    case 'memory':
      return 'Web';
    case 'unknown':
      return '';
    default:
      return '';
  }
}
```

## Task 25 — Update tests

### Delete tests for deleted modules:
```bash
rm src/lib/mcp/stdio.test.ts           # deleted with stdio.ts
rm src/lib/ai/tauri-transport.test.ts  # deleted with tauri-transport.ts
```

### `src/lib/ai/keystore/keystore.test.ts`:
- Remove `import { invoke } from '@tauri-apps/api/core';` (line 2)
- Remove `import { createDesktopKeyStore } from './desktop';` (line 4)
- Remove the `vi.mock('@tauri-apps/api/core', ...)` (line 9)
- Remove the `mockedInvoke` variable (line 11)
- Remove the entire `describe('createDesktopKeyStore', ...)` block (lines 13-43)
- The `describe('createBrowserKeyStore (no IndexedDB available)', ...)` block stays

### `src/lib/mcp/client-factory.test.ts`:
- Remove `vi.mock('$lib/db', ...)` (lines 3-6)
- Remove `import { StdioMcpTransport } from './stdio';` (line 19)
- Update stdio test to expect the error message:
  ```ts
  it('throws "requires sidecar" for stdio config', () => {
    expect(() =>
      createMcpTransport({
        id: 's1',
        name: 'Test',
        transport: 'stdio',
        command: 'node',
        args: ['-e', '1'],
        enabled: false,
        createdAt: Date.now()
      })
    ).toThrow('stdio MCP servers require the Mayon sidecar');
  });
  ```
- Remove the `mockIsTauri.mockReturnValue(true/false)` calls from all tests since `isTauri` is gone
- Remove `mockIsTauri` const entirely

### `src/lib/utils/runtime.test.ts`:
- Remove the `['tauri', 'Desktop app']` test case (line 7)

## Task 26 — Update `src/lib/db/index.ts`

Keep the `isTauri` re-export for now (it still exists, just returns false). No change needed here for P0.

## Task 27 — Verify

```bash
rg '@tauri-apps' src            # must return nothing
rg 'isTauri' src                # should only find definition + re-export
pnpm install
pnpm lint
pnpm check
pnpm test
```

## Files NOT changed (and why)

- `src/lib/stores/db.svelte.ts` — `DbRuntime` type keeps `'tauri'` in union (harmless dead value)
- `src/lib/db/driver/types.ts` — no Tauri references
- `src/lib/db/driver/opfs-driver.ts` — no Tauri references
- `src/lib/db/driver/memory.ts` — no Tauri references
- `src/lib/db/driver/opfs-worker.ts` — no Tauri references
- `src/lib/mcp/client.ts` — transport-agnostic, no Tauri references
- `src/lib/mcp/http.ts` — no Tauri references
- `src/lib/mcp/transport.ts` — no Tauri references
- `src/lib/mcp/types.ts` — `platforms` field stays as-is (repurposed in P2)
- `AGENTS.md` / `README.md` / docs — updated in P0.7 docs task (separate from code tasks; can be done after tests pass)

## Post-DoD: Docs (Task 28)

After all code changes pass lint/check/test:

- **`AGENTS.md`**: Remove Tauri stack line from stack section, remove `tauri*` command rows, remove Linux GTK/WebKit + secret-service sections, remove P5 desktop manual gates, update P0/P1 manual gates to browser-only.
- **`README.md`**: Remove Desktop download section, remove `pnpm tauri dev` from build instructions, remove "Two runtimes" bullet, simplify to browser-only + future `docker compose up`.
- **`DESKTOP_FALLBACK_HINT`** in `src/lib/ai/errors.ts` (line 26-27): Change "Use the Mayon desktop app" to a browser-only message or the future sidecar hint. For P0: `'Browser calls to this provider may be blocked by CORS. Use a different provider, or wait for the Mayon sidecar for CORS-free access.'`

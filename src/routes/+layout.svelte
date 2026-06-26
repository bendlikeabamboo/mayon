<script lang="ts">
	import '@fontsource/newsreader/400.css';
	import '@fontsource/newsreader/400-italic.css';
	import '@fontsource/newsreader/600.css';
	import '../app.css';
	import { migrateLegacyKeys } from '$lib/ai/keystore/migrate';
	import AppShell from '$lib/components/AppShell.svelte';
	import UpdaterBanner from '$lib/components/UpdaterBanner.svelte';
	import { bootstrapDb } from '$lib/db/driver/client';
	import { isTauri, repos } from '$lib/db';
	import { runSelfCheck } from '$lib/db/self-check';
	import { bindThemePersistence, themeState, type Theme } from '$lib/stores/theme.svelte';
	import { updater } from '$lib/updater.svelte';

	let { children } = $props();

	// Boot the data layer eagerly at module evaluation (SPA — browser only, and
	// `ssr = false` so this never runs on the server). Starting boot here rather
	// than inside `onMount` means any repo call a child route makes in its own
	// `onMount` (e.g. `/settings` → `listProviders`, `/chat` → `listRoots`)
	// resolves against the in-flight boot promise via `awaitDb()` instead of
	// racing and throwing "not bootstrapped yet". The DbStatus badge still
	// reflects the initializing/ready/error state.
	void bootstrapDb()
		.then(async () => {
			await repos.settings.seedDefaults();
			// One-time migration of legacy plaintext provider keys into the KeyStore.
			// Non-fatal: an un-migrated row stays in settings and is retried next boot.
			await migrateLegacyKeys().catch(() => {
				/* non-fatal: retries next boot */
			});
			// Theme: DB is the durable source, localStorage is the fast boot cache.
			const stored = await repos.settings.get<Theme>('theme');
			if (stored) themeState.hydrate(stored);
			bindThemePersistence((t) => repos.settings.set('theme', t));
			// Dev-only DB self-check (write/read/delete a chats row).
			if (import.meta.env.DEV) void runSelfCheck();
			// Passive desktop update check, debounced so it doesn't race boot.
			// Non-fatal: `check()` swallows errors into the store state.
			if (isTauri()) setTimeout(() => void updater.check().catch(() => {}), 3000);
		})
		.catch(() => {
			// Error already surfaced via the dbStatus store -> DbStatus badge.
		});
</script>

<AppShell>
	<UpdaterBanner />
	{@render children()}
</AppShell>

<script lang="ts">
	import '@fontsource/newsreader/400.css';
	import '@fontsource/newsreader/400-italic.css';
	import '@fontsource/newsreader/600.css';
	import '../app.css';
	import '$lib/perf/probe';
	import { migrateLegacyKeys } from '$lib/ai/keystore/migrate';
	import AppShell from '$lib/components/AppShell.svelte';
	import BootGate from '$lib/components/BootGate.svelte';
	import { bootstrapDb } from '$lib/db/driver/client';
	import { repos } from '$lib/db';
	import { runSelfCheck } from '$lib/db/self-check';
	import { bindThemePersistence, themeState, type Theme } from '$lib/stores/theme.svelte';
	import { dbStatus } from '$lib/stores/db.svelte.js';

	let { children } = $props();

	let connecting = $derived(dbStatus.status === 'initializing');
	let unreachable = $derived(
		dbStatus.status === 'error' && dbStatus.reason === 'server-unreachable'
	);

	void bootstrapDb()
		.then(async () => {
			await repos.settings.seedDefaults();
			await migrateLegacyKeys().catch(() => {
				/* non-fatal: retries next boot */
			});
			const stored = await repos.settings.get<Theme>('theme');
			if (stored) themeState.hydrate(stored);
			bindThemePersistence((t) => repos.settings.set('theme', t));
			if (import.meta.env.DEV) void runSelfCheck();
			if (import.meta.env.DEV) import('$lib/perf/longtask-warn');
		})
		.catch(() => {
			// Error already surfaced via the dbStatus store -> BootGate or DbStatus badge.
		});
</script>

{#if connecting}
	<BootGate variant="connecting" />
{:else if unreachable}
	<BootGate variant="unreachable" />
{:else}
	<AppShell>
		{@render children()}
	</AppShell>
{/if}

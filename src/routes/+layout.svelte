<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import AppShell from '$lib/components/AppShell.svelte';
	import { bootstrapDb } from '$lib/db/driver/client';
	import { repos } from '$lib/db';
	import { runSelfCheck } from '$lib/db/self-check';
	import { bindThemePersistence, themeState, type Theme } from '$lib/stores/theme.svelte';

	let { children } = $props();

	// Boot the data layer once on first render (SPA — browser only). The DbStatus
	// badge in the header reflects the resulting initializing/ready/error state.
	onMount(() => {
		void bootstrapDb()
			.then(async () => {
				await repos.settings.seedDefaults();
				// Theme: DB is the durable source, localStorage is the fast boot cache.
				const stored = await repos.settings.get<Theme>('theme');
				if (stored) themeState.hydrate(stored);
				bindThemePersistence((t) => repos.settings.set('theme', t));
				// Dev-only DB self-check (write/read/delete a chats row).
				if (import.meta.env.DEV) void runSelfCheck();
			})
			.catch(() => {
				// Error already surfaced via the dbStatus store -> DbStatus badge.
			});
	});
</script>

<AppShell>
	{@render children()}
</AppShell>

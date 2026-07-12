<script lang="ts">
	import '@fontsource/newsreader/400.css';
	import '@fontsource/newsreader/400-italic.css';
	import '@fontsource/newsreader/600.css';
	import '../app.css';
	import { migrateLegacyKeys } from '$lib/ai/keystore/migrate';
	import AppShell from '$lib/components/AppShell.svelte';
	import { bootstrapDb } from '$lib/db/driver/client';
	import { repos } from '$lib/db';
	import { runSelfCheck } from '$lib/db/self-check';
	import { bindThemePersistence, themeState, type Theme } from '$lib/stores/theme.svelte';
	import { detectSidecar } from '$lib/sidecar/detect';
	import { sidecarStatus } from '$lib/sidecar/status.svelte';

	let { children } = $props();

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
		})
		.catch(() => {
			// Error already surfaced via the dbStatus store -> DbStatus badge.
		});

	void detectSidecar().then((h) => {
		if (h) sidecarStatus.markConnected(h);
		else sidecarStatus.markDisconnected();
	});
</script>

<AppShell>
	{@render children()}
</AppShell>

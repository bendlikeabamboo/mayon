<script lang="ts">
	import { onMount } from 'svelte';
	import { Loader2, RefreshCw, WifiOff } from '@lucide/svelte';
	import { dbStatus } from '$lib/stores/db.svelte.js';
	import { serverStatus } from '$lib/server/status.svelte.js';
	import { detectServer } from '$lib/server/detect';
	import { Button } from '$lib/components/ui/button/index.js';

	let { variant }: { variant: 'connecting' | 'unreachable' } = $props();

	const headline = $derived(
		variant === 'connecting'
			? 'Connecting to the Mayon server…'
			: serverStatus.connected
				? 'Database not ready.'
				: 'Cannot reach the Mayon server.'
	);

	onMount(() => {
		if (variant !== 'unreachable') return;

		const id = setInterval(async () => {
			try {
				const h = await detectServer();
				if (h && h.ok && h.caps.includes('pg')) location.reload();
			} catch {
				// ignore — next tick
			}
		}, 5000);

		return () => clearInterval(id);
	});
</script>

<div class="fixed inset-0 grid place-items-center bg-background">
	<div class="flex flex-col items-center gap-4 text-center p-8 max-w-md">
		{#if variant === 'connecting'}
			<Loader2 class="size-8 animate-spin text-muted-foreground" />
		{:else}
			<WifiOff class="size-8 text-muted-foreground" />
		{/if}

		<h1 class="text-lg font-semibold">{headline}</h1>

		{#if variant === 'connecting'}
			<p class="text-sm text-muted-foreground">Waiting for the database to come online.</p>
		{:else}
			<p class="text-sm text-muted-foreground">Start the database and server with:</p>
			<code class="rounded-md bg-muted px-3 py-1.5 text-sm font-mono">docker compose up</code>
			{#if dbStatus.error}
				<p class="text-xs text-muted-foreground">{dbStatus.error}</p>
			{/if}
			<Button variant="outline" class="mt-2" onclick={() => location.reload()}>
				<RefreshCw class="size-4" />
				Retry
			</Button>
		{/if}
	</div>
</div>

<script lang="ts">
	import { CheckCircle2, Unplug } from '@lucide/svelte';
	import { serverStatus } from '$lib/services/status.svelte.js';

	// Readout fragment: rendered INSIDE the StatusIndicator popover body.
	// Outer pill chrome lives on the StatusIndicator trigger instead.
	const label = $derived(
		serverStatus.connected
			? serverStatus.version
				? `Server: v${serverStatus.version}`
				: 'Server: connected'
			: 'Server: off'
	);

	const capabilities = $derived(serverStatus.caps.join(', ') || 'none yet');
</script>

<div class="flex flex-col gap-1 text-xs">
	<div class="flex items-center gap-1.5 font-medium">
		{#if serverStatus.connected}
			<span
				class="grid size-3.5 shrink-0 place-items-center text-emerald-600 dark:text-emerald-400"
			>
				<CheckCircle2 class="size-3.5" />
			</span>
		{:else}
			<span class="grid size-3.5 shrink-0 place-items-center text-muted-foreground">
				<Unplug class="size-3.5" />
			</span>
		{/if}
		<span>{label}</span>
	</div>
	{#if serverStatus.connected}
		<p class="text-muted-foreground">Mayon server capabilities: {capabilities}</p>
	{:else}
		<p class="text-muted-foreground">Browser-only (run `docker compose up` for the server)</p>
	{/if}
	{#if serverStatus.restoring}
		<div
			class="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 font-medium text-amber-700 dark:text-amber-400"
		>
			Database restore in progress
		</div>
	{/if}
</div>

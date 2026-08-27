<script lang="ts">
	import { AlertCircle, CheckCircle2, Loader2 } from '@lucide/svelte';
	import { dbStatus } from '$lib/stores/db.svelte.js';
	import { runtimeLabel } from '$lib/utils/runtime.js';
	import { Button } from '$lib/components/ui/button/index.js';

	// Readout fragment: rendered INSIDE the StatusIndicator popover body.
	// Outer pill chrome lives on the StatusIndicator trigger instead.
	const statusLabel = $derived(
		dbStatus.status === 'initializing'
			? 'DB…'
			: dbStatus.status === 'ready'
				? import.meta.env.DEV && dbStatus.selfCheck === 'fail'
					? 'DB ready (self-check failed)'
					: 'DB ready'
				: 'DB error'
	);

	const selfCheckLabel = $derived(
		dbStatus.selfCheck === 'pending'
			? 'running'
			: dbStatus.selfCheck === 'pass'
				? 'passed'
				: 'failed'
	);
</script>

<div class="flex flex-col gap-1 text-xs">
	<div class="flex items-center gap-1.5 font-medium">
		{#if dbStatus.status === 'initializing'}
			<span class="grid size-3.5 shrink-0 place-items-center">
				<Loader2 class="size-3.5 animate-spin" />
			</span>
		{:else if dbStatus.status === 'ready'}
			<span
				class="grid size-3.5 shrink-0 place-items-center text-emerald-600 dark:text-emerald-400"
			>
				<CheckCircle2 class="size-3.5" />
			</span>
		{:else}
			<span class="grid size-3.5 shrink-0 place-items-center text-red-600 dark:text-red-400">
				<AlertCircle class="size-3.5" />
			</span>
		{/if}
		<span>{statusLabel}</span>
	</div>
	<p class="text-muted-foreground">
		Runtime: {runtimeLabel(dbStatus.runtime) || 'unknown'} · Self-check: {selfCheckLabel}
	</p>
	{#if dbStatus.status === 'error'}
		<div class="rounded-md border border-red-500/40 bg-red-500/10 p-2">
			<div class="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-400">
				<AlertCircle class="size-3.5 shrink-0" /> Database error
			</div>
			<p class="mt-1 text-red-700/90 dark:text-red-400/90">
				{dbStatus.error ?? 'Unknown error'}
			</p>
			<Button variant="outline" size="sm" class="mt-2" onclick={() => location.reload()}>
				Reload
			</Button>
		</div>
	{/if}
</div>

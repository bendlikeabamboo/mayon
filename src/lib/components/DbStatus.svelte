<script lang="ts">
	import { AlertCircle, CheckCircle2, Loader2 } from '@lucide/svelte';
	import { dbStatus } from '$lib/stores/db.svelte.js';
	import { cn } from '$lib/utils.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let { collapsed = false }: { collapsed?: boolean } = $props();

	const statusLabel = $derived(
		dbStatus.status === 'initializing'
			? 'DB…'
			: dbStatus.status === 'ready'
				? import.meta.env.DEV && dbStatus.selfCheck === 'fail'
					? 'DB ready (self-check failed)'
					: 'DB ready'
				: 'DB error'
	);

	const badgeClass = $derived(
		cn(
			'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
			collapsed && 'gap-0 px-0 py-1',
			dbStatus.status === 'initializing' && 'bg-muted text-muted-foreground',
			dbStatus.status === 'ready' &&
				dbStatus.selfCheck !== 'fail' &&
				'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
			dbStatus.status === 'ready' &&
				dbStatus.selfCheck === 'fail' &&
				'bg-amber-500/10 text-amber-600 dark:text-amber-400',
			dbStatus.status === 'error' && 'bg-red-500/10 text-red-600 dark:text-red-400'
		)
	);
</script>

{#if dbStatus.status === 'error' && !collapsed}
	<div class="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs">
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
{:else}
	<div class={badgeClass} title={dbStatus.error ?? `Database: ${dbStatus.status}`}>
		{#if dbStatus.status === 'initializing'}
			<Loader2 class="size-3.5 animate-spin" />
		{:else if dbStatus.status === 'ready'}
			<CheckCircle2 class="size-3.5" />
		{:else}
			<AlertCircle class="size-3.5" />
		{/if}
		{#if !collapsed}
			<span>{statusLabel}</span>
		{/if}
	</div>
{/if}

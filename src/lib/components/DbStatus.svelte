<script lang="ts">
	import { AlertCircle, CheckCircle2, Database, Loader2 } from '@lucide/svelte';
	import { dbStatus } from '$lib/stores/db.svelte.js';
	import { cn } from '$lib/utils.js';

	const badgeClass = $derived(
		cn(
			'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
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

<div class={badgeClass} title={dbStatus.error ?? `Database: ${dbStatus.status}`}>
	{#if dbStatus.status === 'initializing'}
		<Loader2 class="size-3.5 animate-spin" /> DB…
	{:else if dbStatus.status === 'ready'}
		<CheckCircle2 class="size-3.5" /> DB ready
	{:else}
		<AlertCircle class="size-3.5" /> DB error
	{/if}
	<span class="opacity-40">·</span>
	<span class="inline-flex items-center gap-1 opacity-70">
		<Database class="size-3.5" />
		{dbStatus.runtime}
	</span>
</div>

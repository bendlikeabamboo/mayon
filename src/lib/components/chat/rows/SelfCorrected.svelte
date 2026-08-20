<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronRight, ChevronDown, AlertTriangle } from '@lucide/svelte';
	import type { DurableEntry } from '$lib/chat/entries';
	import { parseMetadata, type SelfCorrectedMeta } from '$lib/chat/kinds';
	import { incRender } from '$lib/perf/mark';

	let { item }: { item: DurableEntry } = $props();

	const meta = $derived(parseMetadata<SelfCorrectedMeta>(item.entry.metadata));
	const issues = $derived(meta?.issues ?? []);
	const attempts = $derived(meta?.attempts ?? 0);
	const succeeded = $derived(meta?.succeeded ?? false);

	let open = $state(false);

	onMount(() => incRender('TimelineRow'));
</script>

<div class="flex flex-col gap-1 items-start">
	<div class="flex items-center">
		<button
			type="button"
			class="flex items-center gap-1.5 px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
			onclick={() => (open = !open)}
		>
			<AlertTriangle class="size-3" />
			{#if succeeded}
				Self-corrected ({attempts} attempt{attempts !== 1 ? 's' : ''})
			{:else}
				Self-correction failed ({attempts} attempt{attempts !== 1 ? 's' : ''})
			{/if}
			{#if open}
				<ChevronDown class="size-3" />
			{:else}
				<ChevronRight class="size-3" />
			{/if}
		</button>
	</div>
	{#if open}
		<div
			class="rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground"
		>
			{#each issues as issue (issue.type + ':' + issue.message)}
				<div class="flex items-start gap-1.5 py-0.5">
					<span class="font-mono text-amber-600 dark:text-amber-400">{issue.type}</span>
					<span>{issue.message}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

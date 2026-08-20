<script lang="ts">
	import { onMount } from 'svelte';
	import { CheckCircle2, Circle } from '@lucide/svelte';
	import type { DurableEntry } from '$lib/chat/entries';
	import { parseMetadata, type ChoicesMeta } from '$lib/chat/kinds';
	import { incRender } from '$lib/perf/mark';

	interface ChoicesOfferProps {
		item: DurableEntry;
		linkedTakenOption?: string;
	}

	let { item, linkedTakenOption }: ChoicesOfferProps = $props();

	const meta = $derived(parseMetadata<ChoicesMeta>(item.entry.metadata));
	const options = $derived(meta?.options ?? []);
	const nextUnit = $derived(meta?.nextUnit ?? '');
	const progress = $derived(meta?.progress ?? '');

	onMount(() => incRender('TimelineRow'));
</script>

<div class="flex flex-col gap-1 items-start">
	{#if nextUnit || progress}
		<span class="px-1 text-xs text-muted-foreground">
			{#if progress}{progress}{/if}
			{#if nextUnit}
				— {nextUnit}{/if}
		</span>
	{/if}
	<div class="flex flex-wrap gap-1.5 px-1">
		{#each options as option (option)}
			<span
				class="rounded-full border px-2.5 py-1 text-xs {option === linkedTakenOption
					? 'border-primary bg-primary/10 text-primary'
					: 'border-border text-muted-foreground'}"
			>
				{#if option === linkedTakenOption}
					<CheckCircle2 class="inline size-3 mr-1" />
				{:else}
					<Circle class="inline size-3 mr-1 opacity-40" />
				{/if}
				{option}
			</span>
		{/each}
	</div>
</div>

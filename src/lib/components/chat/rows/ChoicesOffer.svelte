<script lang="ts">
	import { onMount } from 'svelte';
	import { CheckCircle2, Circle } from '@lucide/svelte';
	import type { DurableEntry } from '$lib/chat/entries';
	import { parseMetadata, type ChoicesMeta } from '$lib/chat/kinds';
	import { incRender } from '$lib/perf/mark';

	interface ChoicesOfferProps {
		item: DurableEntry;
		linkedTakenOption?: string;
		onSelect?: (option: string) => void;
	}

	let { item, linkedTakenOption, onSelect }: ChoicesOfferProps = $props();

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
			{#if onSelect && option !== linkedTakenOption}
				<button
					type="button"
					class="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-primary cursor-pointer hover:border-primary/50 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
					onclick={() => onSelect(option)}
				>
					<Circle class="inline size-3 mr-1 opacity-40" />
					{option}
				</button>
			{:else}
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
			{/if}
		{/each}
	</div>
</div>

<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronRight, ChevronDown } from '@lucide/svelte';
	import Markdown from '../Markdown.svelte';
	import type { DurableEntry } from '$lib/chat/entries';
	import { incRender } from '$lib/perf/mark';

	type DurableProps = { item: DurableEntry; live?: false };
	type LiveProps = { live: true; buffer: string };

	let props: DurableProps | LiveProps = $props();

	const isDurable = $derived(props.live !== true);
	const text = $derived(
		isDurable ? (props as DurableProps).item.entry.content : (props as LiveProps).buffer
	);

	let open = $state(false);

	$effect(() => {
		if (props.live === true) open = true;
	});

	onMount(() => incRender('TimelineRow'));
</script>

<div class="flex flex-col gap-1 items-start">
	<div class="flex items-center">
		<button
			type="button"
			class="flex items-center gap-1.5 px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
			onclick={() => (open = !open)}
		>
			{#if props.live}
				<span class="inline-block size-1.5 rounded-full bg-blue-500 animate-pulse"></span>
			{/if}
			Thought process
			{#if open}
				<ChevronDown class="size-3" />
			{:else}
				<ChevronRight class="size-3" />
			{/if}
		</button>
	</div>
	{#if open}
		<div
			class="max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-muted-foreground italic"
		>
			<Markdown raw={text} />
		</div>
	{/if}
</div>

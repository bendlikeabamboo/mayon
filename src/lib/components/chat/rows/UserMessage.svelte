<script lang="ts">
	import { onMount } from 'svelte';
	import Markdown from '../Markdown.svelte';
	import type { DurableEntry } from '$lib/chat/entries';
	import { partsOf, type ImagePart } from '$lib/chat/kinds';
	import { incRender } from '$lib/perf/mark';

	let { item }: { item: DurableEntry } = $props();

	let expanded = $state<ImagePart | null>(null);

	// Image parts render as sibling elements OUTSIDE the Markdown pipeline
	// (research D7) — no sanitize-schema change, no expound/source-map surface.
	const images = $derived(partsOf(item.entry).filter((p): p is ImagePart => p.type === 'image'));

	onMount(() => incRender('TimelineRow'));
</script>

<div class="flex flex-col gap-1 items-end">
	<div class="flex w-full items-center justify-end">
		<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">You</span>
	</div>
	{#if images.length > 0}
		<div class="flex max-w-[75%] flex-wrap justify-end gap-1.5">
			{#each images as image (image.data)}
				<button
					type="button"
					class="overflow-hidden rounded-lg border border-border transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onclick={() => (expanded = image)}
					aria-label="View image full size"
				>
					<img
						src={image.data}
						alt={image.name ?? 'Attached image'}
						class="size-24 object-cover"
						loading="lazy"
					/>
				</button>
			{/each}
		</div>
	{/if}
	{#if item.entry.content.trim()}
		<div
			class="max-w-[75%] no-text-thin rounded-lg px-4 py-2.5 bg-[var(--highlight)] text-white dark:bg-primary dark:text-primary-foreground markdown-invert bubble-user"
			style="--bubble-bg: var(--highlight); --bubble-fg: #fff;"
		>
			<Markdown raw={item.entry.content} />
		</div>
	{/if}
</div>

{#if expanded}
	<button
		type="button"
		class="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/70 p-8"
		onclick={() => (expanded = null)}
		aria-label="Close image view"
	>
		<img
			src={expanded.data}
			alt={expanded.name ?? 'Attached image'}
			class="max-h-full max-w-full rounded-lg object-contain shadow-xl"
		/>
	</button>
{/if}

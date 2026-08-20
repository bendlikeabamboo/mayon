<script lang="ts">
	import { onMount } from 'svelte';
	import Markdown from '../Markdown.svelte';
	import type { DurableEntry } from '$lib/chat/entries';
	import { incRender } from '$lib/perf/mark';

	let { item }: { item: DurableEntry } = $props();

	onMount(() => incRender('TimelineRow'));
</script>

<div class="flex flex-col gap-1 items-end">
	<div class="flex w-full items-center justify-end">
		<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">You</span>
	</div>
	<div
		class="max-w-[75%] no-text-thin rounded-lg px-4 py-2.5 bg-[var(--highlight)] text-white dark:bg-primary dark:text-primary-foreground markdown-invert bubble-user"
		style="--bubble-bg: var(--highlight); --bubble-fg: #fff;"
	>
		<Markdown raw={item.entry.content} />
	</div>
</div>

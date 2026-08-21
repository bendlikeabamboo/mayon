<script lang="ts">
	import type { ResultShape } from '$lib/chat/result-shape';
	import { collectCards } from '$lib/mcp/sources';
	import Markdown from '../Markdown.svelte';

	/**
	 * Expanded tool-result body, rendered per its classified shape
	 * (result-shape.ts is the single shape authority). Every branch is
	 * bounded; payload markup is never rendered as HTML (descriptions are
	 * tag-stripped in collectCards; markdown passes the sanitized pipeline).
	 */
	let { shape }: { shape: ResultShape } = $props();

	const MAX_CARDS = 10;
	const cards = $derived(shape.kind === 'records' ? collectCards(shape.values) : []);
	const shown = $derived(cards.slice(0, MAX_CARDS));
	const overflow = $derived(Math.max(0, cards.length - MAX_CARDS));
</script>

{#if shape.kind === 'records'}
	{#if shown.length > 0}
		<div class="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
			{#each shown as card (card.url)}
				<a
					href={card.url}
					target="_blank"
					rel="noopener noreferrer"
					class="block rounded-lg border border-border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/50"
				>
					<span class="block truncate text-xs font-medium text-foreground">{card.title}</span>
					<span class="block truncate text-xs text-muted-foreground">{card.host}</span>
					{#if card.description}
						<span class="block truncate text-xs text-muted-foreground">{card.description}</span>
					{/if}
					{#if card.snippet}
						<span class="block truncate text-xs text-muted-foreground/70">{card.snippet}</span>
					{/if}
				</a>
			{/each}
			{#if overflow > 0}
				<span class="px-1 text-xs text-muted-foreground">+{overflow} more</span>
			{/if}
		</div>
	{/if}
{:else if shape.kind === 'markdown'}
	<div class="max-h-60 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">
		<Markdown raw={shape.text} />
	</div>
{:else if shape.kind === 'json'}
	<pre
		class="max-h-60 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">{JSON.stringify(
			shape.value,
			null,
			2
		)}</pre>
{:else if shape.kind === 'text'}
	<pre
		class="max-h-60 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">{shape.text}</pre>
{/if}

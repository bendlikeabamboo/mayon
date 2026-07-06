<script lang="ts">
	import { Brain, ChevronRight, ChevronDown } from '@lucide/svelte';
	import Markdown from './Markdown.svelte';

	let {
		reasoning,
		live = false,
		inline = false,
		open = $bindable(false)
	}: { reasoning: string; live?: boolean; inline?: boolean; open?: boolean } = $props();
</script>

{#if reasoning.trim()}
	<button
		type="button"
		class={inline
			? 'ml-1 flex shrink-0 items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors'
			: 'flex items-center gap-1.5 px-1 text-xs text-muted-foreground hover:text-foreground transition-colors'}
		onclick={() => (open = !open)}
	>
		<Brain class={inline ? 'size-3' : 'size-3 shrink-0'} />
		{#if !inline}
			<span>Thought process</span>
		{/if}
		{#if live}
			<span class="inline-block size-1.5 rounded-full bg-blue-500 animate-pulse"></span>
		{/if}
		{#if open}
			<ChevronDown class="size-3" />
		{:else}
			<ChevronRight class="size-3" />
		{/if}
	</button>
	{#if !inline && open}
		<div
			class="max-h-60 overflow-y-auto rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-muted-foreground italic"
		>
			<Markdown raw={reasoning} />
		</div>
	{/if}
{/if}

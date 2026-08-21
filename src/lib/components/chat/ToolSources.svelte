<script lang="ts">
	import type { ToolSource } from '$lib/mcp/sources';

	let { sources }: { sources: ToolSource[] } = $props();
</script>

{#if sources.length > 0}
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
		<span class="font-medium uppercase tracking-wide">Sources</span>
		{#each sources as s (s.url)}
			<a
				href={s.url}
				target="_blank"
				rel="noopener noreferrer"
				class="max-w-64 truncate hover:underline"
				title={s.url}>{s.title}</a
			>
		{/each}
	</div>
{/if}

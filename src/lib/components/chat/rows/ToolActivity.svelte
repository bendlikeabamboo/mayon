<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronRight, ChevronDown, CheckCircle2, XCircle } from '@lucide/svelte';
	import ToolSources from '../ToolSources.svelte';
	import type { ToolGroup } from '$lib/chat/entries';
	import { parseMetadata, type ToolResultMeta, type SharedMetadata } from '$lib/chat/kinds';
	import { extractSources } from '$lib/mcp/sources';
	import { incRender } from '$lib/perf/mark';

	let { item }: { item: ToolGroup } = $props();

	const resultMeta = $derived(
		item.result ? parseMetadata<ToolResultMeta>(item.result.metadata) : null
	);
	const sharedMeta = $derived(
		parseMetadata<SharedMetadata>(item.result?.metadata ?? item.call.metadata)
	);
	const artifact = $derived(sharedMeta?.artifact);
	const sources = $derived(item.result ? extractSources(parseMetadata(item.result.metadata)) : []);
	const toolName = $derived(item.call.toolName ?? 'Unknown tool');
	const summary = $derived(item.result?.content ?? '');
	const detail = $derived(resultMeta?.detail ?? null);
	const hasDetail = $derived(detail !== null && Object.keys(detail).length > 0);
	const hasResult = $derived(item.result !== null);
	let detailOpen = $state(false);

	function artifactHref(artifact: { kind: string; id: string }): string {
		if (artifact.kind === 'chat') return `/chat/${artifact.id}`;
		if (artifact.kind === 'lab') return `/lab/${artifact.id}`;
		if (artifact.kind === 'quiz') return `/quiz/${artifact.id}`;
		return `/${artifact.kind}/${artifact.id}`;
	}

	onMount(() => incRender('TimelineRow'));
</script>

<div class="flex flex-col gap-1">
	<div class="flex items-center gap-1.5 px-1">
		{#if hasResult}
			<CheckCircle2 class="size-3 text-green-600 dark:text-green-400" />
		{:else}
			<XCircle class="size-3 text-red-500/60" />
		{/if}
		<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
			{#if artifact}
				<a href={artifactHref(artifact)} class="hover:underline">{toolName}</a>
			{:else}
				{toolName}
			{/if}
		</span>
	</div>
	{#if summary}
		<span class="px-1 text-xs text-muted-foreground">{summary}</span>
	{/if}
	{#if !hasResult}
		<span class="px-1 text-xs italic text-muted-foreground">No result recorded</span>
	{/if}
	<ToolSources {sources} />
	{#if hasDetail}
		<button
			type="button"
			class="flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
			onclick={() => (detailOpen = !detailOpen)}
		>
			{#if detailOpen}
				<ChevronDown class="size-3" />
			{:else}
				<ChevronRight class="size-3" />
			{/if}
			Detail
		</button>
		{#if detailOpen}
			<pre
				class="max-h-60 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">{JSON.stringify(
					detail,
					null,
					2
				)}</pre>
		{/if}
	{/if}
</div>

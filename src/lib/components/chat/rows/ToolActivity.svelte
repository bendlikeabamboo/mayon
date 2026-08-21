<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ChevronRight,
		ChevronDown,
		CheckCircle2,
		XCircle,
		Circle,
		CircleSlash,
		Hourglass
	} from '@lucide/svelte';
	import ToolSources from '../ToolSources.svelte';
	import ToolResultBody from './ToolResultBody.svelte';
	import type { ToolGroup, OrphanToolResult } from '$lib/chat/entries';
	import {
		parseMetadata,
		type ToolResultMeta,
		type SharedMetadata,
		TOOL_SUMMARY_THRESHOLD
	} from '$lib/chat/kinds';
	import { classifyResult } from '$lib/chat/result-shape';
	import { extractSources } from '$lib/mcp/sources';
	import { getToolDefinition } from '$lib/agent/registry';
	import { incRender } from '$lib/perf/mark';

	let { item }: { item: ToolGroup | OrphanToolResult } = $props();

	const call = $derived('group' in item && item.group === true ? item.call : null);
	const resultMsg = $derived(item.result);
	const resultMeta = $derived(resultMsg ? parseMetadata<ToolResultMeta>(resultMsg.metadata) : null);
	const sharedMeta = $derived(
		parseMetadata<SharedMetadata>(resultMsg?.metadata ?? call?.metadata ?? null)
	);
	const artifact = $derived(sharedMeta?.artifact);
	const sources = $derived(resultMsg ? extractSources(parseMetadata(resultMsg.metadata)) : []);
	const toolName = $derived(call?.toolName ?? resultMsg?.toolName ?? 'Unknown tool');
	const summary = $derived(resultMsg?.content ?? '');
	const detail = $derived(resultMeta?.detail ?? null);
	const hasDetail = $derived(detail !== null && Object.keys(detail).length > 0);
	const hasResult = $derived(resultMsg !== null);
	const terminal = $derived(
		call !== null && getToolDefinition(call.toolName ?? '')?.terminal === true
	);

	type ToolStatus =
		| 'awaiting'
		| 'declined'
		| 'aborted'
		| 'running'
		| 'failed'
		| 'succeeded'
		| 'terminal'
		| 'gap';

	const status = $derived((): ToolStatus => {
		if ('group' in item && item.group) {
			const g = item;
			if (g.aborted) return 'aborted';
			if (g.declined) return 'declined';
			if (g.awaitingDecision) return 'awaiting';
			if (hasResult) {
				return g.failed === true ? 'failed' : 'succeeded';
			}
			if (terminal) return 'terminal';
			if (g.running) return 'running';
			return 'gap';
		}
		if ('orphan' in item && item.orphan) {
			return item.failed === true ? 'failed' : 'succeeded';
		}
		return 'gap';
	});

	const needsExpander = $derived(summary.length > TOOL_SUMMARY_THRESHOLD || hasDetail);
	const payloadLike = $derived(/^\s*[[{]/.test(summary));
	const verbose = $derived(needsExpander || payloadLike);
	const shape = $derived(
		resultMsg ? classifyResult(summary, parseMetadata(resultMsg.metadata)) : null
	);
	let expanded = $state(false);

	function artifactHref(artifact: { kind: string; id: string }): string {
		if (artifact.kind === 'chat') return `/chat/${artifact.id}`;
		if (artifact.kind === 'lab') return `/lab/${artifact.id}`;
		if (artifact.kind === 'quiz') return `/quiz/${artifact.id}`;
		return `/${artifact.kind}/${artifact.id}`;
	}

	function onHeaderKey(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			expanded = !expanded;
		}
	}

	onMount(() => incRender('TimelineRow'));
</script>

<div class="flex flex-col gap-1">
	{#snippet headerInner()}
		{#if status() === 'awaiting'}
			<Hourglass class="size-3 text-amber-500 animate-pulse" />
		{:else if status() === 'aborted' || status() === 'declined'}
			<CircleSlash class="size-3 text-muted-foreground" />
		{:else if status() === 'running'}
			<Circle class="size-3 text-muted-foreground animate-pulse" />
		{:else if status() === 'failed'}
			<XCircle class="size-3 text-red-500" />
		{:else if status() === 'succeeded'}
			<CheckCircle2 class="size-3 text-green-600 dark:text-green-400" />
		{:else if status() === 'terminal'}
			<Circle class="size-3 text-muted-foreground/70" />
		{:else}
			<XCircle class="size-3 text-red-500/60" />
		{/if}
		<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
			{#if artifact}
				<a
					href={artifactHref(artifact)}
					class="hover:underline"
					onclick={(e) => e.stopPropagation()}>{toolName}</a
				>
			{:else}
				{toolName}
			{/if}
		</span>
		{#if status() === 'awaiting'}
			<span class="text-xs italic text-muted-foreground">Waiting for your approval</span>
		{:else if status() === 'aborted'}
			<span class="text-xs text-muted-foreground">Aborted</span>
		{:else if status() === 'declined'}
			<span class="text-xs text-muted-foreground">Declined</span>
		{/if}
		{#if verbose}
			{#if expanded}
				<ChevronDown class="size-3 text-muted-foreground" />
			{:else}
				<ChevronRight class="size-3 text-muted-foreground" />
			{/if}
		{/if}
	{/snippet}
	{#if verbose}
		<div
			class="flex w-fit items-center gap-1.5 px-1 cursor-pointer select-none hover:text-foreground transition-colors"
			role="button"
			tabindex="0"
			aria-expanded={expanded}
			onclick={() => (expanded = !expanded)}
			onkeydown={onHeaderKey}
		>
			{@render headerInner()}
		</div>
	{:else}
		<div class="flex items-center gap-1.5 px-1">
			{@render headerInner()}
		</div>
	{/if}
	{#if summary && (!verbose || expanded)}
		{#if verbose}
			{#if shape}
				<ToolResultBody {shape} />
			{:else}
				<pre
					class="max-h-60 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">{summary}</pre>
			{/if}
		{:else}
			<span class="px-1 block truncate max-w-full text-xs text-muted-foreground">{summary}</span>
		{/if}
	{/if}
	{#if status() === 'gap'}
		<span class="px-1 text-xs italic text-muted-foreground">No result recorded</span>
	{/if}
	{#if (!verbose || expanded) && shape?.kind !== 'records'}
		<ToolSources {sources} />
	{/if}
</div>

<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ChevronRight,
		CheckCircle2,
		XCircle,
		Circle,
		CircleSlash,
		Hourglass
	} from '@lucide/svelte';
	import ToolSources from '../ToolSources.svelte';
	import ToolResultBody from './ToolResultBody.svelte';
	import { deriveToolStatus } from './tool-status';
	import type { ToolGroup, OrphanToolResult } from '$lib/chat/entries';
	import { parseMetadata, type ToolResultMeta, type SharedMetadata } from '$lib/chat/kinds';
	import { classifyResult } from '$lib/chat/result-shape';
	import { extractSources } from '$lib/mcp/sources';
	import { getToolDefinition } from '$lib/agent/registry';
	import { incRender } from '$lib/perf/mark';
	import {
		Collapsible,
		CollapsibleTrigger,
		CollapsibleContent
	} from '$lib/components/ui/collapsible/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';

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
	const status = $derived(deriveToolStatus(item, { hasResult, terminal }));
	const hasContent = $derived(summary.length > 0 || hasDetail);
	const shape = $derived(
		resultMsg ? classifyResult(summary, parseMetadata(resultMsg.metadata)) : null
	);

	const badgeMeta = $derived.by(() => {
		const s = status;
		if (s === 'awaiting')
			return {
				label: 'Waiting',
				variant: 'secondary' as const,
				icon: Hourglass,
				iconClass: 'text-foreground animate-pulse'
			};
		if (s === 'aborted' || s === 'declined')
			return {
				label: s === 'aborted' ? 'Aborted' : 'Declined',
				variant: 'outline' as const,
				icon: CircleSlash,
				iconClass: 'text-muted-foreground'
			};
		if (s === 'running')
			return {
				label: 'Running',
				variant: 'secondary' as const,
				icon: Circle,
				iconClass: 'text-muted-foreground animate-pulse'
			};
		if (s === 'failed')
			return {
				label: 'Failed',
				variant: 'destructive' as const,
				icon: XCircle,
				iconClass: 'text-destructive'
			};
		if (s === 'succeeded')
			return {
				label: 'Succeeded',
				variant: 'secondary' as const,
				icon: CheckCircle2,
				iconClass: 'text-foreground'
			};
		if (s === 'terminal')
			return {
				label: 'Terminal',
				variant: 'outline' as const,
				icon: Circle,
				iconClass: 'text-muted-foreground/70'
			};
		return {
			label: '',
			variant: 'outline' as const,
			icon: XCircle,
			iconClass: 'text-muted-foreground'
		};
	});

	function artifactHref(a: { kind: string; id: string }): string {
		if (a.kind === 'chat') return `/chat/${a.id}`;
		if (a.kind === 'lab') return `/lab/${a.id}`;
		if (a.kind === 'quiz') return `/quiz/${a.id}`;
		return `/${a.kind}/${a.id}`;
	}

	onMount(() => incRender('TimelineRow'));
</script>

<div class="flex flex-col gap-1">
	{#if hasContent}
		<Collapsible>
			<CollapsibleTrigger
				class="flex w-fit items-center gap-1.5 px-1 cursor-pointer select-none hover:text-foreground transition-colors"
			>
				{@const Icon = badgeMeta.icon}
				<Icon class="size-3 {badgeMeta.iconClass}" />
				<Badge variant={badgeMeta.variant} class="text-[10px] px-1.5 py-0">
					{badgeMeta.label}
				</Badge>
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
				{#if status === 'awaiting'}
					<span class="text-xs italic text-muted-foreground">Waiting for your approval</span>
				{/if}
				<ChevronRight class="size-3 text-muted-foreground" />
			</CollapsibleTrigger>
			<CollapsibleContent>
				{#if shape}
					<ToolResultBody {shape} />
				{:else}
					<pre
						class="max-h-60 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">{summary}</pre>
				{/if}
				{#if shape?.kind !== 'records'}
					<ToolSources {sources} />
				{/if}
			</CollapsibleContent>
		</Collapsible>
	{:else}
		{#snippet noContentHeader()}
			{@const Icon2 = badgeMeta.icon}
			<Icon2 class="size-3 {badgeMeta.iconClass}" />
		{/snippet}
		<div class="flex items-center gap-1.5 px-1">
			{@render noContentHeader()}
			<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{#if artifact}
					<a href={artifactHref(artifact)} class="hover:underline">{toolName}</a>
				{:else}
					{toolName}
				{/if}
			</span>
			{#if status === 'awaiting'}
				<span class="text-xs italic text-muted-foreground">Waiting for your approval</span>
			{:else if status === 'aborted'}
				<span class="text-xs text-muted-foreground">Aborted</span>
			{:else if status === 'declined'}
				<span class="text-xs text-muted-foreground">Declined</span>
			{/if}
		</div>
	{/if}
	{#if status === 'gap'}
		<span class="px-1 text-xs italic text-muted-foreground">No result recorded</span>
	{/if}
</div>

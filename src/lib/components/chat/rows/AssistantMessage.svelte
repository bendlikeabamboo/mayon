<script lang="ts">
	import { onMount } from 'svelte';
	import { GitBranch } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import Markdown from '../Markdown.svelte';
	import Reasoning from '../Reasoning.svelte';
	import Highlighter from '../Highlighter.svelte';
	import Spinner from '../Spinner.svelte';
	import type { DurableEntry } from '$lib/chat/entries';
	import type { ResolvedOffsets } from '$lib/chat/selection';
	import type { ExpoundOptions } from '$lib/chat/expound';
	import { stripGateFence } from '$lib/ai/generate/generate-gate';
	import { parseMetadata } from '$lib/chat/kinds';
	import type { AssistantMessageMeta } from '$lib/chat/kinds';
	import { incRender } from '$lib/perf/mark';

	interface SharedCallbacks {
		onExpound: (
			messageId: string,
			raw: string,
			resolved: ResolvedOffsets,
			opts: ExpoundOptions
		) => void | Promise<void>;
		onCopy: (text: string) => void;
		onBranchWhole: (messageId: string) => void | Promise<void>;
		onRegenerate?: (messageId: string) => void | Promise<void>;
	}

	type DurableProps = {
		item: DurableEntry;
		live?: false;
		personaName?: string;
		failed?: boolean;
	} & SharedCallbacks;

	type LiveProps = {
		live: true;
		buffer: string;
		pending?: boolean;
		personaName?: string;
	};

	let props: DurableProps | LiveProps = $props();

	const isDurable = $derived(props.live !== true);
	const entry = $derived(isDurable ? (props as DurableProps).item.entry : null);
	const meta = $derived(isDurable ? parseMetadata<AssistantMessageMeta>(entry!.metadata) : null);
	const reasoning = $derived(meta?.reasoning);
	const interrupted = $derived(meta?.interrupted === true);
	const visible = $derived(
		isDurable ? stripGateFence(entry!.content) : stripGateFence((props as LiveProps).buffer)
	);
	const pending = $derived(!isDurable ? ((props as LiveProps).pending ?? false) : false);
	const personaName = $derived(
		isDurable
			? ((props as DurableProps).personaName ?? 'Mayon')
			: ((props as LiveProps).personaName ?? 'Mayon')
	);

	let reasoningOpen = $state(false);

	onMount(() => incRender('TimelineRow'));
</script>

<div class="flex flex-col gap-1 items-start">
	<div class="flex w-full items-center justify-between">
		<div class="flex items-center">
			<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{personaName}
			</span>
			{#if !pending && visible}
				<Spinner variant="orbit" class="ml-1.5" />
			{/if}
			{#if reasoning}
				<Reasoning {reasoning} inline bind:open={reasoningOpen} />
			{/if}
		</div>
		{#if isDurable}
			<Button
				variant="ghost"
				size="sm"
				class="h-6 px-2 text-xs text-muted-foreground"
				title="Branch a new chat from this whole message"
				onclick={() => void (props as DurableProps).onBranchWhole(entry!.id)}
			>
				<GitBranch class="size-3" /> Branch from this message
			</Button>
		{/if}
	</div>
	{#if reasoning && reasoningOpen}
		<div
			class="max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-muted-foreground italic"
		>
			<Markdown raw={reasoning} />
		</div>
	{/if}
	<div
		class="min-w-0 max-w-full rounded-lg px-4 py-2.5 border border-border bg-background text-foreground {isDurable &&
		(props as DurableProps).failed
			? 'border-l-2 border-red-500/60'
			: ''}"
	>
		{#if pending}
			<span class="flex items-center gap-1.5 text-sm text-muted-foreground">
				<Spinner variant="pulse" />
				Thinking…
			</span>
		{:else if isDurable}
			<Highlighter
				raw={visible}
				messageId={entry!.id}
				onExpound={(raw, sel, opts) => (props as DurableProps).onExpound(entry!.id, raw, sel, opts)}
				onCopy={(props as DurableProps).onCopy}
			>
				<Markdown raw={visible} />
			</Highlighter>
		{:else}
			<Markdown raw={visible} live={true} />
		{/if}
	</div>
	{#if interrupted && isDurable}
		<div
			class="mt-2 flex items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground"
		>
			This reply was interrupted.
			{#if (props as DurableProps).onRegenerate}
				<Button
					variant="outline"
					size="sm"
					class="h-6 px-2"
					onclick={() => void (props as DurableProps).onRegenerate?.(entry!.id)}>Regenerate</Button
				>
			{/if}
		</div>
	{/if}
</div>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import Markdown from './Markdown.svelte';
	import MessageRow from './MessageRow.svelte';
	import Reasoning from './Reasoning.svelte';
	import Spinner from './Spinner.svelte';
	import LazyMount from './LazyMount.svelte';
	import { stripGateFence } from '$lib/ai/generate/generate-gate';
	import type { Message } from '$lib/db/schema';
	import type { ResolvedOffsets } from '$lib/chat/selection';
	import type { ExpoundOptions } from '$lib/chat/expound';

	let {
		messages,
		streaming = false,
		streamBuffer = '',
		reasoningBuffer = '',
		onExpound,
		onCopy,
		onBranchWhole,
		onRegenerate,
		header,
		personaName = 'Mayon',
		failedMessageId = null
	}: {
		messages: Message[];
		streaming?: boolean;
		streamBuffer?: string;
		reasoningBuffer?: string;
		onExpound: (
			messageId: string,
			raw: string,
			resolved: ResolvedOffsets,
			opts: ExpoundOptions
		) => void | Promise<void>;
		onCopy: (text: string) => void;
		onBranchWhole: (messageId: string) => void | Promise<void>;
		onRegenerate?: (messageId: string) => void | Promise<void>;
		header?: Snippet;
		personaName?: string;
		failedMessageId?: string | null;
	} = $props();

	function isHidden(m: Message): boolean {
		if (!m.metadata) return false;
		try {
			const parsed = JSON.parse(m.metadata);
			return parsed.hidden === true;
		} catch {
			return false;
		}
	}

	const visibleMessages = $derived(messages.filter((m) => !isHidden(m)));
	let liveReasoningOpen = $state(false);
</script>

<div class="min-w-0 flex flex-col gap-4">
	{#if header}
		{@render header()}
	{/if}
	{#each visibleMessages as message (message.id)}
		<div id="msg-{message.id}">
			<LazyMount unmountFar rootMargin="1200px">
				<MessageRow
					{message}
					{onExpound}
					{onCopy}
					{onBranchWhole}
					{onRegenerate}
					{personaName}
					failed={message.id === failedMessageId}
				/>
			</LazyMount>
		</div>
	{/each}

	{#if streaming}
		<div class="flex flex-col gap-1 items-start">
			<div class="flex w-full items-center">
				<span
					class="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
				>
					{#if streamBuffer}
						<Spinner variant="orbit" />
					{/if}
					{personaName}
				</span>
				{#if reasoningBuffer}
					<Reasoning reasoning={reasoningBuffer} live inline bind:open={liveReasoningOpen} />
				{/if}
			</div>
			{#if reasoningBuffer && liveReasoningOpen}
				<div
					class="max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-muted-foreground italic"
				>
					<Markdown raw={reasoningBuffer} />
				</div>
			{/if}
			<div class="rounded-lg border border-border bg-background px-4 py-2.5 text-foreground">
				{#if streamBuffer}
					<Markdown raw={stripGateFence(streamBuffer)} live={true} />
				{:else}
					<span class="flex items-center gap-1.5 text-sm text-muted-foreground">
						<Spinner variant="pulse" />
						Thinking…
					</span>
				{/if}
			</div>
		</div>
	{/if}

	{#if visibleMessages.length === 0 && !streaming}
		<p class="py-8 text-center text-sm text-muted-foreground">
			No messages yet. Send a prompt below.
		</p>
	{/if}
</div>

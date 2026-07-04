<script lang="ts">
	import type { Snippet } from 'svelte';
	import Markdown from './Markdown.svelte';
	import MessageRow from './MessageRow.svelte';
	import Reasoning from './Reasoning.svelte';
	import Spinner from './Spinner.svelte';
	import { stripGateFence } from '$lib/ai/generate/generate-gate';
	import type { Message } from '$lib/db/schema';
	import type { SelectionInput } from '$lib/chat/highlight';
	import type { ExpoundOptions } from '$lib/chat/expound';

	let {
		messages,
		streaming = false,
		streamBuffer = '',
		reasoningBuffer = '',
		onExpound,
		onCopy,
		onBranchWhole,
		header,
		personaName = 'Mayon'
	}: {
		messages: Message[];
		streaming?: boolean;
		streamBuffer?: string;
		reasoningBuffer?: string;
		onExpound: (
			messageId: string,
			raw: string,
			sel: SelectionInput,
			opts: ExpoundOptions
		) => void | Promise<void>;
		onCopy: (text: string) => void;
		onBranchWhole: (messageId: string) => void | Promise<void>;
		header?: Snippet;
		personaName?: string;
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
</script>

<div class="min-w-0 flex flex-col gap-4">
	{#if header}
		{@render header()}
	{/if}
	{#each visibleMessages as message (message.id)}
		<div id="msg-{message.id}">
			<MessageRow {message} {onExpound} {onCopy} {onBranchWhole} {personaName} />
		</div>
	{/each}

	{#if streaming}
		<div class="flex flex-col gap-1 items-start">
			<span
				class="flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
			>
				{#if streamBuffer}
					<Spinner variant="orbit" />
				{/if}
				{personaName}
			</span>
			{#if reasoningBuffer}
				<Reasoning reasoning={reasoningBuffer} live />
			{/if}
			<div class="rounded-lg border border-border bg-background px-4 py-2.5 text-foreground">
				{#if streamBuffer}
					<Markdown raw={stripGateFence(streamBuffer)} />
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

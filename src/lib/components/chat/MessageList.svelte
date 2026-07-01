<script lang="ts">
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
		onBranchWhole
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
	} = $props();
</script>

<div class="flex flex-col gap-4">
	{#each messages as message (message.id)}
		<MessageRow {message} {onExpound} {onCopy} {onBranchWhole} />
	{/each}

	{#if streaming}
		<div class="flex flex-col gap-1 items-start">
			<span
				class="flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
			>
				{#if streamBuffer}
					<Spinner variant="orbit" />
				{/if}
				Mayon
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

	{#if messages.length === 0 && !streaming}
		<p class="py-8 text-center text-sm text-muted-foreground">
			No messages yet. Send a prompt below.
		</p>
	{/if}
</div>

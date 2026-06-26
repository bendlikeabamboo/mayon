<script lang="ts">
	import Markdown from './Markdown.svelte';
	import MessageRow from './MessageRow.svelte';
	import type { Message } from '$lib/db/schema';
	import type { SelectionInput } from '$lib/chat/highlight';
	import type { ExpoundOptions } from '$lib/chat/expound';

	/**
	 * Renders the persisted messages plus, while streaming, a trailing
	 * in-progress assistant bubble fed by the store's live `streamBuffer`.
	 */
	let {
		messages,
		streaming = false,
		streamBuffer = '',
		onExpound,
		onCopy,
		onBranchWhole
	}: {
		messages: Message[];
		streaming?: boolean;
		streamBuffer?: string;
		onExpound: (
			messageId: string,
			raw: string,
			sel: SelectionInput,
			opts: ExpoundOptions
		) => void | Promise<void>;
		onCopy: (text: string) => void;
		onBranchWhole: (messageId: string) => void | Promise<void>;
	} = $props();

	let viewport = $state<HTMLDivElement | null>(null);

	// Auto-scroll to the bottom only when a new message is added (a user turn
	// sent, an assistant turn persisted, or a different chat loaded). While
	// tokens stream in we intentionally leave `scrollTop` alone so the reader
	// stays where they are — the growing reply expands freely below the view
	// instead of yanking focus to each new token.
	$effect(() => {
		void messages.length;
		if (viewport) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	});
</script>

<div
	bind:this={viewport}
	class="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-background p-4"
>
	<div class="flex flex-col gap-4">
		{#each messages as message (message.id)}
			<MessageRow {message} {onExpound} {onCopy} {onBranchWhole} />
		{/each}

		{#if streaming}
			<div class="flex flex-col gap-1">
				<span class="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Assistant
				</span>
				<div class="rounded-lg border border-border bg-background px-4 py-2.5 text-foreground">
					{#if streamBuffer}
						<Markdown raw={streamBuffer} />
					{:else}
						<p class="text-sm text-muted-foreground">Waiting for the first token…</p>
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
</div>

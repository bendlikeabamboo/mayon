<script lang="ts">
	import Markdown from './Markdown.svelte';
	import MessageRow from './MessageRow.svelte';
	import type { Message } from '$lib/db/schema';
	import type { SelectionInput } from '$lib/chat/highlight';

	/**
	 * Renders the persisted messages plus, while streaming, a trailing
	 * in-progress assistant bubble fed by the store's live `streamBuffer`.
	 */
	let {
		messages,
		streaming = false,
		streamBuffer = '',
		onBranchSelection,
		onBranchWhole
	}: {
		messages: Message[];
		streaming?: boolean;
		streamBuffer?: string;
		onBranchSelection: (
			messageId: string,
			raw: string,
			sel: SelectionInput
		) => void | Promise<void>;
		onBranchWhole: (messageId: string) => void | Promise<void>;
	} = $props();

	let viewport = $state<HTMLDivElement | null>(null);

	// Auto-scroll to the bottom when new content arrives.
	$effect(() => {
		// Touch reactive deps so the effect re-runs.
		void messages.length;
		void streamBuffer.length;
		void streaming;
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
			<MessageRow {message} {onBranchSelection} {onBranchWhole} />
		{/each}

		{#if streaming}
			<div class="flex flex-col gap-1">
				<span class="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Assistant
				</span>
				<div class="rounded-lg bg-muted px-4 py-2.5 text-foreground">
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

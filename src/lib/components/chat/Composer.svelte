<script lang="ts">
	import { Send, Square } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	/**
	 * Prompt input + Send/Stop. Mirrors StreamDemo's interaction: ⌘/Ctrl+Enter
	 * sends, plain Enter inserts a newline. The actual send/streaming lives in
	 * `chatStore`; this component is a thin, controlled input.
	 */
	let {
		streaming = $bindable(false),
		onSend,
		onStop
	}: {
		streaming?: boolean;
		onSend: (text: string) => void | Promise<void>;
		onStop: () => void | Promise<void>;
	} = $props();

	let prompt = $state('');
	const canSend = $derived(prompt.trim().length > 0 && !streaming);

	function send() {
		if (!canSend) return;
		const text = prompt.trim();
		prompt = '';
		void onSend(text);
	}

	function onKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			send();
		}
	}
</script>

<div class="flex items-end gap-2">
	<textarea
		bind:value={prompt}
		onkeydown={onKeydown}
		rows="2"
		placeholder="Message the active provider…  (⌘/Ctrl+Enter to send)"
		class="min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
		disabled={streaming}></textarea>
	{#if streaming}
		<Button
			variant="destructive"
			size="icon"
			onclick={() => void onStop()}
			title="Stop"
			aria-label="Stop"
		>
			<Square />
		</Button>
	{:else}
		<Button size="icon" onclick={send} disabled={!canSend} title="Send" aria-label="Send">
			<Send />
		</Button>
	{/if}
</div>

<script lang="ts">
	import { Send, Square } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { getActiveProvider } from '$lib/ai/client';
	import { formatProviderError, type FormattedProviderError } from '$lib/ai/errors';
	import type { ChatMessage } from '$lib/ai/types';

	// P1 demo: ephemeral streaming panel. P2 owns the real message list/composer.
	let prompt = $state('');
	let buffer = $state('');
	let streaming = $state(false);
	let error = $state<FormattedProviderError | null>(null);
	let controller: AbortController | null = null;

	const canSend = $derived(prompt.trim().length > 0 && !streaming);

	async function send() {
		if (!canSend) return;
		error = null;
		buffer = '';
		streaming = true;
		controller = new AbortController();

		const messages: ChatMessage[] = [{ role: 'user', content: prompt.trim() }];
		try {
			const provider = await getActiveProvider();
			for await (const token of provider.chatStream(messages, { signal: controller.signal })) {
				buffer += token.text ?? token.delta ?? '';
			}
		} catch (err) {
			// AbortError from Stop is expected — don't surface it as an error.
			if (err instanceof DOMException && err.name === 'AbortError') {
				/* stopped by user */
			} else {
				error = formatProviderError(err);
			}
		} finally {
			streaming = false;
			controller = null;
		}
	}

	function stop() {
		controller?.abort();
	}

	function onKeydown(e: KeyboardEvent) {
		// Cmd/Ctrl+Enter sends; plain Enter inserts a newline (textarea default).
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void send();
		}
	}
</script>

<svelte:head>
	<title>Chat — Mayon</title>
</svelte:head>

<div class="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6">
	<div class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Chat</h1>
		<p class="text-sm text-muted-foreground">
			Ephemeral streaming demo (P1). Replies are not saved — the persistent chat lands in P2.
		</p>
	</div>

	<div class="flex flex-1 flex-col gap-3 overflow-hidden">
		<div class="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-muted/30 p-4">
			{#if buffer}
				<pre
					class="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{buffer}</pre>
			{:else if !streaming}
				<p class="text-sm text-muted-foreground">Type a prompt below and press Send.</p>
			{:else}
				<p class="text-sm text-muted-foreground">Waiting for the first token…</p>
			{/if}
		</div>

		{#if error}
			<div class="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
				<p class="font-medium text-red-700 dark:text-red-400">{error.title}</p>
				<p class="mt-0.5 text-red-700/90 dark:text-red-400/90">{error.message}</p>
				{#if error.hint}
					<p class="mt-1 text-xs text-muted-foreground">{error.hint}</p>
				{/if}
			</div>
		{/if}

		<div class="flex items-end gap-2">
			<textarea
				bind:value={prompt}
				onkeydown={onKeydown}
				rows="2"
				placeholder="Message the active provider…  (⌘/Ctrl+Enter to send)"
				class="min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				disabled={streaming}></textarea>
			{#if streaming}
				<Button variant="destructive" size="icon" onclick={stop} title="Stop" aria-label="Stop">
					<Square />
				</Button>
			{:else}
				<Button size="icon" onclick={send} disabled={!canSend} title="Send" aria-label="Send">
					<Send />
				</Button>
			{/if}
		</div>
	</div>
</div>

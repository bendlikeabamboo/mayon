<script lang="ts">
	import { onMount } from 'svelte';
	import { Brain, Send, Square } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { repos } from '$lib/db';
	import type { ReasoningMode } from '$lib/ai/types';

	/**
	 * Prompt input + Send/Stop. Mirrors StreamDemo's interaction: ⌘/Ctrl+Enter
	 * sends, plain Enter inserts a newline. The actual send/streaming lives in
	 * `chatStore`; this component is a thin, controlled input.
	 *
	 * A "Thinking on/off" pill controls reasoning for normal replies. Default is
	 * ON (provider default reasoning); the choice persists across reloads via the
	 * `reasoningEnabled` settings KV (boolean).
	 */
	let {
		streaming = $bindable(false),
		onSend,
		onStop
	}: {
		streaming?: boolean;
		onSend: (text: string, reasoning: ReasoningMode) => void | Promise<void>;
		onStop: () => void | Promise<void>;
	} = $props();

	let prompt = $state('');
	/** Reasoning toggle state: ON = provider default (`'auto'`), OFF = disabled. */
	let thinkingOn = $state(true);
	const reasoning = $derived<ReasoningMode>(thinkingOn ? 'auto' : 'disabled');
	const canSend = $derived(prompt.trim().length > 0 && !streaming);

	onMount(async () => {
		const stored = await repos.settings.get<boolean>('reasoningEnabled');
		// `null` (never set) defaults to ON; otherwise honor the stored bool.
		thinkingOn = stored !== false;
	});

	async function toggleThinking() {
		if (streaming) return;
		thinkingOn = !thinkingOn;
		await repos.settings.set('reasoningEnabled', thinkingOn);
	}

	function send() {
		if (!canSend) return;
		const text = prompt.trim();
		prompt = '';
		void onSend(text, reasoning);
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
	<Button
		variant={thinkingOn ? 'secondary' : 'outline'}
		size="icon"
		onclick={toggleThinking}
		disabled={streaming}
		title={thinkingOn
			? 'Thinking: on — tap to disable reasoning'
			: 'Thinking: off — tap to enable reasoning'}
		aria-label={thinkingOn ? 'Thinking on' : 'Thinking off'}
		aria-pressed={thinkingOn}
	>
		<Brain class="size-4" />
	</Button>
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

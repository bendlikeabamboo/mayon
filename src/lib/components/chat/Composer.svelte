<script lang="ts">
	import { onMount } from 'svelte';
	import { Brain, Send, Square } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { repos } from '$lib/db';
	import type { ReasoningEffort } from '$lib/ai/types';

	/**
	 * Prompt input + Send/Stop. Mirrors StreamDemo's interaction: ⌘/Ctrl+Enter
	 * sends, plain Enter inserts a newline. The actual send/streaming lives in
	 * `chatStore`; this component is a thin, controlled input.
	 *
	 * A 3-tier "Thinking" selector cycles through off → on → deep.
	 * The choice persists across reloads via the `reasoningEffort` settings KV.
	 */
	let {
		streaming = $bindable(false),
		onSend,
		onStop,
		suggestedReplies
	}: {
		streaming?: boolean;
		onSend: (text: string, effort: ReasoningEffort) => void | Promise<void>;
		onStop: () => void | Promise<void>;
		suggestedReplies?: string[];
	} = $props();

	let prompt = $state('');
	/** Reasoning effort: off (disabled), on (provider default), deep (extra reasoning). */
	let effort = $state<ReasoningEffort>('on');
	const canSend = $derived(prompt.trim().length > 0 && !streaming);
	const showChips = $derived(
		!!suggestedReplies?.length && !streaming && prompt.trim().length === 0
	);

	onMount(async () => {
		const v = await repos.settings.get<string>('reasoningEffort');
		if (v === 'off' || v === 'on' || v === 'deep') {
			effort = v;
			return;
		}
		const legacy = await repos.settings.get<boolean>('reasoningEnabled');
		effort = legacy === false ? 'off' : 'on';
		await repos.settings.set('reasoningEffort', effort);
		await repos.settings.delete('reasoningEnabled');
	});

	const NEXT: Record<ReasoningEffort, ReasoningEffort> = { on: 'deep', deep: 'off', off: 'on' };
	async function cycleThinking() {
		if (streaming) return;
		effort = NEXT[effort];
		await repos.settings.set('reasoningEffort', effort);
	}

	function sendChip(text: string) {
		prompt = '';
		void onSend(text, effort);
	}

	function send() {
		if (!canSend) return;
		const text = prompt.trim();
		prompt = '';
		void onSend(text, effort);
	}

	function onKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			send();
		}
	}
</script>

<div class="flex flex-col gap-2">
	{#if showChips}
		<div class="flex flex-wrap gap-1.5">
			{#each suggestedReplies as chip (chip)}
				<Button variant="outline" size="sm" onclick={() => sendChip(chip)}>
					{chip}
				</Button>
			{/each}
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
		<div class="relative">
			<Button
				variant={effort === 'off' ? 'outline' : 'secondary'}
				size="icon"
				onclick={cycleThinking}
				disabled={streaming}
				title={effort === 'off'
					? 'Thinking: off — tap to enable'
					: effort === 'on'
						? 'Thinking: on — tap for deep reasoning'
						: 'Thinking: deep (more reasoning tokens) — tap to disable'}
				aria-label={effort === 'off'
					? 'Thinking off'
					: effort === 'on'
						? 'Thinking on'
						: 'Thinking deep'}
				aria-pressed={effort !== 'off'}
			>
				<Brain class="size-4" />
				{#if effort === 'deep'}
					<span
						class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary"
						aria-hidden="true"
					></span>
				{/if}
			</Button>
		</div>
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
</div>

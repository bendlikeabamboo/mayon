<script lang="ts">
	import { onMount } from 'svelte';
	import { Brain, Send, Square } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		DropdownMenu,
		DropdownMenuTrigger,
		DropdownMenuContent,
		DropdownMenuCheckboxItem
	} from '$lib/components/ui/dropdown-menu/index.js';
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
		prompt = $bindable(''),
		streaming = $bindable(false),
		onSend,
		onStop,
		suggestedReplies,
		supportsDeep = true,
		providerName,
		modelId
	}: {
		prompt?: string;
		streaming?: boolean;
		onSend: (text: string, effort: ReasoningEffort) => void | Promise<void>;
		onStop: () => void | Promise<void>;
		suggestedReplies?: string[];
		supportsDeep?: boolean;
		providerName?: string;
		modelId?: string;
	} = $props();
	/** Reasoning effort: off (disabled), on (provider default), deep (extra reasoning). */
	let effort = $state<ReasoningEffort>('on');
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	const MAX_TEXTAREA_H = 22 * 16;
	$effect(() => {
		void prompt;
		const el = textareaEl;
		if (!el) return;
		if (!prompt) {
			el.style.height = '';
			return;
		}
		el.style.height = 'auto';
		el.style.height = Math.min(el.scrollHeight, MAX_TEXTAREA_H) + 'px';
	});
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

	async function setEffort(next: ReasoningEffort) {
		if (streaming) return;
		effort = next;
		await repos.settings.set('reasoningEffort', next);
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
		{#if providerName && modelId}
			<span class="mb-2 shrink-0 text-xs text-muted-foreground">{providerName} · {modelId}</span>
		{/if}
		<textarea
			bind:this={textareaEl}
			bind:value={prompt}
			onkeydown={onKeydown}
			rows="2"
			placeholder="Message the active provider…  (⌘/Ctrl+Enter to send)"
			class="min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
			disabled={streaming}></textarea>
		{#snippet triggerChild({ props }: { props: Record<string, unknown> })}
			<Button
				{...props}
				variant={effort === 'off' ? 'outline' : 'secondary'}
				size="icon"
				disabled={streaming}
				title="Thinking"
				aria-label="Thinking"
				aria-pressed={effort !== 'off'}
			>
				<Brain class="size-4" />
			</Button>
		{/snippet}
		<DropdownMenu>
			<DropdownMenuTrigger child={triggerChild} />
			<DropdownMenuContent side="top" align="end" class="w-56">
				<DropdownMenuCheckboxItem
					checked={effort === 'off'}
					onCheckedChange={() => void setEffort('off')}
				>
					Off
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem
					checked={effort === 'on'}
					onCheckedChange={() => void setEffort('on')}
				>
					On
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem
					checked={effort === 'deep'}
					onCheckedChange={() => void setEffort('deep')}
				>
					<div class="flex flex-col">
						<span
							>Deep <span class="text-xs text-muted-foreground">(more reasoning tokens)</span></span
						>
						{#if !supportsDeep}
							<span class="text-xs text-amber-600 dark:text-amber-400"
								>not supported by this model</span
							>
						{/if}
					</div>
				</DropdownMenuCheckboxItem>
			</DropdownMenuContent>
		</DropdownMenu>
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

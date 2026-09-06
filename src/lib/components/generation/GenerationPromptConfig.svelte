<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { repos } from '$lib/db';

	/**
	 * Shared generation-prompt settings panel (feature 020, prompt-settings
	 * contract): renders the code-owned contract read-only, previews the saved
	 * custom instructions, and binds ONE textarea to the surface's
	 * `settingsKey` (save on blur; empty deletes the key). Used for BOTH the
	 * quiz and lab surfaces via thin wrappers — edit behavior here, never in
	 * one wrapper alone, so the two surfaces cannot drift.
	 */
	let {
		contract,
		settingsKey,
		title,
		noun
	}: { contract: string; settingsKey: string; title: string; noun: string } = $props();

	/** Capitalized `noun` (e.g. 'Quiz') for accessible names; lowercase for prose. */
	const nounLower = $derived(noun.toLowerCase());

	let value = $state('');
	let saved = $state<string | null>(null);
	let loading = $state(true);
	let status = $state<string | null>(null);

	onMount(async () => {
		saved = await repos.settings.get<string>(settingsKey);
		value = saved ?? '';
		loading = false;
	});

	async function save() {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			// Empty = contract only; delete the key rather than storing blanks.
			await repos.settings.delete(settingsKey);
			saved = null;
			value = '';
			status = 'Custom instructions cleared.';
			return;
		}
		await repos.settings.set(settingsKey, trimmed);
		saved = trimmed;
		status = `${noun} custom instructions saved.`;
	}

	function reset() {
		value = '';
		void save();
	}

	const textareaClass =
		'min-h-32 w-full rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring';
	const preClass =
		'whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs text-muted-foreground';
</script>

<section class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
		<Button variant="ghost" size="sm" onclick={reset} disabled={loading || !saved}>
			Reset instructions
		</Button>
	</div>

	<p class="text-xs text-muted-foreground">
		Custom instructions are appended after the {nounLower} contract when generating from a chat. The contract
		is read-only and always comes first.
	</p>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else}
		<div role="group" aria-label="{noun} effective prompt" class="space-y-3">
			<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Effective prompt
			</h3>
			<div role="group" aria-label="{noun} contract (read-only)" class="space-y-1">
				<p class="text-xs text-muted-foreground">Contract (read-only)</p>
				<pre class={`max-h-80 overflow-auto ${preClass}`}>{contract}</pre>
			</div>
			{#if saved}
				<div role="group" aria-label="{noun} instructions preview" class="space-y-1">
					<p class="text-xs text-muted-foreground"># Custom instructions</p>
					<pre class={preClass}>{saved}</pre>
				</div>
			{/if}
		</div>

		<textarea
			class={textareaClass}
			placeholder="Optional custom instructions appended after the contract…"
			aria-label="{noun} custom instructions"
			{value}
			oninput={(e) => (value = e.currentTarget.value)}
			onblur={save}></textarea>

		{#if status}
			<p class="text-xs text-muted-foreground" role="status">{status}</p>
		{/if}
	{/if}
</section>

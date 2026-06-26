<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { repos } from '$lib/db';
	import { DEFAULT_LAB_PROMPT } from '$lib/ai/generate/generate';

	/**
	 * Lab generation prompt override. Bound to the `labPrompt` settings KV; when
	 * empty (or reset), generation falls back to DEFAULT_LAB_PROMPT (shown as a
	 * read-only preview). Saved on blur so typing doesn't hit the DB per keystroke.
	 */
	const LAB_PROMPT_KEY = 'labPrompt';

	let value = $state('');
	let saved = $state<string | null>(null);
	let loading = $state(true);
	let status = $state<string | null>(null);

	onMount(async () => {
		saved = await repos.settings.get<string>(LAB_PROMPT_KEY);
		value = saved ?? '';
		loading = false;
	});

	async function save() {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			// Empty = use default; clear the override rather than storing blanks.
			await repos.settings.delete(LAB_PROMPT_KEY);
			saved = null;
			value = '';
			status = 'Reset to default prompt.';
			return;
		}
		await repos.settings.set(LAB_PROMPT_KEY, trimmed);
		saved = trimmed;
		status = 'Lab prompt saved.';
	}

	function reset() {
		value = '';
		void save();
	}

	const textareaClass =
		'min-h-40 w-full rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring';
</script>

<section class="space-y-3">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
			Lab generation prompt
		</h2>
		{#if saved}
			<Button variant="ghost" size="sm" onclick={reset}>Reset to default</Button>
		{/if}
	</div>

	<p class="text-xs text-muted-foreground">
		The system instruction used when generating a lab from a chat. Leave empty to use the built-in
		default (shown below).
	</p>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else}
		<textarea
			class={textareaClass}
			placeholder={DEFAULT_LAB_PROMPT}
			{value}
			oninput={(e) => (value = e.currentTarget.value)}
			onblur={save}></textarea>

		{#if status}
			<p class="text-xs text-muted-foreground" role="status">{status}</p>
		{/if}

		{#if !saved}
			<details class="rounded-md border border-border bg-muted/30 p-3">
				<summary class="cursor-pointer text-xs font-medium text-muted-foreground">
					Default prompt (currently in use)
				</summary>
				<pre
					class="mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{DEFAULT_LAB_PROMPT}</pre>
			</details>
		{/if}
	{/if}
</section>

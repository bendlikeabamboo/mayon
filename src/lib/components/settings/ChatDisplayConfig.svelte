<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { isStripEnabled, setStripEnabled } from '$lib/chat/strip/pref';

	let stripEnabled = $state(true);
	let loading = $state(true);

	onMount(async () => {
		stripEnabled = await isStripEnabled();
		loading = false;
	});

	async function toggleStrip() {
		const next = !stripEnabled;
		stripEnabled = next;
		try {
			await setStripEnabled(next);
		} catch {
			stripEnabled = !next;
		}
	}
</script>

<section class="space-y-3">
	<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Chat</h2>

	<p class="text-xs text-muted-foreground">Display options for the conversation transcript.</p>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else}
		<div class="flex items-center justify-between gap-3">
			<div class="min-w-0">
				<p class="text-sm">Section strip in long replies</p>
				<p class="text-xs text-muted-foreground">Hover-peek section navigation on long replies.</p>
			</div>
			<Button
				variant={stripEnabled ? 'outline' : 'ghost'}
				size="sm"
				aria-pressed={stripEnabled}
				onclick={toggleStrip}
			>
				{stripEnabled ? 'On' : 'Off'}
			</Button>
		</div>
	{/if}
</section>

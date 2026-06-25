<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { labsStore } from '$lib/stores/labs.svelte';
	import LabRunner from '$lib/components/labs/LabRunner.svelte';

	/**
	 * Lab runner route. Loads the lab into `labsStore.current` on mount and on
	 * `[id]` change (mirrors `/chat/[id]`'s `$effect` param-watch pattern).
	 * Shows loading / not-found states before delegating to `<LabRunner>`.
	 */
	onMount(() => {
		const initial = page.params.id;
		if (initial) return labsStore.loadLab(initial);
	});

	// Reload when navigating between labs ([id] changes).
	let lastId = page.params.id;
	$effect(() => {
		const current = page.params.id;
		if (current && current !== lastId) {
			lastId = current;
			void labsStore.loadLab(current);
		}
	});
</script>

{#if labsStore.loading}
	<div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
		<p class="py-8 text-center text-sm text-muted-foreground">Loading lab…</p>
	</div>
{:else if !labsStore.current}
	<div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
		<div class="py-8 text-center">
			<p class="text-sm text-muted-foreground">Lab not found.</p>
			<Button href="/lab" variant="link" class="mt-2">Back to labs</Button>
		</div>
	</div>
{:else}
	<LabRunner lab={labsStore.current} />
{/if}

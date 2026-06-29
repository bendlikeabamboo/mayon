<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PublicApprovalEntry } from '$lib/stores/chat.svelte';

	type Props = {
		entry: PublicApprovalEntry;
		onApprove: () => void;
		onDecline: () => void;
	};

	let { entry, onApprove, onDecline }: Props = $props();

	const argsJson = $derived(JSON.stringify(entry.args, null, 2));
</script>

<div class="rounded-md border border-border bg-card p-3 text-sm">
	<p class="font-medium">{entry.description}</p>
	{#if argsJson !== 'undefined' && argsJson !== 'null'}
		<pre class="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{argsJson}</pre>
	{/if}
	<div class="mt-3 flex gap-2">
		<Button variant="default" size="sm" onclick={onApprove}>Approve</Button>
		<Button variant="outline" size="sm" onclick={onDecline}>Decline</Button>
	</div>
</div>

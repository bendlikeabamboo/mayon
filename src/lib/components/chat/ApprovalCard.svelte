<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { summarizeToolCall } from '$lib/agent/tool-summary';
	import type { PublicApprovalEntry } from '$lib/stores/chat.svelte';

	type Props = {
		entry: PublicApprovalEntry;
		onApprove: () => void;
		onDecline: () => void;
	};

	let { entry, onApprove, onDecline }: Props = $props();

	const argsJson = $derived(JSON.stringify(entry.args, null, 2));
	const summary = $derived(summarizeToolCall(entry.toolName, entry.args));
</script>

<div class="rounded-md border border-border bg-card p-3 text-sm">
	{#if summary}
		<p class="font-medium">{summary}</p>
		<p class="mt-0.5 text-xs text-muted-foreground">{entry.description}</p>
	{:else}
		<p class="font-medium">{entry.description}</p>
	{/if}
	{#if argsJson !== 'undefined' && argsJson !== 'null'}
		<details class="mt-2">
			<summary class="cursor-pointer text-xs text-muted-foreground">Raw arguments</summary>
			<pre class="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{argsJson}</pre>
		</details>
	{/if}
	<div class="mt-3 flex gap-2">
		<Button variant="default" size="sm" onclick={onApprove}>Approve</Button>
		<Button variant="outline" size="sm" onclick={onDecline}>Decline</Button>
	</div>
</div>

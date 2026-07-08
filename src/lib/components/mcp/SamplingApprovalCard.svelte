<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PublicMcpSamplingEntry } from '$lib/stores/chat.svelte';

	type Props = {
		entry: PublicMcpSamplingEntry;
		onApprove: () => void;
		onDecline: () => void;
	};

	let { entry, onApprove, onDecline }: Props = $props();
</script>

<div class="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
	<div class="flex items-center gap-2">
		<span
			class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
		>
			MCP Sampling
		</span>
		<span class="font-medium">{entry.serverName}</span>
	</div>
	<p class="mt-1 text-xs text-muted-foreground">
		Token budget: {entry.remainingBudget} remaining (max {entry.maxTokens} per call)
	</p>
	<details class="mt-2">
		<summary class="cursor-pointer text-xs text-muted-foreground">Server prompt preview</summary>
		<pre
			class="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{entry.prompt}</pre>
	</details>
	<div class="mt-3 flex gap-2">
		<Button variant="default" size="sm" onclick={onApprove}>Approve</Button>
		<Button variant="outline" size="sm" onclick={onDecline}>Decline</Button>
	</div>
</div>

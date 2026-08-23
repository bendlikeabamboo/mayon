<script lang="ts">
	import * as Command from '$lib/components/ui/command/index.js';
	import type { Snippet } from 'svelte';

	let {
		heading,
		children,
		...restProps
	}: { heading?: string; children: Snippet } & Record<string, unknown> = $props();
</script>

<Command.Group {heading} {...restProps}>
	{@render children()}
</Command.Group>

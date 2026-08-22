<script lang="ts">
	import * as Command from '$lib/components/ui/command/index.js';
	import type { Snippet } from 'svelte';

	let { children, ...restProps }: { children?: Snippet } & Record<string, unknown> = $props();
</script>

<Command.Empty {...restProps}>
	{#if children}
		{@render children()}
	{/if}
</Command.Empty>

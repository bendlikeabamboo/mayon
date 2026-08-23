<script lang="ts">
	import * as Command from '$lib/components/ui/command/index.js';
	import type { Snippet } from 'svelte';

	let {
		children,
		onselect,
		...restProps
	}: { children: Snippet; onselect?: () => void } & Record<string, unknown> = $props();
</script>

<Command.Item onSelect={onselect} {...restProps}>
	{@render children()}
</Command.Item>

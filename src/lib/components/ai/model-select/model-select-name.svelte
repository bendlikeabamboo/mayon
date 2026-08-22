<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let {
		class: className,
		children,
		...restProps
	}: { class?: string; children: Snippet } & Record<string, unknown> = $props();
</script>

<span class={cn('flex-1 truncate text-left', className)} {...restProps}>
	{@render children()}
</span>

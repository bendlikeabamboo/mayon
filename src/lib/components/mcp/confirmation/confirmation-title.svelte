<script lang="ts">
	import type { Snippet } from 'svelte';
	import { AlertDescription } from '$lib/components/ui/alert/index.js';

	let {
		class: className,
		children,
		...restProps
	}: {
		class?: string;
		children?: Snippet;
	} & Record<string, unknown> = $props();
</script>

<AlertDescription class={className} {...restProps}>
	{@render children?.()}
</AlertDescription>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getConfirmationContext } from './confirmation-context.svelte.js';

	let {
		children,
		...restProps
	}: {
		class?: string;
		children?: Snippet;
	} & Record<string, unknown> = $props();

	const ctx = getConfirmationContext();
	let shouldShow = $derived(ctx.state === 'pending');
</script>

{#if shouldShow}
	<div class="flex items-center justify-end gap-2 self-end" {...restProps}>
		{@render children?.()}
	</div>
{/if}

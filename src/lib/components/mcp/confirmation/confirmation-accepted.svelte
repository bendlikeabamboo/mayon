<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getConfirmationContext } from './confirmation-context.svelte.js';

	let { children }: { children?: Snippet } = $props();

	const ctx = getConfirmationContext();
	let shouldShow = $derived(ctx.state === 'succeeded');
</script>

{#if shouldShow}
	{@render children?.()}
{/if}

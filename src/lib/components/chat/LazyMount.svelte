<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	let { children, rootMargin = '400px' }: { children: Snippet; rootMargin?: string } = $props();
	let el = $state<HTMLDivElement | null>(null);
	let visible = $state(false);
	onMount(() => {
		if (!el) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					visible = true;
					io.disconnect();
				}
			},
			{ rootMargin }
		);
		io.observe(el);
		return () => io.disconnect();
	});
</script>

<div bind:this={el}>
	{#if visible}{@render children()}{/if}
</div>

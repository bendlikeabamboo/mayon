<script module>
	export function resizeobserve(node: HTMLElement, cb: (entry: ResizeObserverEntry) => void) {
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) cb(entry);
		});
		ro.observe(node);
		return {
			destroy() {
				ro.disconnect();
			}
		};
	}
</script>

<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	let {
		children,
		rootMargin = '400px',
		unmountFar = false
	}: { children: Snippet; rootMargin?: string; unmountFar?: boolean } = $props();
	let sentinel = $state<HTMLDivElement | null>(null);
	let visible = $state(false);
	let measuredHeight = $state(0);
	onMount(() => {
		if (!sentinel) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					visible = true;
					if (!unmountFar) {
						io.disconnect();
					}
				} else if (unmountFar) {
					visible = false;
				}
			},
			{ rootMargin }
		);
		io.observe(sentinel);
		return () => io.disconnect();
	});

	function onResize(entry: ResizeObserverEntry) {
		const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
		if (h > 0) measuredHeight = h;
	}
</script>

<div bind:this={sentinel}>
	{#if visible}
		<div class="lazy-mount-content" use:resizeobserve={(entry) => onResize(entry)}>
			{@render children()}
		</div>
	{:else if unmountFar && measuredHeight > 0}
		<div style="height: {measuredHeight}px;"></div>
	{/if}
</div>

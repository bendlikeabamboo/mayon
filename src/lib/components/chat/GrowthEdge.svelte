<script lang="ts">
	import { resolveEdgeTarget, type EdgeEffect } from '$lib/chat/streaming/edge-target';
	import { incRender } from '$lib/perf/mark';

	let {
		variant,
		buffer,
		lifting
	}: { variant: 'blur-fade' | 'caret'; buffer: string; lifting: boolean } = $props();

	let host = $state<HTMLDivElement | null>(null);
	let rect = $state<{ top: number; left: number; width: number; height: number } | null>(null);
	let edgeEffect = $state<EdgeEffect>('hidden');

	incRender('GrowthEdge');

	$effect(() => {
		void buffer;
		const el = host;
		if (!el) return;
		// ponytail: rect is viewport-frame minus host frame at flush time; a
		// re-wrap between flushes leaves a one-flush stale rect (accepted, spec'd).
		const raf = requestAnimationFrame(() => {
			// The overlay host is empty by contract (zero text nodes) — measure
			// the markdown element it overlays (previous sibling of this root).
			const markdown = el.previousElementSibling as HTMLElement | null;
			const target = markdown
				? resolveEdgeTarget(markdown)
				: { rect: null, effect: 'hidden' as const };
			if (target.rect) {
				const hr = el.getBoundingClientRect();
				rect = {
					top: target.rect.top - hr.top,
					left: target.rect.left - hr.left,
					width: target.rect.width,
					height: target.rect.height
				};
			} else {
				rect = null;
			}
			edgeEffect = target.effect;
		});
		return () => cancelAnimationFrame(raf);
	});
</script>

<div bind:this={host} class="pointer-events-none absolute inset-0 z-10">
	{#if rect && edgeEffect !== 'suppressed'}
		{#if variant === 'caret'}
			<div
				class="growth-caret growth-edge-liftable motion-reduce:transition-none {lifting
					? 'growth-edge-lift'
					: ''}"
				style="top:{rect.top}px;left:{rect.left + rect.width - 2}px;height:{Math.max(
					rect.height,
					14
				)}px"
			></div>
		{:else}
			<div
				class="growth-edge-blur growth-edge-liftable motion-reduce:transition-none {edgeEffect ===
				'soften'
					? 'growth-edge-soften'
					: ''} {lifting ? 'growth-edge-lift' : ''}"
				style="top:{rect.top}px;left:{rect.left}px;width:{rect.width}px;height:{rect.height}px"
			></div>
		{/if}
	{/if}
</div>

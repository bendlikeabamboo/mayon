<script lang="ts">
	import { onMount } from 'svelte';
	import type { Section } from '$lib/markdown/sections';
	import {
		dwellTransition,
		initialDwellState,
		type DwellResult,
		type DwellState
	} from '$lib/chat/strip/dwell';
	import { incRender } from '$lib/perf/mark';

	let {
		msgId,
		sections,
		onJump
	}: {
		msgId: string;
		sections: Section[];
		onJump: (index: number) => void;
	} = $props();

	const previewId = $derived(`section-strip-preview-${msgId}`);

	let isTouch = $state(false);
	let previewIndex = $state<number | null>(null);
	let previewTop = $state(0);
	let stripEl: HTMLElement | null = null;
	let hoveredBarTop = 0;
	let dwellState: DwellState = initialDwellState();
	let dwellTimer: ReturnType<typeof setTimeout> | null = null;

	function clearDwellTimer() {
		if (dwellTimer !== null) {
			clearTimeout(dwellTimer);
			dwellTimer = null;
		}
	}

	function applyDwell(result: DwellResult) {
		dwellState = result.state;
		clearDwellTimer();
		if (result.armTimerMs !== null && result.state.hoveredIndex !== null) {
			const index = result.state.hoveredIndex;
			dwellTimer = setTimeout(() => {
				dwellTimer = null;
				applyDwell(dwellTransition(dwellState, { kind: 'dwell-fire', index }));
			}, result.armTimerMs);
		}
		if (result.closePreview) previewIndex = null;
		if (result.openPreview !== null) {
			const wrapH = stripEl?.clientHeight ?? 0;
			previewTop = Math.max(0, Math.min(hoveredBarTop - 6, Math.max(0, wrapH - 150)));
			previewIndex = result.openPreview;
		}
	}

	function handleBarEnter(index: number, el: HTMLElement) {
		if (isTouch) return;
		hoveredBarTop = el.offsetTop;
		const kind =
			dwellState.hoveredIndex !== null && dwellState.hoveredIndex !== index
				? 'enter-other-bar'
				: 'enter-bar';
		applyDwell(dwellTransition(dwellState, { kind, index }));
	}

	function handleBarLeave(event: PointerEvent) {
		if (isTouch) return;
		const entered = event.relatedTarget;
		if (entered instanceof Element && entered.closest('.section-strip-preview')) return;
		applyDwell(dwellTransition(dwellState, { kind: 'leave-bar' }));
	}

	function handleStripLeave() {
		applyDwell(dwellTransition(dwellState, { kind: 'leave-strip' }));
	}

	function jumpTo(index: number) {
		clearDwellTimer();
		dwellState = initialDwellState();
		previewIndex = null;
		onJump(index);
	}

	onMount(() => {
		const mq = window.matchMedia('(hover: none), (pointer: coarse)');
		isTouch = mq.matches;
		function onMatchChange(e: MediaQueryListEvent) {
			isTouch = e.matches;
		}
		mq.addEventListener('change', onMatchChange);
		return () => {
			mq.removeEventListener('change', onMatchChange);
			clearDwellTimer();
		};
	});

	incRender('SectionStrip');
</script>

<div
	bind:this={stripEl}
	role="navigation"
	aria-label="Reply sections"
	class="section-strip pointer-events-none absolute top-0 bottom-8 -right-2 z-10 flex w-4 flex-col items-end gap-px text-border {isTouch
		? ''
		: 'group/strip group-hover/strip:text-muted-foreground/40'}"
	onpointerleave={handleStripLeave}
>
	{#each sections as section (section.index)}
		<button
			type="button"
			class="group/bar pointer-events-auto flex w-4 min-h-6 items-stretch justify-end py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {isTouch
				? ''
				: 'group-hover/bar:text-ring'}"
			style="flex-grow:{Math.max(section.length, 1)};flex-basis:0;"
			aria-label={section.title || `Section ${section.index + 1}`}
			aria-describedby={previewIndex === section.index ? previewId : undefined}
			onpointerenter={(e) => handleBarEnter(section.index, e.currentTarget as HTMLElement)}
			onpointerleave={handleBarLeave}
			onclick={() => jumpTo(section.index)}
		>
			<span
				class="min-h-1 w-[2px] self-stretch rounded-full bg-current transition-[width,background-color] duration-150 motion-reduce:transition-none {isTouch
					? ''
					: 'group-hover/strip:w-2'}"
			></span>
		</button>
	{/each}
	{#if previewIndex !== null && sections[previewIndex]}
		<div
			id={previewId}
			role="tooltip"
			class="section-strip-preview pointer-events-auto absolute right-full z-10 mr-1 max-w-xs rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md transition-opacity duration-150 motion-reduce:transition-none"
			style="top:{previewTop}px"
		>
			<button
				type="button"
				class="block w-full text-left"
				onclick={() => {
					if (previewIndex !== null) jumpTo(previewIndex);
				}}
			>
				<span class="block truncate font-medium">
					{sections[previewIndex].title || `Section ${previewIndex + 1}`}
				</span>
				{#if sections[previewIndex].excerpt}
					<span class="mt-1 block text-muted-foreground">{sections[previewIndex].excerpt}</span>
				{/if}
			</button>
		</div>
	{/if}
</div>

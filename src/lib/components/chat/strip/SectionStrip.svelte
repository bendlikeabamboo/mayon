<script lang="ts">
	import { onMount } from 'svelte';
	import type { Section } from '$lib/markdown/sections';
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

	let isTouch = $state(false);

	onMount(() => {
		const mq = window.matchMedia('(hover: none), (pointer: coarse)');
		isTouch = mq.matches;
		function onMatchChange(e: MediaQueryListEvent) {
			isTouch = e.matches;
		}
		mq.addEventListener('change', onMatchChange);
		return () => mq.removeEventListener('change', onMatchChange);
	});

	incRender('SectionStrip');
</script>

<div
	role="navigation"
	aria-label="Reply sections"
	data-msg-id={msgId}
	class="section-strip pointer-events-none absolute inset-y-0 -right-2 z-10 flex w-4 flex-col items-end gap-px text-border {isTouch
		? ''
		: 'group/strip group-hover/strip:text-muted-foreground/40'}"
>
	{#each sections as section (section.index)}
		<button
			type="button"
			class="group/bar pointer-events-auto flex w-4 min-h-6 items-stretch justify-end py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {isTouch
				? ''
				: 'group-hover/bar:text-ring'}"
			style="flex-grow:{Math.max(section.length, 1)};flex-basis:0;"
			aria-label={section.title || `Section ${section.index + 1}`}
			onclick={() => onJump(section.index)}
		>
			<span
				class="min-h-1 w-[2px] self-stretch rounded-full bg-current transition-[width,background-color] duration-150 motion-reduce:transition-none {isTouch
					? ''
					: 'group-hover/strip:w-2'}"
			></span>
		</button>
	{/each}
</div>

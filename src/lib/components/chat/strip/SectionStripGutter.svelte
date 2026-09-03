<script lang="ts">
	import { onMount } from 'svelte';
	import type { Section } from '$lib/markdown/sections';
	import {
		getStripPrefFromContext,
		getStripRegistry,
		type StripRegistry
	} from '$lib/chat/strip/registry.svelte';
	import {
		dwellTransition,
		initialDwellState,
		type DwellResult,
		type DwellState
	} from '$lib/chat/strip/dwell';
	import { incRender } from '$lib/perf/mark';

	let {
		viewportEl,
		onJump
	}: {
		viewportEl: HTMLElement;
		onJump: (msgId: string, index: number) => void;
	} = $props();

	const registry = getStripRegistry();
	// Derived (not a one-shot const): the context flag is getter-backed page
	// state, so toggling the preference reactively shows/hides the gutter.
	const stripOn = $derived(getStripPrefFromContext());

	// The layer is 16px wide; a 12px right offset parks the preview's right edge
	// 4px inside the layer's left edge — just right of the scrollbar — while the
	// card body extends leftward over the chat area, unclipped (no overflow-hidden
	// on this layer).
	const PREVIEW_RIGHT_PX = 12;

	interface AnchorBox {
		docTop: number;
		height: number;
	}

	let anchorMap = $state<Record<string, AnchorBox>>({});
	let syncTop = $state(0);
	let rootEl = $state<HTMLElement | null>(null);

	function measure(reg: StripRegistry) {
		const next: Record<string, AnchorBox> = {};
		for (const entry of reg.entries) {
			if (!entry.el.isConnected) continue;
			next[entry.msgId] = {
				docTop:
					entry.el.getBoundingClientRect().top -
					viewportEl.getBoundingClientRect().top +
					viewportEl.scrollTop,
				height: entry.el.offsetHeight
			};
		}
		anchorMap = next;
	}

	$effect(() => {
		const reg = registry;
		if (!reg) return;
		// Dependency is the registry's version counter only: `entries` is a
		// plain array (mutation-safe to call from effects), so tracking it
		// directly is impossible — the counter is the invalidation signal.
		void reg.version;
		measure(reg);
	});

	$effect(() => {
		const el = viewportEl;
		const reg = registry;
		if (!el || !reg) return;
		const ro = new ResizeObserver(() => measure(reg));
		ro.observe(el);
		return () => ro.disconnect();
	});

	let frame: number | null = null;
	function flush() {
		frame = null;
		syncTop = viewportEl.scrollTop;
	}
	function onScroll() {
		if (frame !== null) return;
		frame = requestAnimationFrame(flush);
	}

	// Wheel relay (§5 amendment): the gutter is a sibling overlay OUTSIDE the
	// scroll container, so native wheel chaining cannot cross the sibling
	// boundary — the root forwards the gesture to the viewport instead
	// (FR-013). Exactly one listener, bound on the root so events bubbling
	// from the clip box, ticks, and the preview are covered. The clip box is
	// pointer-events-auto (it only covers the 16px gutter, no chat content
	// sits beneath it) so bare-gutter wheel also reaches this relay.
	function relayWheel(event: WheelEvent) {
		event.preventDefault();
		viewportEl.scrollBy(0, event.deltaY);
	}

	$effect(() => {
		const el = rootEl;
		if (!el) return;
		el.addEventListener('wheel', relayWheel);
		return () => el.removeEventListener('wheel', relayWheel);
	});

	let isTouch = $state(false);
	let preview = $state<{ msgId: string; index: number } | null>(null);
	let previewTop = $state(0);
	let hoveredTick = $state<{ msgId: string; index: number } | null>(null);
	let hoveredTickEl: HTMLElement | null = null;
	let dwellState: DwellState = initialDwellState();
	let dwellMsgId: string | null = null;
	let dwellTimer: ReturnType<typeof setTimeout> | null = null;

	const previewId = $derived(preview !== null ? `section-strip-preview-${preview.msgId}` : '');
	// Registry snapshot for the template: re-derived whenever the registry
	// version bumps (register/unregister/bump), reading the plain backing array.
	const entries = $derived.by(() => {
		void registry?.version;
		return registry?.entries.slice() ?? [];
	});
	const previewSection = $derived.by(() => {
		const open = preview;
		if (!open) return null;
		const reg = registry;
		if (!reg) return null;
		void reg.version;
		const entry = reg.entries.find((e) => e.msgId === open.msgId);
		return entry?.sections[open.index] ?? null;
	});

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
		if (result.closePreview) preview = null;
		if (result.openPreview !== null) {
			const rootRect = rootEl?.getBoundingClientRect();
			const tickRect = hoveredTickEl?.getBoundingClientRect();
			const layerHeight = rootEl?.clientHeight ?? 0;
			const tickY = tickRect && rootRect ? tickRect.top - rootRect.top : 0;
			previewTop = Math.max(0, Math.min(tickY - 75, Math.max(0, layerHeight - 150)));
			preview = dwellMsgId !== null ? { msgId: dwellMsgId, index: result.openPreview } : null;
		}
	}

	function handleTickEnter(msgId: string, index: number, el: HTMLElement) {
		if (isTouch) return;
		hoveredTickEl = el;
		const kind =
			dwellState.hoveredIndex !== null &&
			(dwellState.hoveredIndex !== index || dwellMsgId !== msgId)
				? 'enter-other-bar'
				: 'enter-bar';
		applyDwell(dwellTransition(dwellState, { kind, index }));
		dwellMsgId = msgId;
		hoveredTick = { msgId, index };
	}

	function handleTickLeave(event: PointerEvent) {
		if (isTouch) return;
		const entered = event.relatedTarget;
		if (entered instanceof Element && entered.closest('.section-strip-preview')) return;
		applyDwell(dwellTransition(dwellState, { kind: 'leave-bar' }));
		hoveredTick = null;
	}

	function handleGutterLeave(event: PointerEvent) {
		if (isTouch) return;
		const entered = event.relatedTarget;
		if (entered instanceof Element && entered.closest('.section-strip-preview')) return;
		applyDwell(dwellTransition(dwellState, { kind: 'leave-strip' }));
		hoveredTick = null;
	}

	function jumpTo(msgId: string, index: number) {
		clearDwellTimer();
		dwellState = initialDwellState();
		dwellMsgId = null;
		preview = null;
		hoveredTick = null;
		onJump(msgId, index);
	}

	function tickWidthPx(msgId: string, section: Section, sections: Section[]): string {
		const total = sections.reduce((sum, s) => sum + Math.max(s.length, 1), 0) || 1;
		const hovered =
			hoveredTick !== null && hoveredTick.msgId === msgId && hoveredTick.index === section.index;
		const base = Math.max(4, Math.min(12, (Math.max(section.length, 1) / total) * 16));
		return `${Math.min(base + (hovered ? 4 : 0), 16)}px`;
	}

	onMount(() => {
		viewportEl.addEventListener('scroll', onScroll, { passive: true });
		syncTop = viewportEl.scrollTop;
		const mq = window.matchMedia('(hover: none), (pointer: coarse)');
		isTouch = mq.matches;
		function onMatchChange(e: MediaQueryListEvent) {
			isTouch = e.matches;
		}
		mq.addEventListener('change', onMatchChange);
		return () => {
			viewportEl.removeEventListener('scroll', onScroll);
			mq.removeEventListener('change', onMatchChange);
			if (frame !== null) cancelAnimationFrame(frame);
			clearDwellTimer();
		};
	});

	incRender('SectionStripGutter');
</script>

{#if registry && stripOn}
	<div
		bind:this={rootEl}
		role="presentation"
		class="section-strip absolute inset-y-0 right-0 z-20 w-4 text-border pointer-events-none {isTouch
			? ''
			: 'group/strip'}"
		onpointerleave={handleGutterLeave}
	>
		<div class="absolute inset-0 overflow-hidden pointer-events-auto">
			<div class="absolute inset-x-0 top-0" style="transform:translate3d(0, -{syncTop}px, 0)">
				{#each entries as entry (entry.msgId)}
					{@const box = anchorMap[entry.msgId]}
					{#if box}
						<div
							role="navigation"
							aria-label="Reply sections"
							class="absolute flex w-full flex-col"
							style="top:{box.docTop}px; height:{box.height}px"
						>
							{#each entry.sections as section (section.index)}
								<button
									type="button"
									class="pointer-events-auto group/tick flex w-full min-h-6 items-center justify-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring {isTouch
										? ''
										: 'group-hover/strip:text-muted-foreground/60'}"
									style="flex-grow:{Math.max(section.length, 1)};flex-basis:0;"
									aria-label={section.title || `Section ${section.index + 1}`}
									aria-describedby={preview?.msgId === entry.msgId &&
									preview?.index === section.index
										? previewId
										: undefined}
									onpointerenter={(e) =>
										handleTickEnter(entry.msgId, section.index, e.currentTarget as HTMLElement)}
									onpointerleave={handleTickLeave}
									onclick={() => jumpTo(entry.msgId, section.index)}
								>
									<span
										class="h-[2px] rounded-full bg-current transition-[width,background-color] duration-150 motion-reduce:transition-none {isTouch
											? ''
											: 'group-hover/tick:text-ring'}"
										style:width={tickWidthPx(entry.msgId, section, entry.sections)}
									></span>
								</button>
							{/each}
						</div>
					{/if}
				{/each}
			</div>
		</div>
		{#if preview && previewSection}
			<div
				id={previewId}
				role="tooltip"
				class="section-strip-preview pointer-events-auto absolute z-10 max-w-xs rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md"
				style="right:{PREVIEW_RIGHT_PX}px; top:{previewTop}px"
			>
				<button
					type="button"
					class="block w-full text-left"
					onclick={() => preview && jumpTo(preview.msgId, preview.index)}
				>
					<span class="block truncate font-medium">
						{previewSection.title || `Section ${preview.index + 1}`}
					</span>
					{#if previewSection.excerpt}
						<span class="mt-1 block text-muted-foreground">{previewSection.excerpt}</span>
					{/if}
				</button>
			</div>
		{/if}
	</div>
{/if}

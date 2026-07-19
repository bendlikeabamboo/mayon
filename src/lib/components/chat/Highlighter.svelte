<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { BranchSource } from '$lib/db/schema';
	import { repos } from '$lib/db';
	import { alignDomToCanonical, resolveSelection, canonicalize, type ResolvedOffsets } from '$lib/chat/selection';
	import { wrapRange } from '$lib/markdown/wrap-range';
	import { selectionOverlapsExisting, type ExpoundOptions } from '$lib/chat/expound';
	import { buildSourceMap, type SourceMap } from '$lib/markdown/sourcemap';
	import ContextMenu from './ContextMenu.svelte';
	import ExpoundMarkPopover from './ExpoundMarkPopover.svelte';
	import ExpoundPromptConstructor from './ExpoundPromptConstructor.svelte';

	let {
		raw,
		messageId,
		children,
		onExpound,
		onCopy
	}: {
		raw: string;
		messageId: string;
		children: Snippet;
		onExpound: (
			raw: string,
			resolved: ResolvedOffsets,
			opts: ExpoundOptions
		) => void | Promise<void>;
		onCopy: (text: string) => void;
	} = $props();

	let container = $state<HTMLDivElement | null>(null);

	const sourceMap: SourceMap = $derived(buildSourceMap(raw));

	let pendingRange = $state<Range | null>(null);
	let menu = $state<{ x: number; y: number } | null>(null);
	let constructorState = $state<{
		range: Range;
		resolved: ResolvedOffsets;
		x: number;
		y: number;
	} | null>(null);
	let selectionToolbar = $state<{ x: number; y: number; range: Range } | null>(null);

	let touchTimer: ReturnType<typeof setTimeout> | null = null;

	let existingSpans = $state<BranchSource[]>([]);

	let expoundPopover = $state<{
		x: number;
		y: number;
		chatId: string;
		chatTitle: string;
		loading: boolean;
	} | null>(null);

	$effect(() => {
		void messageId;
		void (async () => {
			existingSpans = await repos.branchSources.listBySourceMessage(messageId);
		})();
	});

	const resolvedPending = $derived(
		pendingRange && container
			? resolveSelection(alignDomToCanonical(container, sourceMap), sourceMap, pendingRange)
			: null
	);
	const disabledExpound = $derived(
		resolvedPending !== null &&
			(!resolvedPending.ok ||
				selectionOverlapsExisting(
					resolvedPending.ok
						? resolvedPending
						: { startChar: -1, endChar: -1 },
					existingSpans
				))
	);
	const disableReason = $derived(
		!resolvedPending || resolvedPending.ok
			? (disabledExpound ? 'This excerpt already belongs to an expound branch.' : '')
			: resolvedPending.reason === 'generated'
				? "Can't branch from a rendered diagram or formula."
				: resolvedPending.reason === 'unaligned'
					? "Selection can't be mapped to the source text."
					: ''
	);

	function captureRange(): Range | null {
		if (!container) return null;
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
		const range = sel.getRangeAt(0);
		if (!container.contains(range.commonAncestorContainer)) return null;
		if (!range.toString().trim()) return null;
		return range.cloneRange();
	}

	function showToolbarFromSelection() {
		const range = captureRange();
		if (!range) {
			selectionToolbar = null;
			return;
		}
		const sel = window.getSelection()?.getRangeAt(0);
		if (!sel) {
			selectionToolbar = null;
			return;
		}
		const rect = sel.getBoundingClientRect();
		const x = Math.max(8, Math.min(rect.left + rect.width / 2, window.innerWidth - 8));
		const y = Math.max(8, rect.top - 8);
		selectionToolbar = { x, y, range };
	}

	function onMouseUp(_e: MouseEvent) {
		if (menu || constructorState) return;
		showToolbarFromSelection();
	}

	function onSelectionChange() {
		if (!selectionToolbar) return;
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed) {
			selectionToolbar = null;
		}
	}

	function onTouchStart(_e: TouchEvent) {
		touchTimer = setTimeout(() => {
			touchTimer = null;
		}, 500);
	}

	function onTouchEnd(_e: TouchEvent) {
		if (touchTimer) {
			clearTimeout(touchTimer);
			touchTimer = null;
			return;
		}
		if (menu || constructorState) return;
		showToolbarFromSelection();
	}

	function handleToolbarExpound() {
		if (!selectionToolbar) return;
		const { x, y, range } = selectionToolbar;
		selectionToolbar = null;
		window.getSelection()?.removeAllRanges();
		constructorState = { range, resolved: { startChar: 0, endChar: 0, excerpt: '' }, x, y };
		const table = alignDomToCanonical(container!, sourceMap);
		constructorState.resolved = resolveSelection(table, sourceMap, range);
		if (!constructorState.resolved.ok) {
			constructorState = null;
			return;
		}
	}

	$effect(() => {
		document.addEventListener('selectionchange', onSelectionChange);
		return () => document.removeEventListener('selectionchange', onSelectionChange);
	});

	function onScrollClear() {
		selectionToolbar = null;
	}

	function onContextMenu(e: MouseEvent) {
		selectionToolbar = null;
		const range = captureRange();
		if (!range) return;
		e.preventDefault();
		pendingRange = range;
		constructorState = null;
		menu = { x: e.clientX, y: e.clientY };
	}

	function onClick(e: MouseEvent) {
		const target = (e.target as HTMLElement).closest('.expound-mark') as HTMLElement | null;
		if (!target || !container?.contains(target)) return;
		const chatId = target.getAttribute('data-branch-chat');
		if (!chatId) return;
		expoundPopover = { x: e.clientX, y: e.clientY, chatId, chatTitle: '', loading: true };
		repos.chats.getById(chatId).then((chat) => {
			if (expoundPopover?.chatId === chatId) {
				expoundPopover.chatTitle = chat?.title ?? 'Untitled';
				expoundPopover.loading = false;
			}
		});
	}

	function handleExpound() {
		if (!menu || !pendingRange || disabledExpound) return;
		const { x, y } = menu;
		const range = pendingRange;
		menu = null;
		selectionToolbar = null;
		window.getSelection()?.removeAllRanges();
		constructorState = { range, resolved: resolvedPending!, x, y };
	}

	function handleCopy() {
		const text = pendingRange?.toString() ?? '';
		menu = null;
		pendingRange = null;
		selectionToolbar = null;
		onCopy(text);
	}

	function closeMenu() {
		menu = null;
		selectionToolbar = null;
	}

	function submitConstructor(opts: ExpoundOptions) {
		if (!constructorState) return;
		const { resolved } = constructorState;
		constructorState = null;
		pendingRange = null;
		if (!resolved.ok) return;
		void onExpound(raw, resolved, opts);
	}

	function cancelConstructor() {
		constructorState = null;
		pendingRange = null;
		selectionToolbar = null;
	}

	function locateCanonical(
		sm: SourceMap,
		startChar: number,
		endChar: number
	): { start: number; end: number } | null {
		let segStart = -1;
		let segEnd = -1;
		for (let i = 0; i < sm.segments.length; i++) {
			const seg = sm.segments[i]!;
			if (seg.kind === 'inter-block-ws') continue;
			if (segStart === -1 && seg.startChar >= startChar) {
				segStart = i;
			}
			if (seg.endChar <= endChar) {
				segEnd = i;
			}
		}
		if (segStart === -1 || segEnd === -1 || segStart > segEnd) return null;

		const canonStart = canonicalOffsetOfSegmentStart(sm, segStart);
		const lastSeg = sm.segments[segEnd]!;
		const canonEnd = canonicalOffsetOfSegmentStart(sm, segEnd) + lastSeg.rendered.length;
		return { start: canonStart, end: canonEnd };
	}

	function canonicalOffsetOfSegmentStart(sm: SourceMap, segIdx: number): number {
		for (let i = 0; i < sm.canonicalToSegment.length; i++) {
			if (sm.canonicalToSegment[i] === segIdx) return i;
		}
		return sm.canonicalToSegment.length;
	}

	function selfHeal(
		sm: SourceMap,
		excerpt: string,
		preferredStart: number
	): { start: number; end: number } | null {
		const canonNorm = canonicalize(sm.canonical);
		const excerptNorm = canonicalize(excerpt);
		if (excerptNorm.length === 0) return null;

		const toOriginal: number[] = [];
		let lastWasWs = true;
		for (let i = 0; i < sm.canonical.length; i++) {
			const ch = sm.canonical[i]!;
			if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
				if (!lastWasWs) {
					toOriginal.push(i);
					lastWasWs = true;
				}
			} else {
				toOriginal.push(i);
				lastWasWs = false;
			}
		}
		let start = 0;
		let end = toOriginal.length;
		while (start < end && canonNorm[start] === ' ') start++;
		while (end > start && canonNorm[end - 1] === ' ') end--;

		const searchNorm = canonNorm.slice(start, end);
		const searchToOriginal = toOriginal.slice(start, end);

		let best: { start: number; end: number } | null = null;
		let bestDist = Infinity;
		let from = 0;
		while (from <= searchNorm.length) {
			const hit = searchNorm.indexOf(excerptNorm, from);
			if (hit < 0) break;
			const collapsedEnd = hit + excerptNorm.length;
			if (collapsedEnd > searchToOriginal.length) break;
			const origStart = searchToOriginal[hit] ?? 0;
			const origEnd = (searchToOriginal[collapsedEnd - 1] ?? 0) + 1;
			const segStart = sm.canonicalToSegment[origStart] ?? 0;
			const rawStart = sm.segments[segStart]?.startChar ?? 0;
			const dist = Math.abs(rawStart - preferredStart);
			if (dist < bestDist) {
				bestDist = dist;
				best = { start: origStart, end: origEnd };
			}
			from = hit + 1;
		}
		return best;
	}

	let lastSignature = '';

	function renderUnderlines() {
		const c = container;
		if (!c) return;

		const fullText = c.textContent ?? '';
		const signature = fullText + '|' + existingSpans.map((s) => s.id).join(',');
		if (signature === lastSignature) return;
		lastSignature = signature;

		for (const m of Array.from(c.querySelectorAll('span.expound-mark'))) {
			const parent = m.parentNode;
			if (!parent) continue;
			parent.replaceChild(document.createTextNode(m.textContent ?? ''), m);
			parent.normalize();
		}

		if (existingSpans.length === 0) return;

		const table = alignDomToCanonical(c, sourceMap);
		if (!table.aligned) {
			if (import.meta.env.DEV) {
				console.warn('[expound] alignment failed; skipping underline pass', { messageId });
			}
			return;
		}

		for (const span of existingSpans) {
			const { startChar, endChar, excerpt } = span;
			const rawSlice = raw.slice(startChar, endChar);
			let canonicalStart: number;
			let canonicalEnd: number;

			if (canonicalize(rawSlice) === canonicalize(excerpt)) {
				const hit = locateCanonical(sourceMap, startChar, endChar);
				if (!hit) continue;
				({ start: canonicalStart, end: canonicalEnd } = hit);
			} else {
				const healed = selfHeal(sourceMap, excerpt, span.startChar);
				if (!healed) {
					if (import.meta.env.DEV) {
						console.warn('[expound] self-heal failed', {
							messageId,
							spanId: span.id,
							excerpt,
							startChar,
							endChar
						});
					}
					continue;
				}
				({ start: canonicalStart, end: canonicalEnd } = healed);
			}

			wrapRange(table, canonicalStart, canonicalEnd, { 'data-branch-chat': span.branchChatId });
		}
	}

	$effect(() => {
		void existingSpans.length;
		const c = container;
		if (!c) return;
		renderUnderlines();
		const observer = new MutationObserver(() => renderUnderlines());
		observer.observe(c, { childList: true, subtree: true, characterData: true });
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!import.meta.env.DEV) return;
		const c = container;
		if (!c) return;
		const table = alignDomToCanonical(c, sourceMap);
		const filtered = table.entries
			.filter((e) => !e.excluded)
			.map((e) => e.node.textContent ?? '')
			.join('');
		if (filtered !== sourceMap.canonical) {
			console.warn('[expound] source map canonical diverges from filtered DOM textContent', {
				messageId,
				canonicalLen: sourceMap.canonical.length,
				domLen: filtered.length
			});
		}
	});
</script>

<svelte:window onscroll={onScrollClear} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	bind:this={container}
	oncontextmenu={onContextMenu}
	onclick={onClick}
	onmouseup={onMouseUp}
	ontouchstart={onTouchStart}
	ontouchend={onTouchEnd}
	role="region"
	aria-label="Mayon reply — select text and right-click to expound"
	class="relative"
>
	{@render children()}
</div>

{#if menu}
	<ContextMenu
		x={menu.x}
		y={menu.y}
		{disabledExpound}
		disableHint={disableReason}
		onExpound={handleExpound}
		onCopy={handleCopy}
		onClose={closeMenu}
	/>
{/if}

{#if constructorState}
	<ExpoundPromptConstructor
		excerpt={constructorState.resolved.excerpt}
		x={constructorState.x}
		y={constructorState.y}
		onSubmit={submitConstructor}
		onCancel={cancelConstructor}
	/>
{/if}

{#if expoundPopover}
	<ExpoundMarkPopover
		x={expoundPopover.x}
		y={expoundPopover.y}
		chatTitle={expoundPopover.chatTitle}
		chatId={expoundPopover.chatId}
		loading={expoundPopover.loading}
		onClose={() => {
			expoundPopover = null;
		}}
	/>
{/if}

{#if selectionToolbar}
	<div
		class="fixed z-50"
		style="left: {selectionToolbar.x}px; top: {selectionToolbar.y}px; transform: translate(-50%, -100%);"
	>
		<button
			class="shadow-lg rounded-full text-xs bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 transition-colors cursor-pointer"
			onclick={handleToolbarExpound}
		>
			Branch from this
		</button>
	</div>
{/if}

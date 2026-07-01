<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { BranchSource } from '$lib/db/schema';
	import { repos } from '$lib/db';
	import type { SelectionInput } from '$lib/chat/highlight';
	import { resolveSelectionOffsets } from '$lib/chat/highlight';
	import { selectionOverlapsExisting, type ExpoundOptions } from '$lib/chat/expound';
	import ContextMenu from './ContextMenu.svelte';
	import ExpoundMarkPopover from './ExpoundMarkPopover.svelte';
	import ExpoundPromptConstructor from './ExpoundPromptConstructor.svelte';

	/**
	 * Wraps an assistant message's rendered content. Right-clicking a text
	 * selection opens a context menu (`Expound…` / `Copy`). `Expound…` opens a
	 * floating prompt constructor; on Send it emits the selection + options.
	 * Existing excerpts for this message are underlined via post-render DOM
	 * wrapping (best-effort; raw vs rendered offsets differ).
	 *
	 * The offset→raw mapping is pure (`resolveSelectionOffsets`); this
	 * component only gathers the DOM data the mapping needs and renders the
	 * resulting underlines.
	 */
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
			selection: SelectionInput,
			opts: ExpoundOptions
		) => void | Promise<void>;
		onCopy: (text: string) => void;
	} = $props();

	let container = $state<HTMLDivElement | null>(null);

	// Selection captured at context-menu time (the live selection the actions
	// operate on). Cleared when the menu/constructor closes.
	let pendingSel = $state<SelectionInput | null>(null);
	let menu = $state<{ x: number; y: number } | null>(null);
	let constructorState = $state<{
		sel: SelectionInput;
		x: number;
		y: number;
	} | null>(null);

	// Existing excerpts for this source message (drives overlap + underlines).
	let existingSpans = $state<BranchSource[]>([]);

	let expoundPopover = $state<{
		x: number;
		y: number;
		chatId: string;
		chatTitle: string;
		loading: boolean;
	} | null>(null);

	// Load spans whenever the message id changes.
	$effect(() => {
		void messageId;
		void (async () => {
			existingSpans = await repos.branchSources.listBySourceMessage(messageId);
		})();
	});

	// Resolve the pending selection's raw offsets (full-span fallback on miss)
	// and disable Expound when it overlaps an existing excerpt. A full-span
	// fallback (startChar=0) trivially overlaps everything — conservative.
	const resolvedPending = $derived(
		pendingSel
			? (resolveSelectionOffsets(raw, pendingSel) ?? {
					startChar: 0,
					endChar: pendingSel.excerpt.length
				})
			: null
	);
	const disabledExpound = $derived(
		resolvedPending !== null && selectionOverlapsExisting(resolvedPending, existingSpans)
	);

	function captureSelection(): SelectionInput | null {
		if (!container) return null;
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

		const range = sel.getRangeAt(0);
		// Only consider selections fully inside this message container.
		if (!container.contains(range.commonAncestorContainer)) return null;

		const excerpt = sel.toString();
		if (!excerpt.trim()) return null;

		const containerText = container.textContent ?? '';
		const startInContainer = textOffsetFromRange(
			container,
			range.startContainer,
			range.startOffset
		);
		const endInContainer = textOffsetFromRange(container, range.endContainer, range.endOffset);
		if (startInContainer < 0 || endInContainer < 0 || endInContainer < startInContainer)
			return null;

		return { excerpt, containerText, startInContainer, endInContainer };
	}

	function onContextMenu(e: MouseEvent) {
		const sel = captureSelection();
		if (!sel) return; // No valid selection → let the native menu show.
		e.preventDefault();
		pendingSel = sel;
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
		if (!menu || !pendingSel || disabledExpound) return;
		const { x, y } = menu;
		const sel = pendingSel;
		menu = null;
		// Clear the browser selection so it doesn't persist under the constructor.
		window.getSelection()?.removeAllRanges();
		constructorState = { sel, x, y };
	}

	function handleCopy() {
		const text = pendingSel?.excerpt ?? '';
		menu = null;
		pendingSel = null;
		onCopy(text);
	}

	function closeMenu() {
		menu = null;
	}

	function submitConstructor(opts: ExpoundOptions) {
		if (!constructorState) return;
		const { sel } = constructorState;
		constructorState = null;
		pendingSel = null;
		void onExpound(raw, sel, opts);
	}

	function cancelConstructor() {
		constructorState = null;
		pendingSel = null;
	}

	// --- Underline rendering (post-render DOM wrap) --------------------------

	/**
	 * Compute the character offset of (node, offset) within the container's
	 * concatenated text content, by walking text nodes in document order.
	 */
	function textOffsetFromRange(root: Node, node: Node, offset: number): number {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let acc = 0;
		let current: Node | null = walker.currentNode;
		if (current.nodeType !== Node.TEXT_NODE) current = walker.nextNode();
		while (current) {
			if (current === node) {
				return acc + offset;
			}
			if (current.nodeType === Node.TEXT_NODE) {
				acc += current.textContent?.length ?? 0;
			}
			current = walker.nextNode();
		}
		return -1;
	}

	/** Whitespace-collapse with a map back to original indices (mirrors highlight.ts). */
	function collapse(s: string): { collapsed: string; toOriginal: number[] } {
		const collapsed: string[] = [];
		const toOriginal: number[] = [];
		let lastWasWs = false;
		for (let i = 0; i < s.length; i++) {
			const ch = s[i]!;
			if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
				if (!lastWasWs) {
					collapsed.push(' ');
					toOriginal.push(i);
				}
				lastWasWs = true;
			} else {
				collapsed.push(ch);
				toOriginal.push(i);
				lastWasWs = false;
			}
		}
		let start = 0;
		let end = collapsed.length;
		while (start < end && collapsed[start] === ' ') start++;
		while (end > start && collapsed[end - 1] === ' ') end--;
		return {
			collapsed: collapsed.slice(start, end).join(''),
			toOriginal: toOriginal.slice(start, end)
		};
	}

	/** Find the occurrence of `excerpt` (whitespace-normalized) nearest `preferredStart`. */
	function findOccurrence(
		fullText: string,
		excerpt: string,
		preferredStart: number
	): { start: number; end: number } | null {
		const cFull = collapse(fullText);
		const cExcerpt = collapse(excerpt);
		if (cExcerpt.collapsed.length === 0) return null;
		let best: { start: number; end: number } | null = null;
		let bestDist = Infinity;
		let from = 0;
		while (from <= cFull.collapsed.length) {
			const hit = cFull.collapsed.indexOf(cExcerpt.collapsed, from);
			if (hit < 0) break;
			const collapsedEnd = hit + cExcerpt.collapsed.length;
			if (collapsedEnd > cFull.toOriginal.length) break;
			const origStart = cFull.toOriginal[hit] ?? 0;
			const origEnd = (cFull.toOriginal[collapsedEnd - 1] ?? 0) + 1;
			const dist = Math.abs(origStart - preferredStart);
			if (dist < bestDist) {
				bestDist = dist;
				best = { start: origStart, end: origEnd };
			}
			from = hit + 1;
		}
		return best;
	}

	let lastSignature = '';

	/** Wrap each excerpt span in a `.expound-mark`. Best-effort; idempotent. */
	function renderUnderlines() {
		const c = container;
		if (!c) return;

		// Gather text nodes + their offsets in the concatenated container text.
		const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
		const textNodes: { node: Text; start: number; end: number }[] = [];
		let acc = 0;
		let cur: Node | null = walker.currentNode;
		if (cur.nodeType !== Node.TEXT_NODE) cur = walker.nextNode();
		while (cur) {
			const len = cur.textContent?.length ?? 0;
			textNodes.push({ node: cur as Text, start: acc, end: acc + len });
			acc += len;
			cur = walker.nextNode();
		}
		const fullText = textNodes.map((t) => t.node.textContent ?? '').join('');

		// Signature guards against feedback loops: wrapping in inline spans
		// doesn't change the text content, so a re-run for the same content is
		// a no-op (the MutationObserver won't spin).
		const signature = fullText + '|' + existingSpans.map((s) => s.id).join(',');
		if (signature === lastSignature) return;
		lastSignature = signature;

		// Un-wrap any prior marks before re-wrapping.
		for (const m of Array.from(c.querySelectorAll('span.expound-mark'))) {
			const parent = m.parentNode;
			if (!parent) continue;
			parent.replaceChild(document.createTextNode(m.textContent ?? ''), m);
			parent.normalize();
		}

		if (existingSpans.length === 0) return;

		const locate = (idx: number) => {
			for (const t of textNodes) {
				if (idx >= t.start && idx < t.end) return { node: t.node, offset: idx - t.start };
			}
			return null;
		};

		for (const span of existingSpans) {
			const hit = findOccurrence(fullText, span.excerpt, span.startChar);
			if (!hit) continue;
			const startInfo = locate(hit.start);
			const endInfo = locate(hit.end - 1);
			if (!startInfo || !endInfo) continue;
			const range = document.createRange();
			range.setStart(startInfo.node, startInfo.offset);
			range.setEnd(endInfo.node, endInfo.offset + 1);
			const mark = document.createElement('span');
			mark.className = 'expound-mark';
			mark.setAttribute('data-branch-chat', span.branchChatId);
			try {
				range.surroundContents(mark);
			} catch {
				// Range crosses an element boundary; skip this excerpt.
			}
		}
	}

	// Re-render underlines when spans load or the container mutates (mermaid
	// post-processing swaps <pre> → <div>; signature guard prevents loops).
	$effect(() => {
		void existingSpans.length;
		const c = container;
		if (!c) return;
		renderUnderlines();
		const observer = new MutationObserver(() => renderUnderlines());
		observer.observe(c, { childList: true, subtree: true, characterData: true });
		return () => observer.disconnect();
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	bind:this={container}
	oncontextmenu={onContextMenu}
	onclick={onClick}
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
		disableHint={disabledExpound ? 'This excerpt already belongs to an expound branch.' : ''}
		onExpound={handleExpound}
		onCopy={handleCopy}
		onClose={closeMenu}
	/>
{/if}

{#if constructorState}
	<ExpoundPromptConstructor
		excerpt={constructorState.sel.excerpt}
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

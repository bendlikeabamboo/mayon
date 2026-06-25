<script lang="ts">
	import { GitBranch } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Snippet } from 'svelte';
	import type { SelectionInput } from '$lib/chat/highlight';

	/**
	 * Wraps an assistant message's rendered content. Listens for a text
	 * selection within its container; when a non-empty selection exists, shows a
	 * "Branch from here" affordance. On click, gathers the selection's window
	 * inside the container and emits it as a `SelectionInput` via `onBranch`.
	 *
	 * The offset→raw mapping itself is pure (`resolveSelectionOffsets`); this
	 * component only collects the DOM data the mapping needs.
	 */
	let {
		raw,
		children,
		onBranch
	}: {
		raw: string;
		children: Snippet;
		onBranch: (raw: string, selection: SelectionInput) => void | Promise<void>;
	} = $props();

	let container = $state<HTMLDivElement | null>(null);
	let hasSelection = $state(false);

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
		// Compute start/end offsets of the selection within the container's text.
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

	function onSelectionChange() {
		const captured = captureSelection();
		hasSelection = captured !== null;
	}

	function onPointerUp() {
		// Selectionchange fires reliably; this is a backstop for some browsers.
		onSelectionChange();
	}

	async function branch() {
		const sel = captureSelection();
		if (!sel) return;
		// Clear the browser selection so the affordance dismisses after branching.
		window.getSelection()?.removeAllRanges();
		hasSelection = false;
		await onBranch(raw, sel);
	}

	/**
	 * Compute the character offset of (node, offset) within the container's
	 * concatenated text content, by walking text nodes in document order.
	 */
	function textOffsetFromRange(root: Node, node: Node, offset: number): number {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let acc = 0;
		let current: Node | null = walker.currentNode;
		// TreeWalker starts at root; step to the first text node.
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
</script>

<svelte:window onselectionchange={onSelectionChange} />

<div
	bind:this={container}
	onpointerup={onPointerUp}
	role="region"
	aria-label="Assistant reply — select text to branch from a span"
	class="relative"
>
	{@render children()}
	{#if hasSelection}
		<div class="absolute right-0 -top-9 z-10">
			<Button size="sm" onclick={branch} title="Branch a new chat from the selected span">
				<GitBranch class="size-4" /> Branch from here
			</Button>
		</div>
	{/if}
</div>

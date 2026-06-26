<script lang="ts">
	import { Copy, GitBranch } from '@lucide/svelte';

	/**
	 * Lightweight right-click context menu for an assistant-message selection.
	 * Two items: `Expound…` (disabled + hint when the selection overlaps an
	 * existing excerpt) and `Copy`. Fixed-positioned, clamped to the viewport,
	 * and closed on outside pointerdown, Escape, scroll, or window blur.
	 *
	 * Hand-built (no bits-ui) to match the `Highlighter`/`CrossLinks` style.
	 */
	let {
		x,
		y,
		disabledExpound = false,
		disableHint = '',
		onExpound,
		onCopy,
		onClose
	}: {
		x: number;
		y: number;
		disabledExpound?: boolean;
		disableHint?: string;
		onExpound: () => void;
		onCopy: () => void;
		onClose: () => void;
	} = $props();

	const MENU_WIDTH = 168;
	const MENU_HEIGHT = 92;

	// Clamp so the menu never overflows the viewport.
	const pos = $derived({
		left: Math.min(Math.max(8, x), window.innerWidth - MENU_WIDTH - 8),
		top: Math.min(Math.max(8, y), window.innerHeight - MENU_HEIGHT - 8)
	});

	// `selectionstart` is fired by the owner before showing this menu; we use a
	// capture-phase outside-pointerdown to close without swallowing the click
	// that opened us.
	let root = $state<HTMLDivElement | null>(null);

	function onWindowPointerDown(e: PointerEvent) {
		if (root && root.contains(e.target as Node)) return;
		onClose();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window
	onpointerdown={onWindowPointerDown}
	onkeydown={onKeydown}
	onblur={onClose}
	onscroll={onClose}
/>

<!-- Fixed portal-style overlay; z-50 to float above message content. -->
<div
	bind:this={root}
	style:left="{pos.left}px"
	style:top="{pos.top}px"
	style:width="{MENU_WIDTH}px"
	class="fixed z-50 overflow-visible rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
	role="menu"
	aria-label="Selection actions"
>
	<button
		type="button"
		role="menuitem"
		class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
		disabled={disabledExpound}
		title={disabledExpound ? disableHint || 'Unavailable' : undefined}
		onclick={() => {
			if (disabledExpound) return;
			onExpound();
		}}
	>
		<GitBranch class="size-4 shrink-0" />
		Expound…
	</button>
	<button
		type="button"
		role="menuitem"
		class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
		onclick={() => onCopy()}
	>
		<Copy class="size-4 shrink-0" />
		Copy
	</button>
</div>

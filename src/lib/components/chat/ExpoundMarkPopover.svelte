<script lang="ts">
	let {
		x,
		y,
		chatTitle,
		chatId,
		loading,
		onClose
	}: {
		x: number;
		y: number;
		chatTitle: string;
		chatId: string;
		loading: boolean;
		onClose: () => void;
	} = $props();

	const POPOVER_WIDTH = 200;
	const POPOVER_HEIGHT = 72;

	const pos = $derived({
		left: Math.min(Math.max(8, x + 8), window.innerWidth - POPOVER_WIDTH - 8),
		top: Math.min(Math.max(8, y + 8), window.innerHeight - POPOVER_HEIGHT - 8)
	});

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

<div
	bind:this={root}
	style:left="{pos.left}px"
	style:top="{pos.top}px"
	style:width="{POPOVER_WIDTH}px"
	class="fixed z-50 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md"
	role="dialog"
	aria-label="Expound branch link"
>
	<p class="mb-1.5 truncate text-sm font-medium">
		{#if loading}
			Loading…
		{:else if chatTitle}
			{chatTitle}
		{:else}
			Untitled
		{/if}
	</p>
	<a
		href="/chat/{chatId}"
		class="block rounded px-2 py-1 text-sm text-primary underline-offset-2 hover:bg-accent hover:underline"
		onclick={onClose}
	>
		Open
	</a>
</div>

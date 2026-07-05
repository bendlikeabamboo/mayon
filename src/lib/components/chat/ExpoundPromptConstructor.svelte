<script lang="ts">
	import { Send, X } from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button/index.js';
	import { TOGGLE_LABELS, type ExpoundOptions, type ExpoundToggle } from '$lib/chat/expound';

	/**
	 * Floating panel that turns a selected excerpt into an expound prompt.
	 * Read-only excerpt preview + Custom Instructions textarea + three format
	 * toggles (clear when off / accent when on) + Send. ⌘/Ctrl+Enter sends
	 * (mirrors `Composer`); Escape / outside click cancels. Send is always
	 * enabled (an empty expound is valid).
	 */
	let {
		excerpt,
		x,
		y,
		onSubmit,
		onCancel
	}: {
		excerpt: string;
		x: number;
		y: number;
		onSubmit: (o: ExpoundOptions) => void;
		onCancel: () => void;
	} = $props();

	let customInstructions = $state('');
	let toggles = new SvelteSet<ExpoundToggle>();

	const PANEL_WIDTH = 320;
	const PANEL_HEIGHT = 360;

	const pos = $derived({
		left: Math.min(Math.max(8, x), window.innerWidth - PANEL_WIDTH - 8),
		top: Math.min(Math.max(8, y), window.innerHeight - PANEL_HEIGHT - 8)
	});

	const toggleKeys = Object.keys(TOGGLE_LABELS) as ExpoundToggle[];

	function toggle(key: ExpoundToggle) {
		if (toggles.has(key)) toggles.delete(key);
		else toggles.add(key);
	}

	function submit() {
		onSubmit({
			excerpt,
			customInstructions,
			toggles: toggleKeys.filter((k) => toggles.has(k))
		});
	}

	function onKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			submit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onCancel();
		}
	}

	let root = $state<HTMLDivElement | null>(null);

	function onWindowPointerDown(e: PointerEvent) {
		if (root && root.contains(e.target as Node)) return;
		onCancel();
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div
	bind:this={root}
	style:left="{pos.left}px"
	style:top="{pos.top}px"
	class="fixed z-50 w-80 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
	role="dialog"
	aria-label="Expound on excerpt"
>
	<div class="flex items-center justify-between">
		<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expound</h3>
		<button
			type="button"
			class="text-muted-foreground hover:text-foreground"
			title="Cancel"
			aria-label="Cancel"
			onclick={onCancel}
		>
			<X class="size-4" />
		</button>
	</div>

	<p class="text-xs text-muted-foreground">A focused sub-chat about the selected excerpt.</p>

	<!-- Read-only excerpt preview, truncated. -->
	<p
		class="mt-2 line-clamp-3 rounded-md bg-muted/50 p-2 text-xs italic text-muted-foreground"
		title={excerpt}
	>
		“{excerpt}”
	</p>

	<label class="mt-3 block text-xs font-medium text-muted-foreground" for="expound-instructions">
		Custom instructions
	</label>
	<textarea
		id="expound-instructions"
		bind:value={customInstructions}
		onkeydown={onKeydown}
		rows="3"
		placeholder="How should the excerpt be expanded?  (⌘/Ctrl+Enter to send)"
		class="mt-1 min-w-0 w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
	></textarea>

	<div class="mt-3">
		<p class="text-xs font-medium text-muted-foreground">Add formats</p>
		<div class="mt-1 flex flex-wrap gap-1.5">
			{#each toggleKeys as key (key)}
				{@const on = toggles.has(key)}
				<button
					type="button"
					aria-pressed={on}
					class="rounded-md border px-2 py-1 text-xs transition-colors {on
						? 'border-primary bg-accent text-accent-foreground'
						: 'border-border bg-background text-muted-foreground hover:bg-accent/50'}"
					onclick={() => toggle(key)}
				>
					{TOGGLE_LABELS[key]}
				</button>
			{/each}
		</div>
	</div>

	<div class="mt-3 flex items-center justify-end">
		<Button size="sm" onclick={submit} title="Send (⌘/Ctrl+Enter)" aria-label="Send">
			<Send class="size-4" /> Send
		</Button>
	</div>
</div>

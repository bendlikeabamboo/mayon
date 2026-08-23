<script lang="ts">
	import { Send, X } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { ExpoundOptions } from '$lib/chat/expound';
	import {
		DEFAULT_EXPOUND_INSTRUCTIONS,
		getExpoundInstructions,
		type ExpoundInstruction
	} from '$lib/chat/expound-instructions';

	/**
	 * Floating panel that turns a selected excerpt into an expound prompt.
	 * Read-only excerpt preview + Custom Instructions textarea + format
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
	let toggles = new SvelteSet<string>();
	let provideSummary = $state(false);

	let options = $state<readonly ExpoundInstruction[]>(DEFAULT_EXPOUND_INSTRUCTIONS);

	onMount(async () => {
		try {
			options = await getExpoundInstructions();
		} catch {
			options = DEFAULT_EXPOUND_INSTRUCTIONS;
		}
	});

	const PANEL_WIDTH = 320;
	const PANEL_HEIGHT = 360;

	const pos = $derived({
		left: Math.min(Math.max(8, x), window.innerWidth - PANEL_WIDTH - 8),
		top: Math.min(Math.max(8, y), window.innerHeight - PANEL_HEIGHT - 8)
	});

	function toggle(name: string) {
		if (toggles.has(name)) toggles.delete(name);
		else toggles.add(name);
	}

	function submit() {
		onSubmit({
			excerpt,
			customInstructions,
			toggles: options.filter((o) => toggles.has(o.name)).map((o) => o.name),
			provideSummary
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
	style:max-height="calc(100vh - {pos.top}px - 8px)"
	class="fixed z-50 flex max-h-[80vh] w-80 flex-col rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
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

	<div class="mt-3 min-h-0 flex-1 overflow-y-auto">
		<p class="text-xs font-medium text-muted-foreground">Add formats</p>
		<div class="mt-1 flex flex-wrap gap-1.5">
			{#each options as opt (opt.id)}
				{@const on = toggles.has(opt.name)}
				<div class="flex flex-col items-start gap-0.5">
					<button
						type="button"
						aria-pressed={on}
						class="rounded-md border px-2 py-1 text-xs transition-colors {on
							? 'border-primary bg-accent text-accent-foreground'
							: 'border-border bg-background text-muted-foreground hover:bg-accent/50'}"
						onclick={() => toggle(opt.name)}
					>
						{opt.name}
					</button>
					{#if opt.description}
						<p class="max-w-56 text-xs text-muted-foreground">{opt.description}</p>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<label class="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
		<input type="checkbox" bind:checked={provideSummary} class="size-3.5 accent-primary" />
		Provide summary
	</label>

	<div class="mt-3 flex items-center justify-end">
		<Button size="sm" onclick={submit} title="Send (⌘/Ctrl+Enter)" aria-label="Send">
			<Send class="size-4" /> Send
		</Button>
	</div>
</div>

<script lang="ts">
	import { ChevronDown, RefreshCw, Search } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		models,
		value,
		discoverable = false,
		discovering = false,
		onselect,
		onrefresh
	}: {
		models: string[];
		value: string;
		discoverable?: boolean;
		discovering?: boolean;
		onselect?: (model: string) => void;
		onrefresh?: () => void;
	} = $props();

	let open = $state(false);
	let query = $state('');
	let root: HTMLDivElement | undefined = $state();

	// Always offer the current value even if it isn't in the (discovered) list,
	// so a saved default never vanishes from the picker.
	let available = $derived.by(() => {
		if (value && !models.includes(value)) return [value, ...models];
		return models;
	});

	let filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return available;
		return available.filter((m) => m.toLowerCase().includes(q));
	});

	function toggle() {
		open = !open;
		if (open) query = '';
	}

	function choose(m: string) {
		onselect?.(m);
		query = '';
		open = false;
	}

	function onWindowPointerDown(e: PointerEvent) {
		if (root && !root.contains(e.target as Node)) open = false;
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="relative w-full" bind:this={root}>
	<div class="flex items-center gap-2">
		<button
			type="button"
			class="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onclick={toggle}
			aria-haspopup="listbox"
			aria-expanded={open}
		>
			<span class="truncate {value ? '' : 'text-muted-foreground'}">
				{value || 'Select a model…'}
			</span>
			<ChevronDown class="size-4 shrink-0 opacity-60" />
		</button>
		{#if discoverable}
			<Button
				variant="outline"
				size="icon"
				class="size-9 shrink-0"
				title="Refresh model list"
				aria-label="Refresh model list"
				disabled={discovering}
				onclick={onrefresh}
			>
				<RefreshCw class="size-4 {discovering ? 'animate-spin' : ''}" />
			</Button>
		{/if}
	</div>

	{#if open}
		<div
			class="absolute z-50 mt-1 w-full min-w-64 rounded-md border border-border bg-popover p-0 text-popover-foreground shadow-md"
			role="listbox"
		>
			<div class="flex items-center gap-2 border-b border-border px-2.5">
				<Search class="size-4 shrink-0 opacity-50" />
				<input
					class="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					placeholder="Search models…"
					bind:value={query}
					autocomplete="off"
					spellcheck="false"
				/>
			</div>
			<ul class="max-h-60 overflow-y-auto p-1 text-sm">
				{#each filtered as m (m)}
					<li>
						<button
							type="button"
							role="option"
							aria-selected={m === value}
							class="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-accent {m ===
							value
								? 'font-medium'
								: ''}"
							onclick={() => choose(m)}
						>
							<span class="truncate">{m}</span>
						</button>
					</li>
				{:else}
					<li class="px-2 py-3 text-center text-xs text-muted-foreground">
						{models.length === 0 ? 'No models yet — click refresh.' : 'No matches.'}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

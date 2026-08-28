<script lang="ts">
	import * as Command from '$lib/components/ui/command/index.js';
	import { matchSections, type SectionEntry } from '$lib/settings/sections';

	let {
		sections,
		onJump
	}: {
		sections: SectionEntry[];
		onJump: (id: string) => void;
	} = $props();

	let inputRef: HTMLInputElement | null = $state(null);
	let query = $state('');
	let focused = $state(false);

	const matches = $derived(matchSections(query, sections));

	export function focus() {
		inputRef?.focus();
	}

	function collapseIfUnfocused() {
		if (!inputRef?.matches(':focus')) {
			focused = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			inputRef?.blur();
		}
	}

	function aliasHint(entry: SectionEntry): string | null {
		const tokens = query
			.trim()
			.toLowerCase()
			.split(/\s+/)
			.filter((token) => token.length > 0);
		if (tokens.length === 0) return null;
		const label = entry.label.toLowerCase();
		if (tokens.every((token) => label.includes(token))) return null;
		return entry.aliases.find((alias) => tokens.some((token) => alias.includes(token))) ?? null;
	}
</script>

<Command.Root
	shouldFilter={false}
	class="relative h-auto w-full overflow-visible **:data-[slot=command-input-wrapper]:rounded-md **:data-[slot=command-input-wrapper]:border **:data-[slot=command-input-wrapper]:border-input **:data-[slot=command-input-wrapper]:bg-background **:data-[slot=command-input-wrapper]:focus-within:ring-2 **:data-[slot=command-input-wrapper]:focus-within:ring-ring"
>
	<Command.Input
		bind:ref={inputRef}
		bind:value={query}
		placeholder="Jump to section…"
		aria-label="Search settings"
		onfocus={() => (focused = true)}
		onblur={() => requestAnimationFrame(collapseIfUnfocused)}
		onkeydown={handleKeydown}
	/>
	<span
		aria-hidden="true"
		class="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
	>
		⌘K
	</span>
	{#if focused}
		<Command.List
			aria-label="Settings sections"
			class="absolute inset-x-0 top-full z-50 mt-1 rounded-md border border-border bg-popover p-1 shadow-md"
			onmousedown={(event) => event.preventDefault()}
		>
			<Command.Empty>No matching section</Command.Empty>
			{#each matches as entry (entry.id)}
				<Command.Item value={entry.id} onSelect={() => onJump(entry.id)}>
					<span class="flex-1 truncate">{entry.label}</span>
					{#if aliasHint(entry)}
						<span class="shrink-0 text-xs text-muted-foreground">{aliasHint(entry)}</span>
					{/if}
				</Command.Item>
			{/each}
		</Command.List>
	{/if}
</Command.Root>

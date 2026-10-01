<script lang="ts">
	import { List } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '$lib/components/ui/sheet/index.js';
	import { mediaQuery } from '$lib/utils/media.svelte.js';
	import type { SectionEntry } from '$lib/settings/sections';

	let { sections, onJump }: { sections: SectionEntry[]; onJump: (id: string) => void } = $props();

	const xl = mediaQuery('(min-width: 1280px)');
	let open = $state(false);

	$effect(() => {
		if (xl.matches) open = false;
	});

	function pick(entry: SectionEntry) {
		open = false;
		onJump(entry.id);
	}
</script>

{#if !xl.matches}
	<Button
		type="button"
		variant="default"
		size="icon"
		class="fixed right-4 bottom-[calc(1rem_+_env(safe-area-inset-bottom))] z-40 size-12 rounded-full shadow-lg"
		aria-label="Jump to section"
		onclick={() => (open = true)}
	>
		<List class="size-5" />
	</Button>

	<Sheet {open} onOpenChange={(v) => (open = v)}>
		<SheetContent
			side="bottom"
			class="max-h-[70dvh] rounded-t-2xl border-border px-0"
			showCloseButton={false}
		>
			<SheetHeader class="px-4 pb-2 text-left">
				<SheetTitle>Jump to section</SheetTitle>
			</SheetHeader>
			<nav
				aria-label="Jump to section"
				class="flex min-h-0 flex-col gap-1 overflow-y-auto px-2 pb-[calc(1rem_+_env(safe-area-inset-bottom))]"
			>
				{#each sections as entry (entry.id)}
					<button
						type="button"
						class="rounded-md px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						onclick={() => pick(entry)}
					>
						{entry.label}
					</button>
				{/each}
			</nav>
		</SheetContent>
	</Sheet>
{/if}

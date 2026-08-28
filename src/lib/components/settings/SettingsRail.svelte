<script lang="ts">
	import type { SectionEntry } from '$lib/settings/sections';

	let {
		sections,
		activeId,
		onJump
	}: {
		sections: SectionEntry[];
		activeId: string | null;
		onJump: (id: string) => void;
	} = $props();

	const baseClass =
		'block w-full rounded-md px-3 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';
	const activeClass = 'bg-accent font-medium text-foreground';
	const inactiveClass = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground';
</script>

<nav
	aria-label="Settings sections"
	class="pointer-events-auto hidden max-h-[calc(100dvh-3rem)] w-full overflow-y-auto overscroll-contain xl:block"
>
	<ul class="flex list-none flex-col gap-0.5 p-0">
		{#each sections as entry (entry.id)}
			{@const active = entry.id === activeId}
			<li>
				<button
					type="button"
					aria-current={active ? 'true' : undefined}
					class="{baseClass} {active ? activeClass : inactiveClass}"
					onclick={() => onJump(entry.id)}
				>
					{entry.label}
				</button>
			</li>
		{/each}
	</ul>
</nav>

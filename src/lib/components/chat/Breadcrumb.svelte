<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import type { Chat } from '$lib/db/schema';

	/**
	 * Renders the ancestor chain root › … › current as clickable links. Each
	 * entry navigates to `/chat/<id>`. The current (last) entry is non-linked.
	 */
	let { chain }: { chain: Chat[] } = $props();
</script>

{#if chain.length > 0}
	<nav
		class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
		aria-label="Breadcrumb"
	>
		{#each chain as chat, i (chat.id)}
			{#if i > 0}
				<ChevronRight class="size-3 shrink-0" />
			{/if}
			{#if i === chain.length - 1}
				<span class="font-medium text-foreground">{chat.title}</span>
			{:else}
				<a
					href="/chat/{chat.id}"
					class="rounded px-1 hover:bg-accent hover:text-accent-foreground"
					title={chat.title}
				>
					{chat.title}
				</a>
			{/if}
		{/each}
	</nav>
{/if}

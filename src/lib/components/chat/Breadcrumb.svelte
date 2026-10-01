<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import type { Chat } from '$lib/db/schema';
	import { mediaQuery } from '$lib/utils/media.svelte.js';

	/**
	 * Renders the ancestor chain root › … › current as clickable links. Each
	 * entry navigates to `/chat/<id>`. The current (last) entry is non-linked.
	 * Single line: entries truncate instead of wrapping, and below `sm` the
	 * middle ancestors collapse to a `…` separator (root and current stay).
	 */
	let { chain }: { chain: Chat[] } = $props();

	const sm = mediaQuery('(min-width: 640px)');
</script>

{#snippet link(chat: Chat)}
	<a
		href="/chat/{chat.id}"
		class="min-w-0 truncate rounded px-1 hover:bg-accent hover:text-accent-foreground"
		title={chat.title}
	>
		{chat.title}
	</a>
{/snippet}

{#snippet currentEntry(chat: Chat)}
	<span class="min-w-0 truncate font-medium text-foreground">{chat.title}</span>
{/snippet}

{#if chain.length > 0}
	<nav
		class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
		aria-label="Breadcrumb"
	>
		{#if chain.length > 2 && !sm.matches}
			{@render link(chain[0]!)}
			<ChevronRight class="size-3 shrink-0" />
			<span class="px-0.5" aria-hidden="true">…</span>
			<ChevronRight class="size-3 shrink-0" />
			{@render currentEntry(chain.at(-1)!)}
		{:else}
			{#each chain as chat, i (chat.id)}
				{#if i > 0}
					<ChevronRight class="size-3 shrink-0" />
				{/if}
				{#if i === chain.length - 1}
					{@render currentEntry(chat)}
				{:else}
					{@render link(chat)}
				{/if}
			{/each}
		{/if}
	</nav>
{/if}

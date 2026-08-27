<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLElement> {
		href?: string;
		title: string;
		meta?: string;
		badges?: string[];
		compact?: boolean;
		class?: string;
		leading?: Snippet;
		action?: Snippet;
	}

	let {
		href,
		title,
		meta = '',
		badges = [],
		compact = false,
		class: className = '',
		leading,
		action,
		...rest
	}: Props = $props();
</script>

{#snippet frameContent()}
	{#if leading}
		<span class="shrink-0">{@render leading()}</span>
	{/if}
	<span class="rowcard-content min-w-0 flex-1">
		<span class="flex items-center justify-between gap-3">
			<span
				data-rowcard-slot="title"
				class="{compact ? 'text-sm' : 'text-sm font-medium'} truncate"
			>
				{title}
			</span>
			{#if meta}
				<span
					data-rowcard-slot="meta"
					class="shrink-0 text-muted-foreground {compact ? 'text-[11px]' : 'text-xs'}"
				>
					{meta}
				</span>
			{/if}
		</span>
		{#if badges.length > 0}
			<span data-rowcard-slot="badges" class="mt-1 flex flex-wrap items-center gap-1.5">
				{#each badges as badge (badge)}
					<span
						class="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
					>
						{badge}
					</span>
				{/each}
			</span>
		{/if}
	</span>
{/snippet}

<div
	{...rest}
	class="group/card surface-card row-card flex items-center gap-3 text-card-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-within:ring-2 focus-within:ring-ring {compact
		? 'px-2.5 py-1.5'
		: 'p-3'} {className}"
>
	{#if href}
		<a {href} data-rowcard="link" class="rowcard-frame flex min-w-0 flex-1 items-center gap-3">
			{@render frameContent()}
		</a>
	{:else}
		<div data-rowcard="static" class="rowcard-frame flex min-w-0 flex-1 items-center gap-3">
			{@render frameContent()}
		</div>
	{/if}
	{#if action}
		<span
			data-rowcard-slot="action"
			class="rowcard-action pointer-events-none shrink-0 opacity-0 transition-opacity group-hover/card:pointer-events-auto group-hover/card:opacity-100 focus-within/card:pointer-events-auto focus-within/card:opacity-100"
		>
			{@render action()}
		</span>
	{/if}
</div>

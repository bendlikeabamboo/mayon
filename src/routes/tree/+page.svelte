<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import { repos } from '$lib/db';
	import { buildSubtreeModel, type SubtreeNode } from '$lib/chat/tree';
	import type { Chat } from '$lib/db/schema';

	let roots = $state<Chat[]>([]);
	let forests = $state<SubtreeNode[]>([]);
	let loading = $state(true);
	let collapsed = new SvelteSet<string>();

	onMount(async () => {
		roots = await repos.chats.listRoots();
		const subtrees = await Promise.all(roots.map((r) => repos.chats.listSubtree(r.id)));
		const all = subtrees.flat();
		forests = buildSubtreeModel(all);
		loading = false;
	});

	function toggle(id: string) {
		if (collapsed.has(id)) collapsed.delete(id);
		else collapsed.add(id);
	}

	const currentId = $derived(page.params.id ?? null);
</script>

<svelte:head>
	<title>Tree — Mayon</title>
</svelte:head>

<div class="mx-auto flex max-w-4xl flex-col gap-4 p-6">
	<div class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Conversation tree</h1>
		<p class="text-sm text-muted-foreground">
			Every chat and its branches. Click a node to open it; click a caret to collapse a subtree.
		</p>
	</div>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else if forests.length === 0}
		<div class="rounded-lg border border-dashed border-border p-8 text-center">
			<p class="text-sm text-muted-foreground">No chats yet.</p>
			<a href="/chat" class="mt-1 inline-block text-sm text-primary underline">Start one</a>
		</div>
	{:else}
		<div class="space-y-4">
			{#snippet row(node: SubtreeNode, depth: number)}
				{@const isCollapsed = collapsed.has(node.chat.id)}
				{@const isCurrent = node.chat.id === currentId}
				{@const hasChildren = node.children.length > 0}
				<div class="flex items-center gap-2" style="padding-left: {depth * 1.25}rem">
					{#if hasChildren}
						<button
							type="button"
							class="shrink-0 text-muted-foreground hover:text-foreground"
							onclick={() => toggle(node.chat.id)}
							aria-label={isCollapsed ? 'Expand' : 'Collapse'}
						>
							{#if isCollapsed}
								<ChevronRight class="size-4" />
							{:else}
								<ChevronDown class="size-4" />
							{/if}
						</button>
					{:else}
						<span class="inline-block w-4 shrink-0"></span>
					{/if}
					<a
						href="/chat/{node.chat.id}"
						class="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent"
						class:bg-primary={isCurrent}
						class:text-primary-foreground={isCurrent}
					>
						<span class="truncate">{node.chat.title}</span>
						<span class="shrink-0 text-xs opacity-70">depth {node.chat.depth}</span>
					</a>
				</div>
				{#if hasChildren && !isCollapsed}
					{#each node.children as child (child.chat.id)}
						{@render row(child, depth + 1)}
					{/each}
				{/if}
			{/snippet}

			{#each forests as root (root.chat.id)}
				<div class="space-y-1 rounded-lg border border-border p-3">
					{@render row(root, 0)}
				</div>
			{/each}
		</div>
	{/if}
</div>

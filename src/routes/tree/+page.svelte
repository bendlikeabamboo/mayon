<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ChevronRight, Trash2 } from '@lucide/svelte';
	import { repos } from '$lib/db';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { buildSubtreeModel, type SubtreeNode } from '$lib/chat/tree';
	import Pagination from '$lib/components/Pagination.svelte';
	import { entry } from '$lib/motion/stagger';
	import type { Chat } from '$lib/db/schema';

	const ITEMS_PER_PAGE = 7;

	let roots = $state<Chat[]>([]);
	let forests = $state<SubtreeNode[]>([]);
	let loading = $state(true);
	let collapsed = new SvelteSet<string>();
	let pageNum = $state(1);
	let deletingId = $state<string | null>(null);

	let totalPages = $derived(Math.max(1, Math.ceil(forests.length / ITEMS_PER_PAGE)));
	let pagedForests = $derived(
		forests.slice((pageNum - 1) * ITEMS_PER_PAGE, pageNum * ITEMS_PER_PAGE)
	);

	async function reloadForests() {
		roots = await repos.chats.listRoots();
		const subtrees = await Promise.all(roots.map((r) => repos.chats.listSubtree(r.id)));
		forests = buildSubtreeModel(subtrees.flat());
	}

	onMount(async () => {
		await reloadForests();
		loading = false;
	});

	$effect(() => {
		void forests.length;
		pageNum = 1;
	});

	function toggle(id: string) {
		if (collapsed.has(id)) collapsed.delete(id);
		else collapsed.add(id);
	}

	const currentId = $derived(page.params.id ?? null);

	function timeAgo(ts: number): string {
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}

	async function deleteBranch(node: SubtreeNode) {
		if (!confirm(`Delete "${node.chat.title}" and all its branches?`)) return;
		deletingId = node.chat.id;
		try {
			await chatStore.deleteBranch(node.chat.id);
			await reloadForests();
			if (chatStore.chatId === null) await goto('/chat');
		} finally {
			deletingId = null;
		}
	}
</script>

<svelte:head>
	<title>Tree — Mayon</title>
</svelte:head>

<div class="art-stagger mx-auto flex max-w-5xl flex-col gap-6 p-8">
	<div in:entry|global={{ index: 0, count: pagedForests.length + 1 }} class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Conversation tree</h1>
		<p class="text-sm text-muted-foreground">
			Every chat and its branches. Click a node to open it; click a caret to collapse a subtree.
		</p>
	</div>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else if forests.length === 0}
		<div
			in:entry|global={{ index: 1, count: 2 }}
			class="surface-card border-dashed p-8 text-center"
		>
			<p class="text-sm text-muted-foreground">No chats yet.</p>
			<a href="/chat" class="mt-1 inline-block text-sm text-primary underline">Start one</a>
		</div>
	{:else}
		{#snippet row(node: SubtreeNode, depth: number)}
			{@const isCollapsed = collapsed.has(node.chat.id)}
			{@const isCurrent = node.chat.id === currentId}
			{@const hasChildren = node.children.length > 0}
			{@const rowHoverTint = isCurrent ? '' : 'hover:bg-accent'}
			<!-- Elbow tick (depth > 0): hairline from the ancestor rail to this row.
			     Rail indentation now comes from nesting the children container below,
			     so no inline padding-left is needed here. -->
			<div
				class="group flex items-center gap-2 {depth > 0
					? 'relative before:absolute before:-left-4 before:top-1/2 before:h-px before:w-4 before:bg-border/60 before:content-[""]'
					: ''}"
			>
				{#if hasChildren}
					<button
						type="button"
						class="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onclick={() => toggle(node.chat.id)}
						aria-expanded={!isCollapsed}
						aria-label={isCollapsed ? 'Expand' : 'Collapse'}
					>
						<!-- Single rotating caret (US5): art-caret hooks the app.css
						     reduced-motion suppression — under reduce it snaps, otherwise
						     the 90° rotation transitions smoothly. -->
						<ChevronRight
							class="art-caret size-4 transition-transform duration-150 {!isCollapsed
								? 'rotate-90'
								: ''}"
						/>
					</button>
				{:else}
					<span class="inline-block w-4 shrink-0"></span>
				{/if}
				<a
					href="/chat/{node.chat.id}"
					class="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm transition-colors {rowHoverTint}"
					class:bg-primary={isCurrent}
					class:text-primary-foreground={isCurrent}
				>
					<span class="truncate">{node.chat.title}</span>
					<span class="shrink-0 text-xs opacity-70">{timeAgo(node.chat.updatedAt)}</span>
				</a>
				{#if node.chat.parentId !== null}
					<button
						type="button"
						title="Delete this branch and its sub-branches"
						aria-label="Delete branch"
						class="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
						disabled={deletingId === node.chat.id}
						onclick={() => deleteBranch(node)}
					>
						<Trash2 class="size-4" />
					</button>
				{/if}
			</div>
			{#if hasChildren && !isCollapsed}
				<!-- Guide rail drops from beneath the parent's caret column; each
				     direct child row carries an elbow tick back to it. -->
				<div class="ml-2 space-y-2 border-l border-border/60 pl-4">
					{#each node.children as child (child.chat.id)}
						{@render row(child, depth + 1)}
					{/each}
				</div>
			{/if}
		{/snippet}

		<div class="space-y-4">
			{#each pagedForests as root, r (root.chat.id)}
				<div
					in:entry|global={{ index: r + 1, count: pagedForests.length + 1 }}
					class="surface-card space-y-2 p-5"
				>
					{@render row(root, 0)}
					{#if root.children.length > 0}
						<span class="text-xs text-muted-foreground">{root.children.length} branches</span>
					{/if}
				</div>
			{/each}
		</div>

		<Pagination bind:page={pageNum} {totalPages} />
	{/if}
</div>

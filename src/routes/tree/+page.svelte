<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ChevronDown, ChevronRight, Trash2 } from '@lucide/svelte';
	import { repos } from '$lib/db';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { buildSubtreeModel, type SubtreeNode } from '$lib/chat/tree';
	import Pagination from '$lib/components/Pagination.svelte';
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

<div class="mx-auto flex max-w-5xl flex-col gap-6 p-8">
	<div class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Conversation tree</h1>
		<p class="text-sm text-muted-foreground">
			Every chat and its branches. Click a node to open it; click a caret to collapse a subtree.
		</p>
	</div>

	{#if loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else if forests.length === 0}
		<div class="rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-sm">
			<p class="text-sm text-muted-foreground">No chats yet.</p>
			<a href="/chat" class="mt-1 inline-block text-sm text-primary underline">Start one</a>
		</div>
	{:else}
		{#snippet row(node: SubtreeNode, depth: number)}
			{@const isCollapsed = collapsed.has(node.chat.id)}
			{@const isCurrent = node.chat.id === currentId}
			{@const hasChildren = node.children.length > 0}
			<div class="group flex items-center gap-2" style="padding-left: {depth * 1.5}rem">
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
					class="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm transition-colors hover:bg-accent"
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
				{#each node.children as child (child.chat.id)}
					{@render row(child, depth + 1)}
				{/each}
			{/if}
		{/snippet}

		<div class="space-y-4">
			{#each pagedForests as root (root.chat.id)}
				<div class="space-y-2 rounded-xl border border-border bg-card p-5 shadow-sm">
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

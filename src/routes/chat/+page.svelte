<script lang="ts">
	import { goto } from '$app/navigation';
	import { Plus, Trash2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { chatStore, listRootChats } from '$lib/stores/chat.svelte';
	import { timeAgo } from '$lib/utils/time';
	import BriefCard from '$lib/components/chat/BriefCard.svelte';
	import RowCard from '$lib/components/RowCard.svelte';
	import { entry } from '$lib/motion/stagger';
	import Pagination from '$lib/components/Pagination.svelte';
	import type { LearningBrief } from '$lib/chat/brief';
	import type { Chat } from '$lib/db/schema';

	let { data } = $props();

	let roots = $state<Chat[]>([]);
	let loading = $state(false);
	let creating = $state(false);
	let deletingId = $state<string | null>(null);
	let page = $state(1);
	let hasProviders = $state(false);

	$effect(() => {
		roots = data.roots;
		hasProviders = data.hasProviders;
	});

	/** When true, the brief intake card is shown instead of the chat list. */
	let showIntake = $state(false);

	async function newChat() {
		showIntake = true;
	}

	/** "Start learning" → create a briefed root and navigate to it. */
	async function onSaveBrief(brief: LearningBrief) {
		creating = true;
		try {
			const id = await chatStore.createAndNavigate({ brief });
			chatStore.pendingPrompt = { text: brief.goal };
			await goto(`/chat/${id}`);
		} finally {
			creating = false;
			showIntake = false;
		}
	}

	/** "Just start chatting" → create a brief-less root (today's behavior). */
	async function onSkipBrief() {
		creating = true;
		try {
			const id = await chatStore.createAndNavigate();
			await goto(`/chat/${id}`);
		} finally {
			creating = false;
			showIntake = false;
		}
	}

	const ITEMS_PER_PAGE = 7;

	let totalPages = $derived(Math.max(1, Math.ceil(roots.length / ITEMS_PER_PAGE)));
	let pagedRoots = $derived(roots.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE));

	$effect(() => {
		void roots.length;
		page = 1;
	});

	async function deleteChat(chat: Chat) {
		const msg =
			chat.title === 'New chat'
				? 'Delete this chat and all its branches?'
				: `Delete "${chat.title}" and all its branches?`;
		if (!confirm(msg)) return;
		deletingId = chat.id;
		try {
			await chatStore.deleteChat(chat.id);
			roots = await listRootChats();
		} finally {
			deletingId = null;
		}
	}
</script>

<svelte:head>
	<title>Chat — Mayon</title>
</svelte:head>

<div class="art-stagger mx-auto flex max-w-3xl flex-col gap-4 p-6">
	{#if showIntake}
		<BriefCard mode="intake" onSave={onSaveBrief} onSkip={onSkipBrief} />
		<div class="flex justify-start">
			<Button variant="ghost" size="sm" onclick={() => (showIntake = false)} disabled={creating}>
				← Back to chat list
			</Button>
		</div>
	{:else}
		<div
			in:entry|global={{ index: 0, count: pagedRoots.length + 1 }}
			class="flex items-center justify-between"
		>
			<div class="space-y-1">
				<h1 class="text-2xl font-semibold tracking-tight">Chat</h1>
				<p class="text-sm text-muted-foreground">Start a new conversation or continue one below.</p>
			</div>
			<Button onclick={newChat} disabled={creating}>
				<Plus class="size-4" /> New chat
			</Button>
		</div>

		{#if loading}
			<p class="text-sm text-muted-foreground">Loading…</p>
		{:else if roots.length === 0}
			<div
				in:entry|global={{ index: 1, count: 2 }}
				class="rounded-lg border border-dashed border-border p-8 text-center"
			>
				{#if !hasProviders}
					<p class="text-sm text-muted-foreground">Add a provider first.</p>
					<Button href="/settings" variant="outline" size="sm" class="mt-2">Open Settings</Button>
				{:else}
					<p class="text-sm text-muted-foreground">No chats yet.</p>
					<p class="mt-1 text-sm text-muted-foreground">Click "New chat" to begin.</p>
				{/if}
			</div>
		{:else}
			<ul class="space-y-2">
				{#each pagedRoots as chat, i (chat.id)}
					<li in:entry|global={{ index: i + 1, count: pagedRoots.length + 1 }}>
						<RowCard href="/chat/{chat.id}" title={chat.title} meta={timeAgo(chat.updatedAt)}>
							{#snippet action()}
								<Button
									variant="ghost"
									size="icon"
									class="size-8 text-muted-foreground hover:text-destructive"
									title="Delete this chat and its branches"
									aria-label="Delete chat"
									disabled={deletingId === chat.id}
									onclick={() => deleteChat(chat)}
								>
									<Trash2 class="size-4" />
								</Button>
							{/snippet}
						</RowCard>
					</li>
				{/each}
			</ul>
			<Pagination bind:page {totalPages} />
		{/if}
	{/if}
</div>

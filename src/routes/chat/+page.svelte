<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Plus, Trash2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { chatStore, listRootChats } from '$lib/stores/chat.svelte';
	import BriefCard from '$lib/components/chat/BriefCard.svelte';
	import type { LearningBrief } from '$lib/chat/brief';
	import type { Chat } from '$lib/db/schema';

	let roots = $state<Chat[]>([]);
	let loading = $state(true);
	let creating = $state(false);
	let deletingId = $state<string | null>(null);

	/** When true, the brief intake card is shown instead of the chat list. */
	let showIntake = $state(false);

	onMount(async () => {
		roots = await listRootChats();
		loading = false;
	});

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
</script>

<svelte:head>
	<title>Chat — Mayon</title>
</svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
	{#if showIntake}
		<BriefCard mode="intake" onSave={onSaveBrief} onSkip={onSkipBrief} />
		<div class="flex justify-start">
			<Button variant="ghost" size="sm" onclick={() => (showIntake = false)} disabled={creating}>
				← Back to chat list
			</Button>
		</div>
	{:else}
		<div class="flex items-center justify-between">
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
			<div class="rounded-lg border border-dashed border-border p-8 text-center">
				<p class="text-sm text-muted-foreground">No chats yet.</p>
				<p class="mt-1 text-sm text-muted-foreground">Click “New chat” to begin.</p>
			</div>
		{:else}
			<ul class="space-y-2">
				{#each roots as chat (chat.id)}
					<li
						class="group flex items-center gap-2 rounded-lg border border-border bg-card p-3 pr-2 text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
					>
						<a
							href="/chat/{chat.id}"
							class="flex min-w-0 flex-1 items-center justify-between gap-3"
						>
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{chat.title}</p>
								{#if chat.provider}
									<p class="text-xs text-muted-foreground">{chat.provider}</p>
								{/if}
							</div>
							<span class="shrink-0 text-xs text-muted-foreground">{timeAgo(chat.updatedAt)}</span>
						</a>
						<Button
							variant="ghost"
							size="icon"
							class="size-8 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
							title="Delete this chat and its branches"
							aria-label="Delete chat"
							disabled={deletingId === chat.id}
							onclick={() => deleteChat(chat)}
						>
							<Trash2 class="size-4" />
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

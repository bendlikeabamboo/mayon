<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Plus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { chatStore, listRootChats } from '$lib/stores/chat.svelte';
	import type { Chat } from '$lib/db/schema';

	let roots = $state<Chat[]>([]);
	let loading = $state(true);
	let creating = $state(false);

	onMount(async () => {
		roots = await listRootChats();
		loading = false;
	});

	async function newChat() {
		creating = true;
		try {
			const id = await chatStore.createAndNavigate();
			await goto(`/chat/${id}`);
		} finally {
			creating = false;
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
				<li>
					<a
						href="/chat/{chat.id}"
						class="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
					>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{chat.title}</p>
							{#if chat.provider}
								<p class="text-xs text-muted-foreground">{chat.provider}</p>
							{/if}
						</div>
						<span class="shrink-0 text-xs text-muted-foreground">{timeAgo(chat.updatedAt)}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

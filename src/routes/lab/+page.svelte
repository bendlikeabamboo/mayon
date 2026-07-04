<script lang="ts">
	import { onMount } from 'svelte';
	import { FlaskConical } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { labsStore } from '$lib/stores/labs.svelte';
	import { repos } from '$lib/db';
	import Pagination from '$lib/components/Pagination.svelte';
	import type { Chat, Lab } from '$lib/db/schema';

	const ITEMS_PER_PAGE = 7;

	/**
	 * Labs index. Lists every lab grouped by chat (each group shows the chat
	 * title as a header). "Generate lab" is chat-scoped, so it lives on the chat
	 * page, not here — this route is navigation + (optional) delete only.
	 */
	let groups = $state<{ chat: Chat | null; labs: Lab[] }[]>([]);
	let page = $state(1);

	let totalPages = $derived(Math.max(1, Math.ceil(labsStore.list.length / ITEMS_PER_PAGE)));
	let pagedSlice = $derived(
		labsStore.list.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
	);

	onMount(async () => {
		await labsStore.loadList();
		await regroup();
	});

	$effect(() => {
		void labsStore.list.length;
		page = 1;
		void regroup();
	});

	$effect(() => {
		void pagedSlice;
		void regroup();
	});

	async function regroup(): Promise<void> {
		const slice = pagedSlice;
		const byChat: Record<string, Lab[]> = {};
		const order: string[] = [];
		for (const lab of slice) {
			if (!byChat[lab.chatId]) {
				byChat[lab.chatId] = [];
				order.push(lab.chatId);
			}
			byChat[lab.chatId].push(lab);
		}
		const out: { chat: Chat | null; labs: Lab[] }[] = [];
		for (const chatId of order) {
			const chat = await repos.chats.getById(chatId);
			out.push({ chat, labs: byChat[chatId] });
		}
		groups = out;
	}

	async function onDelete(id: string): Promise<void> {
		await repos.labs.delete(id);
		await labsStore.loadList();
		await regroup();
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
	<title>Labs — Mayon</title>
</svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
	<div class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Labs</h1>
		<p class="text-sm text-muted-foreground">Hands-on labs generated from your chats.</p>
	</div>

	{#if labsStore.loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else if labsStore.list.length === 0}
		<div class="rounded-lg border border-dashed border-border p-8 text-center">
			<FlaskConical class="mx-auto size-6 text-muted-foreground" />
			<p class="mt-2 text-sm text-muted-foreground">No labs yet.</p>
			<p class="mt-1 text-sm text-muted-foreground">
				Open a chat and click “Generate lab” to create one.
			</p>
			<Button href="/chat" variant="link" class="mt-2">Go to chats</Button>
		</div>
	{:else}
		<div class="space-y-6">
			{#each groups as group (group.chat?.id ?? group.labs[0].chatId)}
				<section class="space-y-2">
					{#if group.chat}
						<a
							href="/chat/{group.chat.id}"
							class="text-xs font-medium uppercase tracking-wide text-muted-foreground hover:underline"
						>
							{group.chat.title}
						</a>
					{:else}
						<p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							(deleted chat)
						</p>
					{/if}
					<ul class="space-y-2">
						{#each group.labs as lab (lab.id)}
							<li
								class="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
							>
								<a href="/lab/{lab.id}" class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{lab.title}</p>
									<p class="text-xs text-muted-foreground">{timeAgo(lab.createdAt)}</p>
								</a>
								<Button
									variant="ghost"
									size="sm"
									class="opacity-0 transition-opacity group-hover:opacity-100"
									onclick={() => onDelete(lab.id)}
								>
									Delete
								</Button>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
		<Pagination bind:page {totalPages} />
	{/if}
</div>

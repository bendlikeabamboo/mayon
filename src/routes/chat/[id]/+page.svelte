<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Network } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { repos } from '$lib/db';
	import { breadcrumbToRoot } from '$lib/chat/tree';
	import type { Chat } from '$lib/db/schema';
	import type { SelectionInput } from '$lib/chat/highlight';
	import MessageList from '$lib/components/chat/MessageList.svelte';
	import Composer from '$lib/components/chat/Composer.svelte';
	import Breadcrumb from '$lib/components/chat/Breadcrumb.svelte';
	import CrossLinks from '$lib/components/chat/CrossLinks.svelte';

	let breadcrumb = $state<Chat[]>([]);
	let children = $state<Chat[]>([]);
	let siblings = $state<Chat[]>([]);

	async function loadNav(chat: Chat) {
		const subtree = await repos.chats.listSubtree(chat.rootId);
		const byId = new Map(subtree.map((c) => [c.id, c]));
		breadcrumb = breadcrumbToRoot(chat, byId);
		// Children: direct descendants of the current chat.
		children = await repos.chats.listChildren(chat.id);
		// Siblings: children of the parent (if any), excluding self.
		if (chat.parentId) {
			siblings = (await repos.chats.listChildren(chat.parentId)).filter((c) => c.id !== chat.id);
		} else {
			siblings = [];
		}
	}

	async function loadAll(chatId: string) {
		await chatStore.load(chatId);
		if (chatStore.chat) await loadNav(chatStore.chat);
	}

	onMount(() => {
		const initial = page.params.id;
		if (initial) return loadAll(initial);
	});

	// Reload when navigating between chats ([id] changes).
	let lastId = page.params.id;
	$effect(() => {
		const current = page.params.id;
		if (current && current !== lastId) {
			lastId = current;
			void loadAll(current);
		}
	});

	async function onSend(text: string) {
		await chatStore.send(text);
	}

	async function onBranchSelection(messageId: string, raw: string, sel: SelectionInput) {
		const childId = await chatStore.branchFromSelection(messageId, raw, sel);
		await goto(`/chat/${childId}`);
	}

	async function onBranchWhole(messageId: string) {
		const childId = await chatStore.branchFromMessage(messageId);
		await goto(`/chat/${childId}`);
	}
</script>

<svelte:head>
	<title>{chatStore.chat?.title ?? 'Chat'} — Mayon</title>
</svelte:head>

<div class="mx-auto flex h-full max-w-3xl flex-col gap-3 p-4">
	{#if chatStore.loading}
		<p class="py-8 text-center text-sm text-muted-foreground">Loading chat…</p>
	{:else if !chatStore.chat}
		<div class="py-8 text-center">
			<p class="text-sm text-muted-foreground">Chat not found.</p>
			<Button href="/chat" variant="link" class="mt-2">Back to chat list</Button>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-2">
			<div class="min-w-0 flex-1">
				<Breadcrumb chain={breadcrumb} />
			</div>
			<Button
				href="/tree"
				variant="ghost"
				size="sm"
				class="shrink-0"
				title="Open the conversation tree"
			>
				<Network class="size-4" /> Tree
			</Button>
		</div>

		<CrossLinks chatId={chatStore.chat.id} />

		<MessageList
			messages={chatStore.messages}
			streaming={chatStore.streaming}
			streamBuffer={chatStore.streamBuffer}
			{onBranchSelection}
			{onBranchWhole}
		/>

		{#if chatStore.error}
			<div class="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
				<p class="font-medium text-red-700 dark:text-red-400">{chatStore.error.title}</p>
				<p class="mt-0.5 text-red-700/90 dark:text-red-400/90">{chatStore.error.message}</p>
				{#if chatStore.error.hint}
					<p class="mt-1 text-xs text-muted-foreground">{chatStore.error.hint}</p>
				{/if}
				{#if chatStore.error.title === 'Missing API key'}
					<Button href="/settings" variant="outline" size="sm" class="mt-2">Open Settings</Button>
				{/if}
			</div>
		{/if}

		<Composer
			bind:streaming={chatStore.streaming}
			{onSend}
			onStop={chatStore.stop.bind(chatStore)}
		/>

		<!-- Children + siblings under the composer -->
		{#if children.length > 0 || siblings.length > 0}
			<div class="space-y-2 border-t border-border pt-2">
				{#if children.length > 0}
					<div>
						<p class="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Branches from here ({children.length})
						</p>
						<ul class="flex flex-wrap gap-1.5">
							{#each children as c (c.id)}
								<li>
									<a
										href="/chat/{c.id}"
										class="inline-block rounded-md border border-border bg-background px-2 py-0.5 text-xs hover:bg-accent"
										title={c.title}
									>
										{c.title}
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if siblings.length > 0}
					<div>
						<p class="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Siblings ({siblings.length})
						</p>
						<ul class="flex flex-wrap gap-1.5">
							{#each siblings as c (c.id)}
								<li>
									<a
										href="/chat/{c.id}"
										class="inline-block rounded-md border border-border bg-background px-2 py-0.5 text-xs hover:bg-accent"
										title={c.title}
									>
										{c.title}
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

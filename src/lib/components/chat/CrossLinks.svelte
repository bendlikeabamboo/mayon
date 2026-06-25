<script lang="ts">
	import { Link2, Plus, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { repos } from '$lib/db';
	import type { Chat, CrossLink } from '$lib/db/schema';

	/**
	 * Cross-links panel atop a chat. Lists bidirectional references and offers a
	 * minimal "link chat" picker over root chats. References are stored via
	 * `crossLinksRepo`; removing a link deletes the row.
	 */
	let { chatId }: { chatId: string } = $props();

	let links = $state<CrossLink[]>([]);
	let pickerOpen = $state(false);
	let allChats = $state<Chat[]>([]);

	const otherSide = (link: CrossLink): string =>
		link.fromChatId === chatId ? link.toChatId : link.fromChatId;

	async function refresh() {
		links = await repos.crossLinks.listForChat(chatId);
	}

	async function openPicker() {
		pickerOpen = true;
		// Offer roots (and the current subtree is excluded implicitly since the
		// user picks a different chat). A full picker is out of scope for P2.
		allChats = (await repos.chats.listRoots()).filter((c) => c.id !== chatId);
	}

	async function linkTo(targetId: string) {
		await repos.crossLinks.create({ fromChatId: chatId, toChatId: targetId });
		pickerOpen = false;
		await refresh();
	}

	async function removeLink(id: string) {
		await repos.crossLinks.delete(id);
		await refresh();
	}

	// Reload whenever the chat id changes.
	$effect(() => {
		void chatId;
		void refresh();
	});
</script>

<section class="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
	<div class="flex items-center justify-between">
		<h3
			class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
		>
			<Link2 class="size-3.5" /> Cross-links
		</h3>
		{#if !pickerOpen}
			<Button variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={openPicker}>
				<Plus class="size-3" /> Link chat
			</Button>
		{/if}
	</div>

	{#if pickerOpen}
		<div class="space-y-1">
			{#if allChats.length === 0}
				<p class="text-xs text-muted-foreground">No other chats to link.</p>
			{:else}
				<ul class="max-h-40 space-y-1 overflow-auto">
					{#each allChats as c (c.id)}
						<li>
							<button
								type="button"
								class="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-accent"
								title={c.title}
								onclick={() => linkTo(c.id)}
							>
								{c.title}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="flex justify-end">
				<Button
					variant="ghost"
					size="sm"
					class="h-6 px-2 text-xs"
					onclick={() => (pickerOpen = false)}
				>
					Cancel
				</Button>
			</div>
		</div>
	{:else if links.length === 0}
		<p class="text-xs text-muted-foreground">No cross-links yet.</p>
	{:else}
		<ul class="flex flex-wrap gap-1.5">
			{#each links as link (link.id)}
				{@const targetId = otherSide(link)}
				<li
					class="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
				>
					<a href="/chat/{targetId}" class="hover:underline" title={targetId}>
						{link.note ?? 'linked chat'}
					</a>
					<button
						type="button"
						class="text-muted-foreground hover:text-destructive"
						title="Remove link"
						aria-label="Remove link"
						onclick={() => removeLink(link.id)}
					>
						<X class="size-3" />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

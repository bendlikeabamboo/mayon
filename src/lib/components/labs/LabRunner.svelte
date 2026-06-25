<script lang="ts">
	import { ArrowLeft } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import Markdown from '$lib/components/chat/Markdown.svelte';
	import { labsStore } from '$lib/stores/labs.svelte';
	import { labsRepo, type LabChecklistItem } from '$lib/db/repositories/labs';
	import type { Lab } from '$lib/db/schema';

	/**
	 * Lab runner: renders the generated markdown body and an interactive
	 * checklist bound to `labsStore.toggleItem` (optimistic). The content is
	 * read-only — only checklist items are interactive.
	 */
	let { lab }: { lab: Lab } = $props();

	// Parse the checklist reactively from the lab row. The store updates
	// `labsStore.current.checklist` on a successful toggle, so this stays live.
	const items = $derived<LabChecklistItem[]>(labsRepo.parseChecklist(lab.checklist));
	const doneCount = $derived(items.filter((i) => i.done).length);
</script>

<svelte:head>
	<title>{lab.title} — Lab — Mayon</title>
</svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
	<div class="flex items-center justify-between gap-2">
		<Button href="/chat/{lab.chatId}" variant="ghost" size="sm">
			<ArrowLeft class="size-4" /> Back to chat
		</Button>
		<a href="/lab" class="text-xs text-muted-foreground hover:underline">All labs</a>
	</div>

	<div class="space-y-1">
		{#if lab.model}
			<p class="text-xs text-muted-foreground">{lab.model}</p>
		{/if}
	</div>

	<!-- Generated markdown body (read-only). Reuses the chat markdown renderer
	     so KaTeX / Shiki / GFM / mermaid all work identically. -->
	<Markdown raw={lab.content} />

	<!-- Interactive checklist -->
	<section class="space-y-2 rounded-lg border border-border bg-card p-4">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				Checklist
			</h2>
			{#if items.length > 0}
				<span class="text-xs text-muted-foreground">{doneCount}/{items.length} done</span>
			{/if}
		</div>

		{#if items.length === 0}
			<p class="text-sm text-muted-foreground">
				No checklist items. (Raw-saved labs have an empty checklist.)
			</p>
		{:else}
			<ul class="space-y-1">
				{#each items as item (item.id)}
					{@const labelClass = item.done
						? 'line-through text-muted-foreground'
						: 'text-foreground'}
					<li class="flex items-start gap-2">
						<input
							type="checkbox"
							id={`item-${item.id}`}
							class="mt-0.5 size-4 shrink-0 cursor-pointer accent-emerald-600"
							checked={item.done}
							onchange={() => labsStore.toggleItem(lab.id, item.id)}
						/>
						<label for={`item-${item.id}`} class={`cursor-pointer text-sm ${labelClass}`}>
							{item.text}
						</label>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

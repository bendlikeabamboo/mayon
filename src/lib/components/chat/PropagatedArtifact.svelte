<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ChevronRight,
		ChevronDown,
		CornerLeftUp,
		LoaderCircle,
		RefreshCw,
		Trash2
	} from '@lucide/svelte';
	import type { Message } from '$lib/db/schema';
	import { parseMetadata, type BranchArtifactMetadata } from '$lib/chat/kinds';
	import { incRender } from '$lib/perf/mark';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { chatStore } from '$lib/stores/chat.svelte';

	/**
	 * Collapsible timeline entry for a `branch_artifact` row (020 US1/US3): a
	 * back-propagated branch outcome anchored in its parent chat. Same collapse
	 * pattern as ReasoningEntry/ToolActivity — collapsed labeled strip (source
	 * branch, mode badge, timestamp), expand for the full payload. Summary-mode
	 * artifacts expose Regenerate (re-runs generation, content replaced in
	 * place) and Delete (confirm step, removes only the artifact row); raw-mode
	 * artifacts expose Delete only, per FR-007. Busy and error states mirror the
	 * store's `propagationStatus`/`propagationError`. Metadata is parsed
	 * defensively: a missing/corrupt JSON blob degrades to fallbacks instead of
	 * crashing the timeline.
	 */
	let {
		entry,
		onRegenerate,
		onDelete
	}: {
		entry: Message;
		onRegenerate?: (id: string) => void | Promise<void>;
		onDelete?: (id: string) => void | Promise<void>;
	} = $props();

	const meta = $derived(parseMetadata<BranchArtifactMetadata>(entry.metadata));
	const modeLabel = $derived(meta?.mode === 'summary' ? 'Summary' : 'Raw');
	const badgeVariant = $derived(meta?.mode === 'summary' ? 'secondary' : 'outline');
	const sourceTitle = $derived(meta?.sourceChatTitle ?? 'unknown branch');
	const derivedAnchor = $derived(meta?.anchor === 'derived');
	const timestamp = $derived(
		Number.isFinite(entry.createdAt) ? new Date(entry.createdAt).toLocaleString() : ''
	);
	const canRegenerate = $derived(meta?.mode === 'summary' && onRegenerate !== undefined);
	const busy = $derived(chatStore.propagationStatus === 'running');
	const error = $derived(
		chatStore.propagationStatus === 'error' ? chatStore.propagationError : null
	);

	let open = $state(false);

	function handleRegenerate() {
		void onRegenerate?.(entry.id);
	}

	function handleDelete() {
		// Destructive-action confirm, matching the tree page's branch delete.
		if (!confirm(`Delete the artifact back-propagated from "${sourceTitle}"?`)) return;
		void onDelete?.(entry.id);
	}

	onMount(() => incRender('TimelineRow'));
</script>

<div class="flex flex-col gap-1 items-start">
	<button
		type="button"
		class="flex items-center gap-1.5 px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<CornerLeftUp class="size-3 shrink-0" />
		<span class="max-w-64 truncate" title={sourceTitle}>
			Back-propagated from "{sourceTitle}"
		</span>
		<Badge variant={badgeVariant} class="text-[10px] px-1.5 py-0">{modeLabel}</Badge>
		{#if timestamp}
			<span class="text-muted-foreground/70">{timestamp}</span>
		{/if}
		{#if derivedAnchor}
			<span
				class="italic text-muted-foreground/70"
				title="This branch had no recorded fork point — the artifact anchors at the parent's state when the branch was created."
			>
				derived anchor
			</span>
		{/if}
		{#if open}
			<ChevronDown class="size-3" />
		{:else}
			<ChevronRight class="size-3" />
		{/if}
	</button>
	{#if open}
		<div class="flex w-full flex-col gap-1">
			<pre
				class="max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all">{entry.content}</pre>
			{#if canRegenerate || onDelete}
				<div class="flex flex-wrap items-center gap-2 px-1">
					{#if canRegenerate}
						<Button
							variant="ghost"
							size="sm"
							class="h-7 gap-1 px-2 text-xs"
							aria-label="Regenerate summary"
							disabled={busy}
							onclick={handleRegenerate}
						>
							{#if busy}
								<LoaderCircle class="size-3 animate-spin" />
							{:else}
								<RefreshCw class="size-3" />
							{/if}
							Regenerate
						</Button>
					{/if}
					{#if onDelete}
						<Button
							variant="ghost"
							size="sm"
							class="h-7 gap-1 px-2 text-xs text-red-700 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
							aria-label="Delete artifact"
							disabled={busy}
							onclick={handleDelete}
						>
							<Trash2 class="size-3" />
							Delete
						</Button>
					{/if}
					{#if error}
						<p class="text-xs text-red-700 dark:text-red-400" role="alert">{error}</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

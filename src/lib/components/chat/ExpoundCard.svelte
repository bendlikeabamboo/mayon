<script lang="ts">
	import { ArrowLeft, FileText } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { TOGGLE_LABELS, type ExpoundToggle } from '$lib/chat/expound';

	let {
		excerpt,
		customInstructions,
		addFormats,
		parentChatId,
		sourceMessageId,
		childId
	}: {
		excerpt: string;
		customInstructions: string | null;
		addFormats: ExpoundToggle[];
		parentChatId: string;
		sourceMessageId: string;
		childId: string;
	} = $props();
</script>

<div class="w-full rounded-lg border border-border bg-card p-3 text-sm">
	<div class="flex items-center gap-2 text-muted-foreground">
		<FileText class="size-3 shrink-0" />
		<span class="font-medium">Expound branch</span>
	</div>

	<blockquote
		class="mt-2 border-l-2 border-muted-foreground/30 pl-3 text-xs text-muted-foreground italic"
	>
		{excerpt.length > 280 ? excerpt.slice(0, 277) + '...' : excerpt}
	</blockquote>

	<div class="mt-2 space-y-1 text-xs">
		<div class="flex items-start gap-2">
			<span class="shrink-0 text-muted-foreground">Instructions:</span>
			<span class="text-foreground">{customInstructions || '(none)'}</span>
		</div>
		<div class="flex items-start gap-2">
			<span class="shrink-0 text-muted-foreground">Formats:</span>
			{#if addFormats.length > 0}
				<span class="flex flex-wrap gap-1">
					{#each addFormats as fmt (fmt)}
						<span
							class="rounded-full border border-border bg-background px-2 py-0.5 text-muted-foreground"
						>
							{TOGGLE_LABELS[fmt]}
						</span>
					{/each}
				</span>
			{:else}
				<span class="text-muted-foreground">(none)</span>
			{/if}
		</div>
	</div>

	<div class="mt-2">
		<Button variant="outline" size="sm" href="/chat/{parentChatId}#m={sourceMessageId}&b={childId}">
			<ArrowLeft class="size-3" />
			View on parent
		</Button>
	</div>
</div>

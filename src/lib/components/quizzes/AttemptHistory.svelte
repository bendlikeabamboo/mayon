<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { quizzesStore } from '$lib/stores/quizzes.svelte';

	/**
	 * Past attempts for the loaded quiz. Each row shows its score, a relative
	 * timestamp, and a "Review" action that loads that attempt read-only
	 * (disabled for the currently-active attempt). Mirrors the lab index card
	 * style. Reads the quizzes store directly (no props).
	 */
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

{#if quizzesStore.history.length > 0}
	<section class="space-y-2">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
			Attempts ({quizzesStore.history.length})
		</h2>
		<ul class="space-y-2">
			{#each quizzesStore.history as a (a.id)}
				<li
					class="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
				>
					<div class="min-w-0">
						<p class="text-sm font-medium">Score: {a.score != null ? `${a.score}` : '—'}</p>
						<p class="text-xs text-muted-foreground">{timeAgo(a.startedAt)}</p>
					</div>
					<Button
						variant="ghost"
						size="sm"
						disabled={a.id === quizzesStore.activeAttempt?.id}
						onclick={() => quizzesStore.reviewAttempt(a.id)}
					>
						Review
					</Button>
				</li>
			{/each}
		</ul>
	</section>
{:else}
	<p class="text-sm text-muted-foreground">No attempts yet.</p>
{/if}

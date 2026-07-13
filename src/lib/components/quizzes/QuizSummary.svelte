<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { quizzesStore } from '$lib/stores/quizzes.svelte';
	import type { QuizQuestionType } from '$lib/db/schema';

	/**
	 * End-of-attempt summary: the aggregate score + percentage, a per-type
	 * breakdown (only types that appear in the quiz), and a link back to the
	 * source chat. Reads the quizzes store directly (no props).
	 */
	const pct = $derived(
		quizzesStore.total > 0 ? Math.round((quizzesStore.score / quizzesStore.total) * 100) : 0
	);

	const types: QuizQuestionType[] = ['mcq', 'flashcard', 'short'];
	const labelFor: Record<QuizQuestionType, string> = {
		mcq: 'MCQ',
		flashcard: 'Flashcard',
		short: 'Short'
	};

	function breakdown(type: QuizQuestionType): { correct: number; total: number } {
		const qs = quizzesStore.questions.filter((q) => q.type === type);
		const correct = qs.filter((q) => quizzesStore.answers[q.id]?.isCorrect === true).length;
		return { correct, total: qs.length };
	}
</script>

<section class="space-y-3 rounded-lg border border-border bg-card p-4">
	<div>
		<p class="text-3xl font-semibold tracking-tight">
			{quizzesStore.score}/{quizzesStore.total}
		</p>
		<p class="text-sm text-muted-foreground">{pct}%</p>
	</div>
	<ul class="space-y-1 text-sm text-muted-foreground">
		{#each types as type (type)}
			{@const b = breakdown(type)}
			{#if b.total > 0}
				<li>{labelFor[type]}: {b.correct}/{b.total}</li>
			{/if}
		{/each}
	</ul>
	{#if quizzesStore.current}
		<Button href="/chat/{quizzesStore.current.chatId}" variant="link">Back to chat</Button>
	{/if}
</section>

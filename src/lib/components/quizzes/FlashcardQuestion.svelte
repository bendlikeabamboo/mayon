<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import Markdown from '$lib/components/chat/Markdown.svelte';
	import { repos } from '$lib/db';
	import type { FlashcardPayload } from '$lib/db';
	import type { QuizAnswer, QuizQuestion } from '$lib/db/schema';

	/**
	 * Flashcard question. "Reveal" flips the back into view (allowed in review);
	 * "Got it" / "Missed" self-mark and lock once an `answer` row exists or the
	 * question is read-only.
	 */
	let {
		q,
		answer,
		readonly,
		onAnswer
	}: {
		q: QuizQuestion;
		answer: QuizAnswer | undefined;
		readonly: boolean;
		onAnswer: (gotIt: boolean) => void;
	} = $props();

	const payload = $derived(repos.quizQuestions.parsePayload<FlashcardPayload>(q.payload));
	// Revealed once the user clicks Reveal or an answer row already exists.
	let localReveal = $state(false);
	const revealed = $derived(!!answer || localReveal);
	const canMark = $derived(answer == null && !readonly);
</script>

<div class="space-y-2">
	<p class="text-sm font-medium">{q.prompt}</p>
	<div class="rounded-md border border-border bg-card p-3 text-sm">
		<p class="font-medium">{payload.front}</p>
	</div>

	{#if revealed}
		<div class="rounded-md border border-border bg-muted/30 p-3 text-sm">
			<Markdown raw={payload.back} />
		</div>
		{#if answer}
			{#if answer.isCorrect === 1}
				<p class="text-xs font-medium text-emerald-600 dark:text-emerald-400">Marked: Got it</p>
			{:else}
				<p class="text-xs font-medium text-red-600 dark:text-red-400">Marked: Missed</p>
			{/if}
		{:else if canMark}
			<div class="flex gap-2">
				<Button variant="outline" size="sm" onclick={() => onAnswer(true)}>Got it</Button>
				<Button variant="outline" size="sm" onclick={() => onAnswer(false)}>Missed</Button>
			</div>
		{/if}
	{:else}
		<Button variant="outline" size="sm" onclick={() => (localReveal = true)}>Reveal</Button>
	{/if}
</div>

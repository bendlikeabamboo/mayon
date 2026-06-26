<script lang="ts">
	import { repos } from '$lib/db';
	import type { McqPayload } from '$lib/db';
	import type { QuizAnswer, QuizQuestion } from '$lib/db/schema';

	/**
	 * MCQ question. Radio options lock on submit (an `answer` row existing or
	 * `readonly` review). The correct option gets an emerald tint; a wrong pick
	 * gets a red tint once answered.
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
		onAnswer: (idx: number) => void;
	} = $props();

	const payload = $derived(repos.quizQuestions.parsePayload<McqPayload>(q.payload));
	const locked = $derived(answer != null || readonly);

	// The displayed pick is the stored answer once recorded, otherwise the
	// optimistic local pick (set on click before the async persist lands).
	let localPick = $state<number | null>(null);
	const selected = $derived(answer ? Number(answer.answer) : localPick);

	function choose(i: number) {
		if (locked) return;
		localPick = i;
		onAnswer(i);
	}

	function optionClass(i: number): string {
		const isCorrect = i === payload.answerIndex;
		const isChosen = i === selected;
		if (answer != null && isCorrect) {
			return 'border-emerald-500/40 bg-emerald-500/10';
		}
		if (answer != null && isChosen && !isCorrect) {
			return 'border-red-500/40 bg-red-500/10';
		}
		return locked
			? 'border-border bg-card'
			: 'cursor-pointer border-border bg-card hover:bg-accent';
	}
</script>

<div class="space-y-2">
	<p class="text-sm font-medium">{q.prompt}</p>
	<ul class="space-y-1">
		{#each payload.options as option, i (i)}
			<li>
				<label class={`flex items-center gap-2 rounded-md border p-2 text-sm ${optionClass(i)}`}>
					<input
						type="radio"
						name={q.id}
						class="size-4"
						style="accent-color: var(--highlight)"
						checked={i === selected}
						disabled={locked}
						onchange={() => choose(i)}
					/>
					<span>{option}</span>
				</label>
			</li>
		{/each}
	</ul>
	{#if answer}
		{#if answer.isCorrect === 1}
			<p class="text-xs font-medium text-emerald-600 dark:text-emerald-400">Correct</p>
		{:else}
			<p class="text-xs font-medium text-red-600 dark:text-red-400">Incorrect</p>
		{/if}
	{/if}
</div>

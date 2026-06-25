<script lang="ts">
	import { LoaderCircle } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import Markdown from '$lib/components/chat/Markdown.svelte';
	import { repos } from '$lib/db';
	import type { ShortPayload } from '$lib/db';
	import type { QuizAnswer, QuizQuestion } from '$lib/db/schema';

	/**
	 * Short-answer question. Submits the typed text for AI grading; while
	 * `grading`, inputs lock and a spinner shows. Once graded, the verdict +
	 * `aiFeedback` render (emerald / red / amber-ungraded with a Re-grade
	 * affordance).
	 */
	let {
		q,
		answer,
		grading,
		readonly,
		onAnswer,
		onRegrade
	}: {
		q: QuizQuestion;
		answer: QuizAnswer | undefined;
		grading: boolean;
		readonly: boolean;
		onAnswer: (text: string) => void;
		onRegrade: () => void;
	} = $props();

	const payload = $derived(repos.quizQuestions.parsePayload<ShortPayload>(q.payload));
	// `text` is the editable buffer (empty until typed). The textarea shows the
	// stored answer once one exists (covers review + post-submit), otherwise the
	// buffer being typed.
	let text = $state('');
	const displayText = $derived(answer ? answer.answer : text);
	const canSubmit = $derived(text.trim() !== '' && !grading && !readonly && answer == null);

	function submit() {
		if (!canSubmit) return;
		onAnswer(text.trim());
	}
</script>

<div class="space-y-2">
	<p class="text-sm font-medium">{q.prompt}</p>

	<details class="rounded-md border border-border bg-muted/30 p-3">
		<summary class="cursor-pointer text-xs font-medium text-muted-foreground">
			Grading rubric
		</summary>
		<p class="mt-2 text-xs text-muted-foreground">{payload.rubric}</p>
	</details>

	<textarea
		class="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
		placeholder="Type your answer…"
		value={displayText}
		disabled={grading || readonly || answer != null}
		oninput={(e) => (text = e.currentTarget.value)}
	></textarea>

	{#if grading}
		<p class="flex items-center gap-2 text-xs text-muted-foreground">
			<LoaderCircle class="size-3.5 animate-spin" /> Grading…
		</p>
	{/if}

	{#if !answer}
		<Button size="sm" onclick={submit} disabled={!canSubmit}>Submit</Button>
	{:else if answer.isCorrect === 1}
		<div class="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
			<p class="font-medium text-emerald-600 dark:text-emerald-400">Correct</p>
			{#if answer.aiFeedback}
				<div class="mt-1 text-foreground"><Markdown raw={answer.aiFeedback} /></div>
			{/if}
		</div>
	{:else if answer.isCorrect === 0}
		<div class="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
			<p class="font-medium text-red-600 dark:text-red-400">Incorrect</p>
			{#if answer.aiFeedback}
				<div class="mt-1 text-foreground"><Markdown raw={answer.aiFeedback} /></div>
			{/if}
		</div>
	{:else}
		<div class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
			<p class="font-medium text-amber-600 dark:text-amber-400">Not graded</p>
			{#if answer.aiFeedback}
				<div class="mt-1 text-foreground"><Markdown raw={answer.aiFeedback} /></div>
			{/if}
			{#if !readonly}
				<Button variant="outline" size="sm" class="mt-2" onclick={onRegrade}>Re-grade</Button>
			{/if}
		</div>
	{/if}
</div>

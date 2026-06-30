<script lang="ts">
	import { ArrowLeft, Wrench } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { quizzesStore } from '$lib/stores/quizzes.svelte';
	import DiagnosticsPanel from '$lib/components/diagnostics/DiagnosticsPanel.svelte';
	import { diagnosticsStore } from '$lib/stores/diagnostics.svelte';
	import McqQuestion from './McqQuestion.svelte';
	import FlashcardQuestion from './FlashcardQuestion.svelte';
	import ShortQuestion from './ShortQuestion.svelte';
	import QuizSummary from './QuizSummary.svelte';
	import AttemptHistory from './AttemptHistory.svelte';

	/**
	 * Quiz runner. Delegates each question by type to its component, tracks
	 * live progress/score from the store, and offers start / retake / review of
	 * past attempts. Reads the quizzes store directly (no props): assumes a quiz
	 * has been loaded into `quizzesStore.current`.
	 */
</script>

<svelte:head>
	<title>Quiz — Mayon</title>
</svelte:head>

{#if quizzesStore.current}
	<div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
		<div class="flex items-center justify-between gap-2">
			<Button href="/chat/{quizzesStore.current.chatId}" variant="ghost" size="sm">
				<ArrowLeft class="size-4" /> Back to chat
			</Button>
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon"
					title="Diagnostics"
					aria-label="Diagnostics"
					onclick={() => diagnosticsStore.toggle()}
				>
					<Wrench class="size-4" />
				</Button>
				<a href="/quiz" class="text-xs text-muted-foreground hover:underline">All quizzes</a>
			</div>
		</div>

		{#if quizzesStore.current.model}
			<p class="text-xs text-muted-foreground">{quizzesStore.current.model}</p>
		{/if}

		{#if quizzesStore.activeAttempt}
			<p class="text-xs text-muted-foreground">
				Answered {quizzesStore.answeredCount}/{quizzesStore.total} · Score {quizzesStore.score}
			</p>
		{/if}

		{#if quizzesStore.error}
			<div class="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
				<p class="font-medium text-red-700 dark:text-red-400">{quizzesStore.error.title}</p>
				<p class="mt-0.5 text-red-700/90 dark:text-red-400/90">{quizzesStore.error.message}</p>
				{#if quizzesStore.error.hint}
					<p class="mt-1 text-xs text-muted-foreground">{quizzesStore.error.hint}</p>
				{/if}
			</div>
		{/if}

		{#if !quizzesStore.activeAttempt}
			<div class="rounded-lg border border-border bg-card p-6 text-center">
				<Button onclick={() => quizzesStore.startAttempt()}>Start quiz</Button>
			</div>
			{#if quizzesStore.history.length}
				<AttemptHistory />
			{/if}
		{:else if !quizzesStore.allAnswered}
			<ol class="space-y-4">
				{#each quizzesStore.questions as q, ord (q.id)}
					{@const ans = quizzesStore.answers[q.id]}
					<li class="space-y-2 rounded-lg border border-border bg-card p-4">
						<p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Question {ord + 1}
						</p>
						{#if q.type === 'mcq'}
							<McqQuestion
								{q}
								answer={ans}
								readonly={quizzesStore.reviewing}
								onAnswer={(idx) => quizzesStore.answerMcq(q.id, idx)}
							/>
						{:else if q.type === 'flashcard'}
							<FlashcardQuestion
								{q}
								answer={ans}
								readonly={quizzesStore.reviewing}
								onAnswer={(got) => quizzesStore.answerFlashcard(q.id, got)}
							/>
						{:else}
							<ShortQuestion
								{q}
								answer={ans}
								grading={quizzesStore.gradingQuestionId === q.id}
								readonly={quizzesStore.reviewing}
								onAnswer={(t) => quizzesStore.answerShort(q.id, t)}
								onRegrade={() => quizzesStore.regrade(q.id)}
							/>
						{/if}
					</li>
				{/each}
			</ol>
		{:else}
			<QuizSummary />
			<div class="flex items-center justify-between gap-2">
				{#if quizzesStore.reviewing}
					<p class="text-xs text-muted-foreground">Reviewing a past attempt</p>
				{/if}
				<Button onclick={() => quizzesStore.retake()}>Retake</Button>
			</div>
			<AttemptHistory />
		{/if}
		<DiagnosticsPanel quizId={quizzesStore.current.id} title="Diagnostics — Quiz" />
	</div>
{/if}

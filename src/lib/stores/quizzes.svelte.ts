/**
 * Quizzes store (architecture.md §7, P4).
 *
 * A runes-class singleton mirroring `labs.svelte.ts`. Owns the quiz-list view
 * state (`list`), the runner view state (`current`, `questions`), the attempt +
 * grading lifecycle (`activeAttempt`, `answers`), the generation flow
 * (`generate`), and the live score (derived `score` / `allAnswered` /
 * `isComplete`).
 *
 * Scoring model:
 *   - MCQ + flashcard are auto-scored locally (no model round-trip): the correct
 *     index / the learner's self-mark is written straight to the answer row.
 *   - Short-answer is AI-graded via `provider.gradeShortAnswer`. On success the
 *     verdict + feedback replace the pending row. On failure the row is left
 *     ungraded: `isCorrect` stays `null` (so it is EXCLUDED from `score`) and
 *     the failure message is stored in `aiFeedback`, surfaced per-question with a
 *     Re-grade affordance (`regrade`) rather than as a global error.
 *
 * A short-answer grading failure never blocks the other questions. The attempt
 * is auto-finalised once every question has an answer row; a `null` grade (a
 * failed short answer) is simply not counted toward the score, and the failure
 * path itself does not trigger finalisation — re-grading (or answering another
 * question) is what closes the attempt.
 *
 * Generation + abort handling mirror `labsStore.generate`: `AbortError` is
 * swallowed; `QuizGenerationError` sets a typed `error`; everything else goes
 * through `formatProviderError`.
 */
import { browser } from '$app/environment';
import { repos } from '$lib/db';
import type { McqPayload, ShortPayload } from '$lib/db';
import type { Quiz, QuizAnswer, QuizAttempt, QuizQuestion } from '$lib/db/schema';
import { assembleContext } from '$lib/chat/context';
import { getActiveSdkProvider } from '$lib/ai/client';
import { formatProviderError, type FormattedProviderError } from '$lib/ai/errors';
import {
	QuizGenerationError,
	generateQuiz,
	gradeShortAnswer
} from '$lib/ai/generate/generate-quiz';
import { toQuizQuestions } from '$lib/ai/generate/quiz';

function isAbortError(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'AbortError';
}

class QuizzesState {
	list = $state<Quiz[]>([]);
	current = $state<Quiz | null>(null);
	questions = $state<QuizQuestion[]>([]);
	activeAttempt = $state<QuizAttempt | null>(null);
	answers = $state<Record<string, QuizAnswer>>({});
	history = $state<QuizAttempt[]>([]);
	generating = $state(false);
	loading = $state(false);
	gradingQuestionId = $state<string | null>(null);
	error = $state<FormattedProviderError | null>(null);
	/** True while reviewing a past attempt (read-only answers; no re-answer). */
	reviewing = $state(false);

	private controller: AbortController | null = null;

	/** Number of questions in the loaded quiz. */
	get total(): number {
		return this.questions.length;
	}

	/** Number of questions with a recorded answer in the active attempt. */
	get answeredCount(): number {
		return Object.keys(this.answers).length;
	}

	/** Live score: only definitely-correct answers are counted. A `null` grade
	 *  (pending/failed short answer) is excluded. */
	get score(): number {
		return Object.values(this.answers).filter((a) => a.isCorrect === 1).length;
	}

	/** True once every question has a recorded answer row. */
	get allAnswered(): boolean {
		return this.questions.length > 0 && this.answeredCount === this.questions.length;
	}

	/** True once the active attempt has been finalised (`finishedAt` set). */
	get isComplete(): boolean {
		return this.activeAttempt != null && this.activeAttempt.finishedAt != null;
	}

	/** Load all quizzes (newest first) for the `/quiz` index page. */
	async loadList(): Promise<void> {
		if (!browser) return;
		this.loading = true;
		try {
			this.list = await repos.quizzes.listAll();
		} finally {
			this.loading = false;
		}
	}

	/** Load a single quiz into `current` for the `/quiz/[id]` runner, resuming any
	 *  in-progress attempt and rebuilding its answer map. */
	async loadQuiz(id: string): Promise<void> {
		if (!browser) return;
		this.loading = true;
		this.error = null;
		try {
			this.current = await repos.quizzes.getById(id);
			if (this.current == null) {
				this.error = { title: 'Could not load quiz', message: 'Quiz not found.' };
				this.questions = [];
				this.answers = {};
				this.activeAttempt = null;
				return;
			}
			this.reviewing = false;
			this.questions = await repos.quizQuestions.listByQuiz(id);
			this.history = await repos.quizAttempts.listByQuiz(id);
			const inProgress = this.history.find((a) => a.finishedAt == null);
			if (inProgress) {
				this.activeAttempt = inProgress;
				const rows = await repos.quizAnswers.listByAttempt(inProgress.id);
				const restored: Record<string, QuizAnswer> = {};
				for (const row of rows) {
					restored[row.questionId] = row;
				}
				this.answers = restored;
			} else {
				this.activeAttempt = null;
				this.answers = {};
			}
		} catch (err) {
			this.current = null;
			this.error = {
				title: 'Could not load quiz',
				message: err instanceof Error ? err.message : String(err)
			};
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Generate a mixed quiz from `chatId`'s context and persist it. Returns the
	 * new quiz id (caller navigates to `/quiz/<id>`), or null if it failed
	 * without producing a quiz (in which case `error` is set).
	 *
	 * On `QuizGenerationError`, sets a typed `error`. On other errors, sets
	 * `error` via `formatProviderError`. Aborts are swallowed silently (matching
	 * `labsStore.generate`).
	 */
	async generate(chatId: string): Promise<string | null> {
		if (this.generating) return null;
		this.generating = true;
		this.error = null;
		this.controller = new AbortController();

		try {
			const [ctx, { model, config }] = await Promise.all([
				assembleContext(chatId),
				getActiveSdkProvider()
			]);
			const generated = await generateQuiz(model, ctx, { signal: this.controller!.signal });
			const items = toQuizQuestions(generated);
			const quiz = await repos.quizzes.create({ chatId, model: config.defaultModel });
			for (const it of items) {
				await repos.quizQuestions.add({
					quizId: quiz.id,
					type: it.type,
					prompt: it.prompt,
					payload: it.payload
				});
			}
			this.list = [quiz, ...this.list];
			return quiz.id;
		} catch (err) {
			if (isAbortError(err)) return null;
			if (err instanceof QuizGenerationError) {
				this.error = { title: 'Quiz generation failed', message: err.message };
				return null;
			}
			this.error = formatProviderError(err);
			return null;
		} finally {
			this.generating = false;
			this.controller = null;
		}
	}

	/** Start a fresh attempt for the current quiz, resetting the answer map. */
	async startAttempt(): Promise<void> {
		if (!this.current) return;
		const attempt = await repos.quizAttempts.start(this.current.id);
		this.activeAttempt = attempt;
		this.answers = {};
		this.gradingQuestionId = null;
		this.reviewing = false;
		this.history = [attempt, ...this.history];
	}

	/** Load a past attempt (read-only review). Replaces the answer map with the
	 *  attempt's stored answers and flips `reviewing` on so question components
	 *  render locked. Starting/retaking a new attempt clears this. */
	async reviewAttempt(id: string): Promise<void> {
		if (!this.current) return;
		const attempt = await repos.quizAttempts.getById(id);
		if (!attempt) return;
		this.activeAttempt = attempt;
		const rows = await repos.quizAnswers.listByAttempt(id);
		const map: Record<string, QuizAnswer> = {};
		for (const r of rows) map[r.questionId] = r;
		this.answers = map;
		this.reviewing = true;
	}

	/** Auto-score an MCQ pick against its `answerIndex` and persist it. */
	async answerMcq(questionId: string, selectedIndex: number): Promise<void> {
		if (!this.activeAttempt) return;
		const question = this.questions.find((q) => q.id === questionId);
		if (!question) return;
		const payload = repos.quizQuestions.parsePayload<McqPayload>(question.payload);
		const correct = selectedIndex === payload.answerIndex;
		await this.persistAnswer(questionId, String(selectedIndex), {
			isCorrect: correct,
			aiFeedback: null
		});
		await this.finishIfComplete();
	}

	/** Self-mark a flashcard and persist it. */
	async answerFlashcard(questionId: string, gotIt: boolean): Promise<void> {
		if (!this.activeAttempt) return;
		const question = this.questions.find((q) => q.id === questionId);
		if (!question) return;
		await this.persistAnswer(questionId, gotIt ? 'got' : 'missed', {
			isCorrect: gotIt,
			aiFeedback: null
		});
		await this.finishIfComplete();
	}

	/**
	 * Record a short answer (pending) and AI-grade it via
	 * `provider.gradeShortAnswer`. On grading failure the answer is left
	 * ungraded (isCorrect null) with a message in `aiFeedback`; the per-question
	 * Re-grade affordance (`regrade`) is the recovery path.
	 */
	async answerShort(questionId: string, answerText: string): Promise<void> {
		if (!this.activeAttempt || !this.current) return;
		if (answerText.trim().length === 0) return;
		this.gradingQuestionId = questionId;
		try {
			const row = await repos.quizAnswers.record({
				attemptId: this.activeAttempt!.id,
				questionId,
				answer: answerText
			});
			this.answers = { ...this.answers, [questionId]: row };
			await this.runShortGrading(questionId, answerText, row.id);
		} finally {
			if (this.gradingQuestionId === questionId) this.gradingQuestionId = null;
		}
	}

	/** Re-grade an existing (failed) short answer using its stored text. */
	async regrade(questionId: string): Promise<void> {
		if (!this.activeAttempt) return;
		const existing = this.answers[questionId];
		if (!existing || existing.answer === '') return;
		this.gradingQuestionId = questionId;
		try {
			await this.runShortGrading(questionId, existing.answer, existing.id);
		} finally {
			if (this.gradingQuestionId === questionId) this.gradingQuestionId = null;
		}
	}

	/** Refresh the attempt history for the current quiz (newest first). */
	async loadHistory(): Promise<void> {
		if (!this.current) return;
		this.history = await repos.quizAttempts.listByQuiz(this.current.id);
	}

	/** Stop an in-flight generation (AbortError is swallowed in `generate`). */
	stop(): void {
		this.controller?.abort();
	}

	/** Start a fresh attempt (clears answers) — the "retake" action. */
	async retake(): Promise<void> {
		await this.startAttempt();
	}

	/** Record + auto-score an answer (MCQ / flashcard) in one step. */
	private async persistAnswer(
		questionId: string,
		answer: string,
		grade: { isCorrect: boolean; aiFeedback: string | null }
	): Promise<void> {
		if (!this.activeAttempt) return;
		const row = await repos.quizAnswers.record({
			attemptId: this.activeAttempt!.id,
			questionId,
			answer
		});
		await repos.quizAnswers.grade(row.id, {
			isCorrect: grade.isCorrect,
			aiFeedback: grade.aiFeedback
		});
		this.answers = {
			...this.answers,
			[questionId]: {
				...row,
				isCorrect: grade.isCorrect ? 1 : 0,
				aiFeedback: grade.aiFeedback,
				gradedAt: Date.now()
			}
		};
	}

	/**
	 * AI-grade a short answer. Stale-guarded: if the active attempt changed
	 * during the (async) grade round-trip, the result is dropped. On failure the
	 * answer is left ungraded with a `Grading failed:` message in `aiFeedback`
	 * (no global `error` is set — the Re-grade affordance is per-question).
	 */
	private async runShortGrading(
		questionId: string,
		answerText: string,
		answerRowId: string
	): Promise<void> {
		if (!this.current || !this.activeAttempt) return;
		const attemptId = this.activeAttempt.id;
		try {
			const ctx = await assembleContext(this.current!.chatId);
			const { model } = await getActiveSdkProvider();
			const question = this.questions.find((q) => q.id === questionId);
			if (!question) return;
			const payload = repos.quizQuestions.parsePayload<ShortPayload>(question.payload);
			const graded = await gradeShortAnswer(model, {
				prompt: question.prompt,
				rubric: payload.rubric,
				answer: answerText,
				context: ctx
			});
			if (this.activeAttempt?.id !== attemptId) return;
			await repos.quizAnswers.grade(answerRowId, {
				isCorrect: graded.isCorrect,
				aiFeedback: graded.feedback
			});
			this.answers = {
				...this.answers,
				[questionId]: {
					...this.answers[questionId],
					isCorrect: graded.isCorrect ? 1 : 0,
					aiFeedback: graded.feedback,
					gradedAt: Date.now()
				}
			};
			await this.finishIfComplete();
		} catch (err) {
			if (isAbortError(err)) return;
			const msg = 'Grading failed: ' + (err instanceof Error ? err.message : String(err));
			await repos.quizAnswers.grade(answerRowId, { isCorrect: null, aiFeedback: msg });
			this.answers = {
				...this.answers,
				[questionId]: {
					...this.answers[questionId],
					isCorrect: null,
					aiFeedback: msg,
					gradedAt: Date.now()
				}
			};
		}
	}

	/**
	 * Auto-finalise the active attempt once every question has a recorded answer
	 * row. A `null` grade (pending/failed short answer) does not count toward the
	 * score, but its row still counts toward "all answered".
	 */
	private async finishIfComplete(): Promise<void> {
		if (!this.activeAttempt) return;
		if (this.activeAttempt.finishedAt != null) return;
		if (this.questions.length === 0) return;
		if (Object.keys(this.answers).length !== this.questions.length) return;
		const correctCount = Object.values(this.answers).filter((a) => a.isCorrect === 1).length;
		await repos.quizAttempts.finish(this.activeAttempt.id, correctCount);
		const finishedAt = Date.now();
		this.activeAttempt = { ...this.activeAttempt, finishedAt, score: correctCount };
		this.history = this.history.map((a) =>
			a.id === this.activeAttempt!.id ? { ...a, finishedAt, score: correctCount } : a
		);
	}
}

/** Singleton — the single quizzes view across the app. */
export const quizzesStore = new QuizzesState();

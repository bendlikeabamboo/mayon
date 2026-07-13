import { asc, desc, eq } from 'drizzle-orm';
import { quizAnswers, quizAttempts, type QuizAnswer, type QuizAttempt } from '$lib/db/schema';
import { awaitDb } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';

export const quizAttemptsRepo = {
	/** Start a new attempt (ungraded until `finish`). */
	async start(quizId: string): Promise<QuizAttempt> {
		const [row] = await (await awaitDb())
			.insert(quizAttempts)
			.values({ id: uuid(), quizId, score: null, startedAt: now(), finishedAt: null })
			.returning();
		return row!;
	},

	/** Finalize an attempt with an aggregate score. */
	async finish(id: string, score: number): Promise<void> {
		await (await awaitDb())
			.update(quizAttempts)
			.set({ score, finishedAt: now() })
			.where(eq(quizAttempts.id, id));
	},

	async getById(id: string): Promise<QuizAttempt | null> {
		const rows = await (await awaitDb())
			.select()
			.from(quizAttempts)
			.where(eq(quizAttempts.id, id));
		return rows[0] ?? null;
	},

	/** All attempts for a quiz, newest first (for the attempt-history view). */
	async listByQuiz(quizId: string): Promise<QuizAttempt[]> {
		return (await awaitDb())
			.select()
			.from(quizAttempts)
			.where(eq(quizAttempts.quizId, quizId))
			.orderBy(desc(quizAttempts.startedAt));
	}
};

export const quizAnswersRepo = {
	async record(opts: {
		attemptId: string;
		questionId: string;
		answer: string;
	}): Promise<QuizAnswer> {
		const [row] = await (
			await awaitDb()
		)
			.insert(quizAnswers)
			.values({
				id: uuid(),
				attemptId: opts.attemptId,
				questionId: opts.questionId,
				answer: opts.answer,
				isCorrect: null,
				aiFeedback: null,
				gradedAt: null
			})
			.returning();
		return row!;
	},

	/** Auto-score (MCQ/flashcard) or store AI feedback (short answer). */
	async grade(
		id: string,
		opts: { isCorrect?: boolean | null; aiFeedback?: string | null }
	): Promise<void> {
		await (
			await awaitDb()
		)
			.update(quizAnswers)
			.set({
				isCorrect: opts.isCorrect == null ? null : opts.isCorrect,
				aiFeedback: opts.aiFeedback ?? null,
				gradedAt: now()
			})
			.where(eq(quizAnswers.id, id));
	},

	async listByAttempt(attemptId: string): Promise<QuizAnswer[]> {
		return (await awaitDb())
			.select()
			.from(quizAnswers)
			.where(eq(quizAnswers.attemptId, attemptId))
			.orderBy(asc(quizAnswers.id));
	}
};

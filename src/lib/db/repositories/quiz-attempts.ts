import { asc, eq } from 'drizzle-orm';
import { quizAnswers, quizAttempts, type QuizAnswer, type QuizAttempt } from '$lib/db/schema';
import { getDb } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';

export const quizAttemptsRepo = {
	/** Start a new attempt (ungraded until `finish`). */
	async start(quizId: string): Promise<QuizAttempt> {
		const [row] = await getDb()
			.insert(quizAttempts)
			.values({ id: uuid(), quizId, score: null, startedAt: now(), finishedAt: null })
			.returning();
		return row!;
	},

	/** Finalize an attempt with an aggregate score. */
	async finish(id: string, score: number): Promise<void> {
		await getDb()
			.update(quizAttempts)
			.set({ score, finishedAt: now() })
			.where(eq(quizAttempts.id, id))
			.run();
	},

	async getById(id: string): Promise<QuizAttempt | null> {
		const rows = await getDb().select().from(quizAttempts).where(eq(quizAttempts.id, id)).all();
		return rows[0] ?? null;
	},

	async listByQuiz(quizId: string): Promise<QuizAttempt[]> {
		return getDb().select().from(quizAttempts).where(eq(quizAttempts.quizId, quizId)).all();
	}
};

export const quizAnswersRepo = {
	async record(opts: {
		attemptId: string;
		questionId: string;
		answer: string;
	}): Promise<QuizAnswer> {
		const [row] = await getDb()
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
		await getDb()
			.update(quizAnswers)
			.set({
				isCorrect: opts.isCorrect == null ? null : opts.isCorrect ? 1 : 0,
				aiFeedback: opts.aiFeedback ?? null,
				gradedAt: now()
			})
			.where(eq(quizAnswers.id, id))
			.run();
	},

	async listByAttempt(attemptId: string): Promise<QuizAnswer[]> {
		return getDb()
			.select()
			.from(quizAnswers)
			.where(eq(quizAnswers.attemptId, attemptId))
			.orderBy(asc(quizAnswers.id))
			.all();
	}
};

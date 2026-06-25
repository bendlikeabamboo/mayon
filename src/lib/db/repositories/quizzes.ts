import { asc, desc, eq } from 'drizzle-orm';
import {
	quizQuestions,
	quizzes,
	type Quiz,
	type QuizQuestion,
	type QuizQuestionType
} from '$lib/db/schema';
import { getDb } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';

export interface McqPayload {
	options: string[];
	answerIndex: number;
}
export interface FlashcardPayload {
	front: string;
	back: string;
}
export interface ShortPayload {
	rubric: string;
}
export type QuizPayload = McqPayload | FlashcardPayload | ShortPayload;

export const quizzesRepo = {
	async create(opts: { chatId: string; model?: string }): Promise<Quiz> {
		const [row] = await getDb()
			.insert(quizzes)
			.values({ id: uuid(), chatId: opts.chatId, model: opts.model ?? null, createdAt: now() })
			.returning();
		return row!;
	},

	async getById(id: string): Promise<Quiz | null> {
		const rows = await getDb().select().from(quizzes).where(eq(quizzes.id, id)).all();
		return rows[0] ?? null;
	},

	async listByChat(chatId: string): Promise<Quiz[]> {
		return getDb().select().from(quizzes).where(eq(quizzes.chatId, chatId)).all();
	},

	/** All quizzes, newest first (the `/quiz` index page groups by chat client-side). */
	async listAll(): Promise<Quiz[]> {
		return getDb().select().from(quizzes).orderBy(desc(quizzes.createdAt)).all();
	},

	async delete(id: string): Promise<void> {
		await getDb().delete(quizzes).where(eq(quizzes.id, id)).run();
	}
};

export const quizQuestionsRepo = {
	/** Append a question; `ord` is computed from the current count. */
	async add(opts: {
		quizId: string;
		type: QuizQuestionType;
		prompt: string;
		payload: QuizPayload;
	}): Promise<QuizQuestion> {
		const existing = await this.listByQuiz(opts.quizId);
		const ord = existing.length ? Math.max(...existing.map((q) => q.ord)) + 1 : 0;
		const [row] = await getDb()
			.insert(quizQuestions)
			.values({
				id: uuid(),
				quizId: opts.quizId,
				ord,
				type: opts.type,
				prompt: opts.prompt,
				payload: JSON.stringify(opts.payload)
			})
			.returning();
		return row!;
	},

	async listByQuiz(quizId: string): Promise<QuizQuestion[]> {
		return getDb()
			.select()
			.from(quizQuestions)
			.where(eq(quizQuestions.quizId, quizId))
			.orderBy(asc(quizQuestions.ord))
			.all();
	},

	parsePayload<T = QuizPayload>(raw: string): T {
		try {
			return JSON.parse(raw) as T;
		} catch {
			return {} as T;
		}
	}
};

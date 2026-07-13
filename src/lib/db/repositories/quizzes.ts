import { asc, desc, eq } from 'drizzle-orm';
import {
	quizQuestions,
	quizzes,
	type Quiz,
	type QuizQuestion,
	type QuizQuestionType
} from '$lib/db/schema';
import { awaitDb } from '$lib/db/driver/client';
import { now, uuid } from '$lib/db/ids';
import { agentTracesRepo } from './agent-traces';

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
		const [row] = await (
			await awaitDb()
		)
			.insert(quizzes)
			.values({ id: uuid(), chatId: opts.chatId, model: opts.model ?? null, createdAt: now() })
			.returning();
		return row!;
	},

	async getById(id: string): Promise<Quiz | null> {
		const rows = await (await awaitDb()).select().from(quizzes).where(eq(quizzes.id, id));
		return rows[0] ?? null;
	},

	async listByChat(chatId: string): Promise<Quiz[]> {
		return (await awaitDb()).select().from(quizzes).where(eq(quizzes.chatId, chatId));
	},

	/** All quizzes, newest first (the `/quiz` index page groups by chat client-side). */
	async listAll(): Promise<Quiz[]> {
		return (await awaitDb()).select().from(quizzes).orderBy(desc(quizzes.createdAt));
	},

	async delete(id: string): Promise<void> {
		try {
			await agentTracesRepo.deleteByQuiz(id);
		} catch {
			/* best-effort cascade */
		}
		await (await awaitDb()).delete(quizzes).where(eq(quizzes.id, id));
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
		const [row] = await (
			await awaitDb()
		)
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
		return (await awaitDb())
			.select()
			.from(quizQuestions)
			.where(eq(quizQuestions.quizId, quizId))
			.orderBy(asc(quizQuestions.ord));
	},

	parsePayload<T = QuizPayload>(raw: string): T {
		try {
			return JSON.parse(raw) as T;
		} catch {
			return {} as T;
		}
	}
};

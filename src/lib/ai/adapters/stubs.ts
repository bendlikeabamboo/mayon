/**
 * Placeholder implementations for the generation helpers declared on `Provider`.
 * Quizzes/grading land in P4 — declaring them now locks the interface shape so
 * adapters won't be reopened later. Each throws a tagged error so a premature
 * call fails loudly with the phase it belongs to.
 *
 * (P3 lab generation is no longer stubbed here — adapters delegate to the
 * shared orchestrator in `generate/generate.ts`.)
 */
import type { ChatMessage, ChatStreamOptions } from '../types';

/** P3 quiz-from-chat helper (still stubbed until P4). */
export function quizStub(_messages: ChatMessage[], _opts?: ChatStreamOptions): Promise<never> {
	return Promise.reject(new Error('Quiz generation is P4 (not implemented in P3).'));
}

/** P4 grading. */
export function gradeAnswerP4(_questionId: string, _answer: string): Promise<never> {
	return Promise.reject(new Error('AI grading is P4 (not implemented in P3).'));
}

/** Short alias kept for readable adapter bodies: `generateQuiz: p3`. */
export const p3 = quizStub;
/** Short alias for the P4 grade stub: `gradeAnswer: p4`. */
export const p4 = gradeAnswerP4;

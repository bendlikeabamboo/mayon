/**
 * Placeholder implementations for the generation helpers declared on `Provider`.
 * Labs land in P3, quizzes/grading in P4 — declaring them now locks the
 * interface shape so adapters won't be reopened later. Each throws a tagged
 * error so a premature call fails loudly with the phase it belongs to.
 */
import type { ChatMessage, ChatStreamOptions } from '../types';

/** P3 generation helpers (lab + quiz from a chat). */
export function p3(_messages: ChatMessage[], _opts?: ChatStreamOptions): Promise<never> {
	return Promise.reject(new Error('Generation helpers are P3 (not implemented in P1).'));
}

/** P4 grading. */
export function gradeAnswerP4(_questionId: string, _answer: string): Promise<never> {
	return Promise.reject(new Error('AI grading is P4 (not implemented in P1).'));
}

/** Alias kept short for readable adapter bodies: `generateLab: p3`. */
export const p4 = gradeAnswerP4;

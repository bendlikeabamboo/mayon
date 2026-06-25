import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * Mayon data model — single source of truth, mirrored 1:1 in both runtimes
 * (browser SQLite-WASM and desktop native SQLite). Spec: `refinement/architecture.md` §5.1.
 *
 * Encoding conventions (P0):
 * - IDs are text UUIDs (`crypto.randomUUID()`).
 * - Timestamps are epoch-milliseconds (`integer`), set by the app layer.
 * - JSON columns (`checklist`, `payload`, `value`) are stored as `text`; the app
 *   serializes/parses. Drizzle stays schema-agnostic of their inner shape.
 * - Enums (`role`, `quiz_questions.type`) are `text` constrained to a string union.
 * - Foreign keys are real (enforced by SQLite `PRAGMA foreign_keys = ON`).
 */

// ───────────────────────────── chats ─────────────────────────────
// A node in the conversation tree.
export const chats = sqliteTable('chats', {
	id: text('id').primaryKey(),
	parentId: text('parent_id').references((): AnySQLiteColumn => chats.id),
	rootId: text('root_id')
		.notNull()
		.references((): AnySQLiteColumn => chats.id),
	branchPointMessageId: text('branch_point_message_id').references(
		(): AnySQLiteColumn => messages.id
	),
	title: text('title').notNull(),
	depth: integer('depth').notNull(),
	provider: text('provider'),
	model: text('model'),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

// ─────────────────────────── messages ────────────────────────────
// Content of a single chat.
export const messages = sqliteTable('messages', {
	id: text('id').primaryKey(),
	chatId: text('chat_id')
		.notNull()
		.references(() => chats.id),
	role: text('role', { enum: ['system', 'user', 'assistant'] }).notNull(),
	content: text('content').notNull(),
	ord: integer('ord').notNull(),
	model: text('model'),
	tokens: integer('tokens'),
	createdAt: integer('created_at').notNull()
});

// ──────────────────────── branch_sources ─────────────────────────
// The exact span a branch originated from (traceability).
export const branchSources = sqliteTable('branch_sources', {
	id: text('id').primaryKey(),
	sourceMessageId: text('source_message_id')
		.notNull()
		.references(() => messages.id),
	startChar: integer('start_char').notNull(),
	endChar: integer('end_char').notNull(),
	excerpt: text('excerpt').notNull(),
	branchChatId: text('branch_chat_id')
		.notNull()
		.references(() => chats.id),
	createdAt: integer('created_at').notNull()
});

// ────────────────────────── cross_links ──────────────────────────
// References between otherwise separate chats.
export const crossLinks = sqliteTable('cross_links', {
	id: text('id').primaryKey(),
	fromChatId: text('from_chat_id')
		.notNull()
		.references(() => chats.id),
	toChatId: text('to_chat_id')
		.notNull()
		.references(() => chats.id),
	note: text('note'),
	createdAt: integer('created_at').notNull()
});

// ───────────────────────────── labs ──────────────────────────────
// Leaf artifact on a chat (does not branch).
export const labs = sqliteTable('labs', {
	id: text('id').primaryKey(),
	chatId: text('chat_id')
		.notNull()
		.references(() => chats.id),
	title: text('title').notNull(),
	content: text('content').notNull(),
	// JSON: [{ id, text, done }]
	checklist: text('checklist')
		.notNull()
		.default(sql`'[]'`),
	model: text('model'),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

// ─────────────────────────── quizzes ─────────────────────────────
export const quizzes = sqliteTable('quizzes', {
	id: text('id').primaryKey(),
	chatId: text('chat_id')
		.notNull()
		.references(() => chats.id),
	model: text('model'),
	createdAt: integer('created_at').notNull()
});

// ──────────────────────── quiz_questions ─────────────────────────
export const quizQuestions = sqliteTable('quiz_questions', {
	id: text('id').primaryKey(),
	quizId: text('quiz_id')
		.notNull()
		.references(() => quizzes.id),
	ord: integer('ord').notNull(),
	type: text('type', { enum: ['mcq', 'flashcard', 'short'] }).notNull(),
	prompt: text('prompt').notNull(),
	// JSON, type-specific: mcq {options[], answerIndex}; flashcard {front, back}; short {rubric}
	payload: text('payload').notNull()
});

// ──────────────────────── quiz_attempts ──────────────────────────
export const quizAttempts = sqliteTable('quiz_attempts', {
	id: text('id').primaryKey(),
	quizId: text('quiz_id')
		.notNull()
		.references(() => quizzes.id),
	score: integer('score'),
	startedAt: integer('started_at').notNull(),
	finishedAt: integer('finished_at')
});

// ───────────────────────── quiz_answers ──────────────────────────
export const quizAnswers = sqliteTable('quiz_answers', {
	id: text('id').primaryKey(),
	attemptId: text('attempt_id')
		.notNull()
		.references(() => quizAttempts.id),
	questionId: text('question_id')
		.notNull()
		.references(() => quizQuestions.id),
	answer: text('answer').notNull(),
	isCorrect: integer('is_correct'),
	aiFeedback: text('ai_feedback'),
	gradedAt: integer('graded_at')
});

// ─────────────────────────── settings ────────────────────────────
// Key/value store; values are JSON strings. NO secrets (keys are P1).
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

// ──────────────────────── inferred types ─────────────────────────
export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageRole = Message['role'];

export type BranchSource = typeof branchSources.$inferSelect;
export type NewBranchSource = typeof branchSources.$inferInsert;
export type CrossLink = typeof crossLinks.$inferSelect;
export type NewCrossLink = typeof crossLinks.$inferInsert;

export type Lab = typeof labs.$inferSelect;
export type NewLab = typeof labs.$inferInsert;
export type Quiz = typeof quizzes.$inferSelect;
export type NewQuiz = typeof quizzes.$inferInsert;
export type QuizQuestion = typeof quizQuestions.$inferSelect;
export type NewQuizQuestion = typeof quizQuestions.$inferInsert;
export type QuizQuestionType = QuizQuestion['type'];
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type NewQuizAttempt = typeof quizAttempts.$inferInsert;
export type QuizAnswer = typeof quizAnswers.$inferSelect;
export type NewQuizAnswer = typeof quizAnswers.$inferInsert;

export type Setting = typeof settings.$inferSelect;

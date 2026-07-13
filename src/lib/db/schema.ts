import { sql } from 'drizzle-orm';
import { bigint, integer, pgTable, text, boolean, type AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Mayon data model — single source of truth.
 * Server-owned Postgres database. Spec: `refinement/architecture.md` §5.1.
 *
 * Encoding conventions (P0):
 * - IDs are text UUIDs (`crypto.randomUUID()`).
 * - Timestamps are epoch-milliseconds (`bigint` with `mode: 'number'`, since PG
 *   `integer` is 32-bit and cannot hold epoch-ms which exceed 2.1B). Set by the
 *   app layer.
 * - JSON columns (`checklist`, `payload`, `value`) are stored as `text`; the app
 *   serializes/parses. Drizzle stays schema-agnostic of their inner shape.
 * - Enums (`role`, `quiz_questions.type`) are `text` constrained to a string union.
 * - Foreign keys are real (enforced by Postgres).
 */

// ───────────────────────────── chats ─────────────────────────────
// A node in the conversation tree.
export const chats = pgTable('chats', {
	id: text('id').primaryKey(),
	parentId: text('parent_id').references((): AnyPgColumn => chats.id),
	rootId: text('root_id')
		.notNull()
		.references((): AnyPgColumn => chats.id),
	branchPointMessageId: text('branch_point_message_id').references((): AnyPgColumn => messages.id),
	title: text('title').notNull(),
	depth: integer('depth').notNull(),
	provider: text('provider'),
	model: text('model'),
	/**
	 * Learning Brief authored on the ROOT chat only, stored as a JSON string
	 * (parsed via the total `parseBrief` in `src/lib/chat/brief.ts`). Branches
	 * inherit it via the root→target walk in `assembleContext`, so their own
	 * `brief` column stays `null`. Nullable + additive: old rows get `null` and
	 * behave exactly as before (no system note).
	 */
	brief: text('brief'),
	/**
	 * Per-chat MCP server enablement, stored as a JSON string
	 * (`ChatMcpConfig` in `src/lib/mcp/types.ts`). `NULL` = "inherit all
	 * globally-enabled servers"; an explicit `{}` disables all MCP tools for the
	 * chat. Nullable + additive: old rows get `NULL` and behave exactly as before.
	 */
	mcpConfig: text('mcp_config'),
	createdAt: bigint('created_at', { mode: 'number' }).notNull(),
	updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
});

// ─────────────────────────── messages ────────────────────────────
// Content of a single chat.
export const messages = pgTable('messages', {
	id: text('id').primaryKey(),
	chatId: text('chat_id')
		.notNull()
		.references(() => chats.id),
	role: text('role', { enum: ['system', 'user', 'assistant', 'tool'] }).notNull(),
	content: text('content').notNull(),
	ord: integer('ord').notNull(),
	model: text('model'),
	tokens: integer('tokens'),
	toolCallId: text('tool_call_id'),
	toolName: text('tool_name'),
	metadata: text('metadata'),
	createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

// ──────────────────────── branch_sources ─────────────────────────
// The exact span a branch originated from (traceability).
export const branchSources = pgTable('branch_sources', {
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
	customInstructions: text('custom_instructions'),
	addFormats: text('add_formats'),
	createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

// ────────────────────────── cross_links ──────────────────────────
// References between otherwise separate chats.
export const crossLinks = pgTable('cross_links', {
	id: text('id').primaryKey(),
	fromChatId: text('from_chat_id')
		.notNull()
		.references(() => chats.id),
	toChatId: text('to_chat_id')
		.notNull()
		.references(() => chats.id),
	note: text('note'),
	createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

// ───────────────────────────── labs ──────────────────────────────
// Leaf artifact on a chat (does not branch).
export const labs = pgTable('labs', {
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
	createdAt: bigint('created_at', { mode: 'number' }).notNull(),
	updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
});

// ─────────────────────────── quizzes ─────────────────────────────
export const quizzes = pgTable('quizzes', {
	id: text('id').primaryKey(),
	chatId: text('chat_id')
		.notNull()
		.references(() => chats.id),
	model: text('model'),
	createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

// ──────────────────────── quiz_questions ─────────────────────────
export const quizQuestions = pgTable('quiz_questions', {
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
export const quizAttempts = pgTable('quiz_attempts', {
	id: text('id').primaryKey(),
	quizId: text('quiz_id')
		.notNull()
		.references(() => quizzes.id),
	score: integer('score'),
	startedAt: bigint('started_at', { mode: 'number' }).notNull(),
	finishedAt: bigint('finished_at', { mode: 'number' })
});

// ───────────────────────── quiz_answers ──────────────────────────
export const quizAnswers = pgTable('quiz_answers', {
	id: text('id').primaryKey(),
	attemptId: text('attempt_id')
		.notNull()
		.references(() => quizAttempts.id),
	questionId: text('question_id')
		.notNull()
		.references(() => quizQuestions.id),
	answer: text('answer').notNull(),
	isCorrect: boolean('is_correct'),
	aiFeedback: text('ai_feedback'),
	gradedAt: bigint('graded_at', { mode: 'number' })
});

// ─────────────────────── agent_traces ─────────────────────────────
// Per-turn diagnostics emitted by the agent runtime.
export const agentTraces = pgTable('agent_traces', {
	id: text('id').primaryKey(),
	chatId: text('chat_id')
		.notNull()
		.references(() => chats.id),
	assistantMessageId: text('assistant_message_id').references(() => messages.id),
	model: text('model'),
	configKind: text('config_kind').notNull(),
	reasoning: text('reasoning').notNull(),
	kind: text('kind').notNull().default('chat'),
	labId: text('lab_id').references(() => labs.id, { onDelete: 'no action' }),
	quizId: text('quiz_id').references(() => quizzes.id, { onDelete: 'no action' }),
	createdAt: bigint('created_at', { mode: 'number' }).notNull(),
	durationMs: integer('duration_ms'),
	trace: text('trace').notNull()
});

// ─────────────────────────── settings ────────────────────────────
// Key/value store; values are JSON strings. NO secrets (keys are P1).
export const settings = pgTable('settings', {
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

export type AgentTrace = typeof agentTraces.$inferSelect;
export type NewAgentTrace = typeof agentTraces.$inferInsert;

export type Setting = typeof settings.$inferSelect;

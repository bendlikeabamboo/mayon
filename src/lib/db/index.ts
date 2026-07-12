// Public boundary for the data layer. Components/stores import from here ONLY:
//   import { repos, getDb } from '$lib/db';
// The drizzle `db` object stays private to this directory.
export { bootstrapDb, getDb, getDriver, rebootstrapWith } from './driver/client';
export type { StorageDriver } from './driver/types';

import { settingsRepo } from './repositories/settings';
import { chatsRepo } from './repositories/chats';
import { messagesRepo } from './repositories/messages';
import { branchSourcesRepo } from './repositories/branch-sources';
import { crossLinksRepo } from './repositories/cross-links';
import { labsRepo } from './repositories/labs';
import { quizzesRepo, quizQuestionsRepo } from './repositories/quizzes';
import { quizAttemptsRepo, quizAnswersRepo } from './repositories/quiz-attempts';
import { agentTracesRepo } from './repositories/agent-traces';
import { searchRepo } from './repositories/search';
import { mcpRepo } from './repositories/mcp';

/** Typed repository namespace — the only sanctioned way to touch the database. */
export const repos = {
	settings: settingsRepo,
	chats: chatsRepo,
	messages: messagesRepo,
	branchSources: branchSourcesRepo,
	crossLinks: crossLinksRepo,
	labs: labsRepo,
	quizzes: quizzesRepo,
	quizQuestions: quizQuestionsRepo,
	quizAttempts: quizAttemptsRepo,
	quizAnswers: quizAnswersRepo,
	agentTraces: agentTracesRepo,
	search: searchRepo,
	mcp: mcpRepo
};

export type { LabChecklistItem } from './repositories/labs';
export type {
	McqPayload,
	FlashcardPayload,
	ShortPayload,
	QuizPayload
} from './repositories/quizzes';
export type { SearchHit, SearchKind } from './repositories/search';
export { stripIndexNoise, buildMatchQuery, renderSnippet, deepLink } from './repositories/search';

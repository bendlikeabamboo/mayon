import { LAB_FIXTURE } from '../../fixtures/mock-llm/lab-fixture.mjs';
import { QUIZ_FIXTURE } from '../../fixtures/mock-llm/quiz-fixture.mjs';

export const MOCK_BASE_URL = 'http://mock-llm:9999/v1';
export const MODEL_ID = 'mock-sink';
export const PLACEHOLDER_KEY = 'e2e-placeholder-key';

export const EARLY_MARKER = 'The Mayon kitchen-sink fixture opens with this paragraph';
export const LATE_MARKER = 'Deterministic offsets make expound branches reproducible';
export const HEADING_PROBE = 'The Kitchen-Sink Fixture';
export const PROSE_PROBE = 'Automated assertions read this text verbatim';
export const ALIGNED_SENTENCE =
	'Alignment depends on stable plain sentences that render exactly as they are written.';
export const ALIGNED_PARAGRAPH =
	'Selection mapping needs prose that renders exactly as it is written. Alignment depends on stable plain sentences that render exactly as they are written. Every word here sits in one plain text node, with single spaces and no inline decoration.';

// Request-kind classification markers live in
// tests/fixtures/mock-llm/markers.mjs (single source of truth, imported by
// server.mjs and pinned to the product constants by the drift-guard unit test
// src/lib/ai/generate/classification-markers.test.ts). They were previously
// mirrored here; that copy drifted-by-hand risk was removed in review. See
// docs/history/appendices/020-mock-llm-protocol.md for the
// classification protocol.

// Grading lever triggers the mock scans for in the short_grading user block
// (case-insensitive; neither present grades false by default).
export const LEVER_TRIGGER_CORRECT = 'should be correct';
export const LEVER_TRIGGER_WRONG = 'should be wrong';

// Expected fixture payloads for assertions. The fixture files are the source
// of truth; these are derived from them so assertions can never drift from
// what the mock actually serves.
type QuizFixtureQuestion = (typeof QUIZ_FIXTURE)['questions'][number];

const quizMcq = QUIZ_FIXTURE.questions.find(
	(q): q is Extract<QuizFixtureQuestion, { payload: { options: string[]; answerIndex: number } }> =>
		'answerIndex' in q.payload
);
if (!quizMcq) {
	throw new Error('quiz fixture is missing its mcq question');
}
const quizFlashcard = QUIZ_FIXTURE.questions.find(
	(q): q is Extract<QuizFixtureQuestion, { payload: { front: string; back: string } }> =>
		'front' in q.payload
);
if (!quizFlashcard) {
	throw new Error('quiz fixture is missing its flashcard question');
}
const quizShort = QUIZ_FIXTURE.questions.find(
	(q): q is Extract<QuizFixtureQuestion, { payload: { rubric: string } }> => 'rubric' in q.payload
);
if (!quizShort) {
	throw new Error('quiz fixture is missing its short question');
}

export const QUIZ_MCQ_PROMPT = quizMcq.prompt;
export const QUIZ_MCQ_CORRECT_ANSWER = quizMcq.payload.options[quizMcq.payload.answerIndex];
export const QUIZ_FLASHCARD_FRONT = quizFlashcard.payload.front;
export const QUIZ_FLASHCARD_BACK = quizFlashcard.payload.back;
export const QUIZ_SHORT_PROMPT = quizShort.prompt;
export const QUIZ_SHORT_RUBRIC = quizShort.payload.rubric;

export const LAB_TITLE = LAB_FIXTURE.title;
export const LAB_STEPS = LAB_FIXTURE.steps;
export const LAB_CHECKLIST_TEXTS = LAB_FIXTURE.checklist.map((item) => item.text);

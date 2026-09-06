/**
 * Single source of truth for the mock LLM's request-kind classification
 * markers (feature 020 — specs/020-rc-ui-verification/contracts/mock-llm-protocol.md).
 *
 * server.mjs imports from here, and the drift-guard unit test
 * (src/lib/ai/generate/classification-markers.test.ts) asserts each product
 * constant still contains its marker — so a contract reword fails the unit
 * suite at the exact byte that changed instead of red-ing the e2e deck far
 * from the cause. Do not re-type these strings anywhere else.
 */

/** Distinctive substring of GRADE_TOOL_DESCRIPTION (src/lib/ai/generate/generate-quiz.ts). */
export const GRADING_MARKER = 'Emit the grading verdict for the learner';

/** Distinctive substring of the QUIZ_CONTRACT output-shape section (src/lib/ai/generate/generate-quiz.ts). */
export const QUIZ_CONTRACT_MARKER = '"type" is EXACTLY one of "mcq", "flashcard", "short"';

/** Distinctive substring of the LAB_CONTRACT output-shape section (src/lib/ai/generate/generate.ts). */
export const LAB_CONTRACT_MARKER = 'The output must be a JSON object with EXACTLY these four fields';

/** Opening line of DEFAULT_BRIEF_PROMPT (src/lib/ai/generate/generate-brief.ts). */
export const BRIEF_MARKER = 'You infer a concise learning brief from a conversation.';

/**
 * Byte-exact openings of the code-owned contracts. Quiz and lab generation
 * lead the system message with their contract (includeSystemNotes: false), so
 * the classifier anchors those kinds on startsWith — user custom instructions
 * are appended AFTER the contract and can never influence the match.
 */
export const QUIZ_CONTRACT_OPENING = 'You are a quiz designer.';
export const LAB_CONTRACT_OPENING = 'You are a learning lab designer.';

/**
 * Single source of truth for the mock LLM's fixture-only assertion strings —
 * triggers, replies, and payloads tests assert on that have NO product-constant
 * pin (the classification markers that DO mirror product constants live in
 * ./markers.mjs).
 *
 * server.mjs serves exactly these constants and defines no inline copies;
 * tests/e2e/fixtures/kitchen-sink.ts re-exports them for e2e specs; fast-tier
 * tests import from here dynamically via fileURLToPath (tests/fixtures is
 * tsconfig-excluded). Both moves are drift-guarded by
 * src/lib/ai/generate/classification-markers.test.ts — so are the byte
 * mirrors of these constants at use-site (PROPAGATE_* in
 * src/lib/stores/chat.svelte.test.ts, LEVER_* in
 * src/lib/stores/quizzes.svelte.test.ts, PROPAGATE_TOOL_NAME in
 * src/lib/agent/loop.test.ts): the MIRRORS registry in that file patrols
 * every mirror's source for the byte-exact constant values, and adding the
 * next mirror means adding one entry there. Contract:
 * specs/031-split-text-e2e-tests/contracts/shared-fixtures.md.
 * Do not re-type these strings anywhere else.
 */

/**
 * Grading lever (short_grading kind) — the mock scans the LAST user message
 * case-insensitively for these triggers. Precedence: the WRONG trigger is
 * tested first, so a false verdict is the fail-unsafe direction when both
 * appear (research.md D3: an unmarked or ambiguous answer can never fake a
 * green score).
 */
export const LEVER_TRIGGER_CORRECT = 'should be correct';
export const LEVER_TRIGGER_WRONG = 'should be wrong';
export const LEVER_FEEDBACK_CORRECT =
	'Deterministic mock verdict: the lever matched, so this answer is graded correct.';
export const LEVER_FEEDBACK_WRONG =
	'Deterministic mock verdict: the lever matched, so this answer is graded incorrect.';
export const LEVER_FEEDBACK_DEFAULT =
	'Deterministic mock default: the answer carried no lever trigger, so it is not correct.';

/**
 * Back-propagation dispatch (feature 027, quickstart V6) — the mock selects
 * between tool call and manual-control sentence by the trigger phrase in the
 * LAST user message and whether the branch-gated tool list contains
 * PROPAGATE_TOOL_NAME.
 */
export const PROPAGATE_TRIGGER = 'backpropagate this branch';
export const PROPAGATE_TOOL_NAME = 'propagate_to_parent';
export const PROPAGATE_TOOL_ARGS = '{"mode":"raw"}';
export const PROPAGATE_UNAVAILABLE_REPLY =
	'This conversation is a root chat, so it cannot back-propagate; use the manual back-propagate control in the message menu instead.';

/**
 * Offer-once dispatch (027 US2): a completion signal without an explicit
 * request gets one plain-text offer and never a tool call — propagation
 * requires the learner's agreement.
 */
export const OFFER_TRIGGER = 'this branch feels done';
export const OFFER_REPLY =
	'This branch looks wrapped up. I can send its outcome to the parent chat — the manual back-propagate control in the message menu does the same thing. Want me to back-propagate it?';

/**
 * Image-reply dispatch (feature 030, US1) — both dialect paths produce the
 * caption text plus one inline image: an 8x8 solid-color PNG, inlined base64
 * the way a provider embeds it.
 */
export const IMAGE_TRIGGER = 'generate an image';
export const IMAGE_REPLY_TEXT = 'Here is your chart.';
export const IMAGE_PNG_MIME = 'image/png';
export const IMAGE_PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';

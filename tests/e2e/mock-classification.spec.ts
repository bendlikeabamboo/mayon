import { expect, test } from './fixtures/onboard';
import {
	EARLY_MARKER,
	LAB_CHECKLIST_TEXTS,
	LAB_TITLE,
	LATE_MARKER,
	QUIZ_MCQ_CORRECT_ANSWER,
	QUIZ_MCQ_PROMPT
} from './fixtures/kitchen-sink';
import type { Page } from '@playwright/test';

// Unknown request kinds (contract rule 7, research.md D7) are answered with
// HTTP 400 { error: 'unrecognized request kind', hints: [...] } and can never
// ride the real browser path — the app never sends an unclassifiable request,
// so there is no UI route to that branch. It is covered by a manual probe
// from inside the server container (never via page.route, per the FR-005
// guardrail in tests/fixtures/mock-llm/README.md):
//
//   docker compose -p mayon-e2e exec -T server node -e \
//     'fetch("http://mock-llm:9999/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tools:[{function:{name:"json",description:"bogus"}}],messages:[]})}).then(async r=>console.log(r.status,await r.text()))'
//
// Expected: "400 {"error":"unrecognized request kind","hints":[true,"bogus",""]}".
// (busybox wget suppresses the error body, hence the node fetch.)

/**
 * Drive one real chat round trip and wait for the deterministic reply to
 * finish rendering. Generation buttons need a non-empty conversation: quiz and
 * lab generation derive their context from the chat transcript (the store
 * fails fast before any request when the chat has no turns), so every
 * generation journey starts here.
 */
async function chatRoundTrip(page: Page): Promise<void> {
	const composer = page.getByPlaceholder(/Message the active provider/);
	await composer.fill('Explain the kitchen sink');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.locator('#msg-live-text')).toContainText(EARLY_MARKER);
	await expect(page.locator('.markdown-body', { hasText: LATE_MARKER })).toBeVisible();
	await expect(page.locator('#msg-live-text')).toHaveCount(0);
}

test.describe('mock-llm request-kind classification', () => {
	test('chat round trip still streams the kitchen-sink reply', async ({ onboarded }) => {
		const { page } = onboarded;
		await chatRoundTrip(page);
	});

	test('quiz generation serves the quiz fixture and the grading lever flips both ways', async ({
		onboarded
	}) => {
		const { page } = onboarded;
		await chatRoundTrip(page);

		// quiz_generation through the real proxy path: navigating to
		// /quiz/[id] with the fixture's mcq prompt rendered proves the mock's
		// tool-call reply was parsed and its questions persisted.
		await page.locator('button[aria-label="Generate quiz"]').click();
		await expect(page).toHaveURL(/\/quiz\//, { timeout: 30_000 });
		// The runner shows an intro screen first; questions render after start.
		await page.getByRole('button', { name: 'Start quiz' }).click();
		await expect(page.getByText(QUIZ_MCQ_PROMPT)).toBeVisible();

		// Lever, correct branch: the short answer carries the trigger phrase
		// and must come back graded Correct.
		const shortAnswer = page.getByPlaceholder('Type your answer…');
		await shortAnswer.fill(
			'The chloroplast is where photosynthesis happens; this answer should be correct.'
		);
		await page.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(
			page.locator('div[class*="border-emerald-500/40"]', { hasText: 'Correct' })
		).toBeVisible({ timeout: 15_000 });

		// Complete the remaining questions so the attempt finalizes: MCQ by
		// the known-correct option text (positions are shuffled — research.md
		// D5), flashcard by self-marking.
		await page.getByLabel(QUIZ_MCQ_CORRECT_ANSWER).check();
		await page.getByRole('button', { name: 'Submit answer' }).click();
		await page.getByRole('button', { name: 'Reveal' }).click();
		await page.getByRole('button', { name: 'Got it' }).click();
		await page.getByRole('button', { name: 'Take me to the results' }).click();
		await page.getByRole('button', { name: 'Retake' }).click();

		// Lever, wrong branch on the fresh attempt: the answer now carries the
		// other trigger and must come back graded Incorrect.
		await shortAnswer.fill('Mitochondria; this answer should be wrong.');
		await page.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(
			page.locator('div[class*="border-red-500/40"]', { hasText: 'Incorrect' })
		).toBeVisible({ timeout: 15_000 });
	});

	test('lab generation serves the lab fixture', async ({ onboarded }) => {
		const { page } = onboarded;
		await chatRoundTrip(page);

		// lab_generation through the real proxy path: /lab/[id] renders the
		// fixture title (flattened into the markdown body) and the persisted
		// checklist.
		await page.locator('button[aria-label="Generate lab"]').click();
		await expect(page).toHaveURL(/\/lab\//, { timeout: 30_000 });
		await expect(page.getByRole('heading', { level: 1, name: LAB_TITLE })).toBeVisible();
		await expect(page.getByText(LAB_CHECKLIST_TEXTS[0])).toBeVisible();
	});
});

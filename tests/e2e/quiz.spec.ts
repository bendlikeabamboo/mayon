import { expect, test } from './fixtures/onboard';
import {
	EARLY_MARKER,
	LATE_MARKER,
	LEVER_TRIGGER_CORRECT,
	LEVER_TRIGGER_WRONG,
	QUIZ_FLASHCARD_BACK,
	QUIZ_FLASHCARD_FRONT,
	QUIZ_MCQ_CORRECT_ANSWER,
	QUIZ_MCQ_PROMPT,
	QUIZ_SHORT_PROMPT,
	QUIZ_SHORT_RUBRIC
} from './fixtures/kitchen-sink';
import type { Page } from '@playwright/test';

/**
 * Drive one real chat round trip and wait for the deterministic reply to
 * finish rendering. Generation buttons need a non-empty conversation: quiz
 * generation derives its context from the chat transcript (the store fails
 * fast before any request when the chat has no turns), so every generation
 * journey starts here. (Same pattern as mock-classification.spec.ts.)
 */
async function chatRoundTrip(page: Page): Promise<void> {
	const composer = page.getByPlaceholder(/Message the active provider/);
	await composer.fill('Explain the kitchen sink');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(page.locator('#msg-live-text')).toContainText(EARLY_MARKER);
	await expect(page.locator('.markdown-body', { hasText: LATE_MARKER })).toBeVisible();
	await expect(page.locator('#msg-live-text')).toHaveCount(0);
}

/**
 * Generate the quiz through the real proxy path and start an attempt. After
 * "Start quiz" all fixture questions render in one list in fixture order —
 * assert all three type prompts up front.
 */
async function generateAndStartQuiz(page: Page): Promise<void> {
	await chatRoundTrip(page);
	await page.locator('button[aria-label="Generate quiz"]').click();
	await expect(page).toHaveURL(/\/quiz\//, { timeout: 30_000 });
	await page.getByRole('button', { name: 'Start quiz' }).click();
	await expect(page.getByText(QUIZ_MCQ_PROMPT)).toBeVisible();
	await expect(page.getByText(QUIZ_FLASHCARD_FRONT)).toBeVisible();
	await expect(page.getByText(QUIZ_SHORT_PROMPT)).toBeVisible();
	// The rubric renders inside a collapsed <details> (ShortQuestion.svelte),
	// so assert DOM attachment — the fixture payload is what matters, not the
	// collapsed panel's visibility.
	await expect(page.getByText(QUIZ_SHORT_RUBRIC)).toBeAttached();
}

/**
 * Answer every fixture question correctly on the current attempt: short first
 * with the grading lever's correct trigger (mock grades it Correct), the MCQ
 * by its known-correct option text (positions are shuffled — research.md D5),
 * then the flashcard by self-marking. Leaves the attempt fully answered.
 */
async function answerEveryQuestionCorrect(page: Page): Promise<void> {
	const shortAnswer = page.getByPlaceholder('Type your answer…');
	await shortAnswer.fill(
		`The chloroplast is where photosynthesis happens; this answer ${LEVER_TRIGGER_CORRECT}.`
	);
	await page.getByRole('button', { name: 'Submit', exact: true }).click();
	await expect(
		page.locator('div[class*="border-emerald-500/40"]', { hasText: 'Correct' })
	).toBeVisible({ timeout: 15_000 });

	await page.getByLabel(QUIZ_MCQ_CORRECT_ANSWER).check();
	const mcqCard = page.locator('li', { hasText: QUIZ_MCQ_PROMPT });
	await mcqCard.getByRole('button', { name: 'Submit answer' }).click();
	await expect(mcqCard.getByText('Correct', { exact: true })).toBeVisible({ timeout: 15_000 });

	await page.getByRole('button', { name: 'Reveal' }).click();
	await expect(page.getByText(QUIZ_FLASHCARD_BACK)).toBeVisible();
	await page.getByRole('button', { name: 'Got it' }).click();
	await expect(page.getByText('Marked: Got it')).toBeVisible();
}

test.describe('quiz RC verification deck', () => {
	test('generates a quiz from the deterministic reply and answers every question type', async ({
		onboarded
	}) => {
		const { page } = onboarded;
		await generateAndStartQuiz(page);
		await answerEveryQuestionCorrect(page);

		// All questions answered: the results screen shows the all-correct
		// score (QuizSummary's headline score line).
		await page.getByRole('button', { name: 'Take me to the results' }).click();
		await expect(page.getByText('3/3', { exact: true })).toBeVisible();
	});

	test('the grading lever grades a wrong answer as incorrect on a fresh attempt', async ({
		onboarded
	}) => {
		const { page } = onboarded;
		await generateAndStartQuiz(page);
		await answerEveryQuestionCorrect(page);

		// Retake from the results screen starts a fresh, unanswered attempt.
		await page.getByRole('button', { name: 'Take me to the results' }).click();
		await page.getByRole('button', { name: 'Retake' }).click();

		// Lever, wrong branch on the fresh attempt: the short answer now
		// carries the other trigger and must come back graded Incorrect.
		const shortAnswer = page.getByPlaceholder('Type your answer…');
		await shortAnswer.fill(`Mitochondria; this answer ${LEVER_TRIGGER_WRONG}.`);
		await page.getByRole('button', { name: 'Submit', exact: true }).click();
		await expect(
			page.locator('div[class*="border-red-500/40"]', { hasText: 'Incorrect' })
		).toBeVisible({ timeout: 15_000 });
	});
});

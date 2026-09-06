import { expect, test } from './fixtures/onboard';

const QUIZ_INSTRUCTIONS = 'Always end the quiz with a question about make clean.';
const LAB_INSTRUCTIONS = 'Keep every lab step under ten words.';

test.describe('read-only prompt contract', () => {
	test('quiz prompt: contract is viewable and read-only; instructions persist', async ({
		onboarded
	}) => {
		const { page } = onboarded;
		await page.goto('/settings#quiz-prompt');
		const section = page.locator('#quiz-prompt');

		// The effective prompt is visible with contract content even before any
		// instructions exist.
		const contract = section.getByLabel('Quiz contract (read-only)');
		await expect(contract).toBeVisible();
		await expect(contract).toContainText('You are a quiz designer');
		await expect(contract).toContainText('# Output shape');

		// The contract region is read-only text: no editable control lives in it.
		await expect(contract.locator('textarea')).toHaveCount(0);
		await expect(contract.locator('input')).toHaveCount(0);

		// Exactly one editable control: the instructions textarea.
		const instructions = section.getByLabel('Quiz custom instructions');
		await expect(section.locator('textarea')).toHaveCount(1);
		await expect(instructions).toBeEditable();

		// Typing instructions must not alter the contract region's text.
		const contractBefore = await contract.textContent();
		await instructions.fill(QUIZ_INSTRUCTIONS);
		await instructions.blur();
		await expect(section.getByRole('status')).toContainText(/saved/i);
		await expect(contract).toHaveText(contractBefore ?? '');
		await expect(section.getByLabel('Quiz instructions preview')).toContainText(QUIZ_INSTRUCTIONS);

		// The instructions persist across a reload; the contract is unchanged.
		await page.reload();
		await expect(section.getByLabel('Quiz custom instructions')).toHaveValue(QUIZ_INSTRUCTIONS);
		await expect(section.getByLabel('Quiz instructions preview')).toContainText(QUIZ_INSTRUCTIONS);
		await expect(contract).toContainText('# Output shape');
	});

	test('lab prompt: contract is viewable and read-only; instructions persist', async ({
		onboarded
	}) => {
		const { page } = onboarded;
		await page.goto('/settings#lab-prompt');
		const section = page.locator('#lab-prompt');

		const contract = section.getByLabel('Lab contract (read-only)');
		await expect(contract).toBeVisible();
		await expect(contract).toContainText('You are a learning lab designer');
		await expect(contract).toContainText('"checklist"');

		await expect(contract.locator('textarea')).toHaveCount(0);
		await expect(contract.locator('input')).toHaveCount(0);

		const instructions = section.getByLabel('Lab custom instructions');
		await expect(section.locator('textarea')).toHaveCount(1);
		await expect(instructions).toBeEditable();

		const contractBefore = await contract.textContent();
		await instructions.fill(LAB_INSTRUCTIONS);
		await instructions.blur();
		await expect(section.getByRole('status')).toContainText(/saved/i);
		await expect(contract).toHaveText(contractBefore ?? '');
		await expect(section.getByLabel('Lab instructions preview')).toContainText(LAB_INSTRUCTIONS);

		await page.reload();
		await expect(section.getByLabel('Lab custom instructions')).toHaveValue(LAB_INSTRUCTIONS);
		await expect(section.getByLabel('Lab instructions preview')).toContainText(LAB_INSTRUCTIONS);
		await expect(contract).toContainText('"checklist"');
	});
});

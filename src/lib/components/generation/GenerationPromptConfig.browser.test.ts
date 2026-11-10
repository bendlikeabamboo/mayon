import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render } from '../../../../tests/browser/render';
import GenerationPromptConfig from './GenerationPromptConfig.svelte';

const settings = vi.hoisted(() => ({
	values: new Map<string, unknown>()
}));

vi.mock('#lib/db/index.js', () => ({
	repos: {
		settings: {
			get: async (key: string) => settings.values.get(key) ?? null,
			set: async (key: string, value: unknown) => {
				settings.values.set(key, value);
			},
			delete: async (key: string) => {
				settings.values.delete(key);
			}
		}
	}
}));

const CONTRACT = [
	'You are a quiz designer. Given a conversation, produce a mixed quiz.',
	'',
	'# Output shape',
	'',
	'Return ONE JSON object with a "questions" array.'
].join('\n');

function props() {
	return {
		contract: CONTRACT,
		settingsKey: 'quizInstructions',
		title: 'Quiz generation prompt',
		noun: 'Quiz'
	};
}

async function renderPrompt() {
	const result = await render(GenerationPromptConfig, props());
	await expect.element(result.getByLabelText('Quiz custom instructions')).toBeVisible();
	return result;
}

beforeEach(() => {
	settings.values.clear();
});

afterEach(() => {
	settings.values.clear();
});

describe('GenerationPromptConfig read-only contract', () => {
	it('renders the contract read-only with exactly one editable control', async () => {
		const { getByLabelText, getByRole, getByText, container } = await renderPrompt();

		const contract = getByRole('group', { name: 'Quiz contract (read-only)' });
		await expect.element(contract).toHaveTextContent('You are a quiz designer.');
		await expect.element(contract).toHaveTextContent('# Output shape');
		expect(contract.element().querySelectorAll('textarea, input')).toHaveLength(0);

		await expect.element(getByText('Contract (read-only)')).toBeVisible();
		const instructions = getByLabelText('Quiz custom instructions');
		await expect.element(instructions).toBeEnabled();
		expect((instructions.element() as HTMLTextAreaElement).readOnly).toBe(false);
		expect(container.querySelectorAll('textarea')).toHaveLength(1);
	});

	it('saves instructions on blur, previews them, and leaves the contract unchanged', async () => {
		const { getByLabelText, getByRole, container } = await renderPrompt();

		const contract = getByRole('group', { name: 'Quiz contract (read-only)' });
		const before = contract.element().textContent;
		const instructions = getByLabelText('Quiz custom instructions');

		await userEvent.fill(instructions, 'Always end the quiz with a question about make clean.');
		await userEvent.click(getByRole('heading', { name: 'Quiz generation prompt' }));

		await vi.waitFor(() => {
			expect(settings.values.get('quizInstructions')).toBe(
				'Always end the quiz with a question about make clean.'
			);
		});
		await expect.element(getByRole('status')).toHaveTextContent('saved');
		await expect
			.element(getByRole('group', { name: 'Quiz instructions preview' }))
			.toHaveTextContent('Always end the quiz with a question about make clean.');
		expect(contract.element().textContent).toBe(before);
		expect(container.querySelectorAll('textarea')).toHaveLength(1);
	});

	it('loads persisted instructions on mount', async () => {
		settings.values.set('quizInstructions', 'Keep every step short.');

		const { getByLabelText, getByRole } = await renderPrompt();

		await expect
			.element(getByLabelText('Quiz custom instructions'))
			.toHaveValue('Keep every step short.');
		await expect
			.element(getByRole('group', { name: 'Quiz instructions preview' }))
			.toHaveTextContent('Keep every step short.');
	});
});

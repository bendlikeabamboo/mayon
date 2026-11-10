import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render } from '../../../../tests/browser/render';
import Composer from './Composer.svelte';

vi.mock('#lib/db/index.js', () => ({
	uuid: () => crypto.randomUUID(),
	repos: {
		settings: {
			get: async () => null,
			set: async () => {},
			delete: async () => {}
		}
	}
}));

function props() {
	return {
		onSend: vi.fn(),
		onStop: vi.fn(),
		onBranch: vi.fn(),
		onQuiz: vi.fn(),
		onLab: vi.fn(),
		providerName: 'OpenAI',
		modelId: 'gpt-4o'
	};
}

describe('Composer launchers', () => {
	it('renders the provider label and the three launcher actions', async () => {
		const { getByRole, getByText, getByPlaceholder } = await render(Composer, props());

		await expect.element(getByText('OpenAI · gpt-4o')).toBeVisible();
		await expect.element(getByRole('button', { name: /branch here/i })).toBeVisible();
		await expect.element(getByRole('button', { name: /quiz me/i })).toBeVisible();
		await expect.element(getByRole('button', { name: /open lab/i })).toBeVisible();
		await expect.element(getByPlaceholder(/Message the active provider/)).toBeVisible();
	});

	it('invokes each launcher action when enabled', async () => {
		const provided = props();
		const { getByRole } = await render(Composer, provided);

		await userEvent.click(getByRole('button', { name: /branch here/i }));
		await userEvent.click(getByRole('button', { name: /quiz me/i }));
		await userEvent.click(getByRole('button', { name: /open lab/i }));

		expect(provided.onBranch).toHaveBeenCalledTimes(1);
		expect(provided.onQuiz).toHaveBeenCalledTimes(1);
		expect(provided.onLab).toHaveBeenCalledTimes(1);
	});

	it('marks launchers aria-disabled and no-ops while streaming', async () => {
		const provided = { ...props(), streaming: true };
		const { getByRole } = await render(Composer, provided);

		const blocked = getByRole('button', {
			name: /Finish streaming the current reply before branching/i
		}).all();
		expect(blocked).toHaveLength(3);
		for (const button of blocked) {
			await expect.element(button).toHaveAttribute('aria-disabled', 'true');
			(button.element() as HTMLElement).click();
		}

		expect(provided.onBranch).not.toHaveBeenCalled();
		expect(provided.onQuiz).not.toHaveBeenCalled();
		expect(provided.onLab).not.toHaveBeenCalled();
	});

	it('sends the trimmed prompt with the current reasoning effort', async () => {
		const provided = props();
		const { getByRole, getByPlaceholder } = await render(Composer, provided);

		const send = getByRole('button', { name: 'Send' });
		await expect.element(send).toBeDisabled();

		await userEvent.fill(getByPlaceholder(/Message the active provider/), '  Hello world  ');
		await expect.element(send).toBeEnabled();
		await userEvent.click(send);

		expect(provided.onSend).toHaveBeenCalledWith('Hello world', 'on', undefined);
	});
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { Message } from '#lib/db/index.js';

import { render } from '../../../../tests/browser/render';
import PropagatedArtifact from './PropagatedArtifact.svelte';

const summaryMetadata = {
	mode: 'summary',
	sourceChatId: 'parent-chat',
	sourceChatTitle: 'Parent chat',
	branchPointMessageId: null,
	anchor: 'recorded',
	summaryTraceId: null,
	regeneratedAt: null
};

function artifact(overrides: Partial<Message> = {}): Message {
	return {
		id: 'artifact-1',
		chatId: 'chat-1',
		kind: 'branch_artifact',
		role: 'assistant',
		content: 'Artifact payload body',
		parts: null,
		ord: 1,
		model: null,
		tokens: null,
		toolCallId: null,
		toolName: null,
		metadata: JSON.stringify(summaryMetadata),
		createdAt: 1_700_000_000_000,
		...overrides
	} as Message;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('PropagatedArtifact', () => {
	it('labels the collapsed strip and expands the payload', async () => {
		const { getByRole, getByText } = await render(PropagatedArtifact, { entry: artifact() });

		const toggle = getByRole('button', { name: /Back-propagated from "Parent chat"/ });
		await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect.element(getByText('Summary')).toBeVisible();
		expect(getByText('Artifact payload body').query()).toBeNull();

		await userEvent.click(toggle);
		await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect.element(getByText('Artifact payload body')).toBeVisible();
	});

	it('wires regenerate and confirmed delete to the parent callbacks', async () => {
		const onRegenerate = vi.fn();
		const onDelete = vi.fn();
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
		const { getByRole } = await render(PropagatedArtifact, {
			entry: artifact(),
			onRegenerate,
			onDelete
		});

		await userEvent.click(getByRole('button', { name: /Back-propagated from/ }));
		await userEvent.click(getByRole('button', { name: 'Regenerate summary' }));
		expect(onRegenerate).toHaveBeenCalledWith('artifact-1');

		await userEvent.click(getByRole('button', { name: 'Delete artifact' }));
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(onDelete).toHaveBeenCalledWith('artifact-1');
	});

	it('does not delete when the confirmation is dismissed', async () => {
		const onDelete = vi.fn();
		vi.spyOn(window, 'confirm').mockReturnValue(false);
		const { getByRole } = await render(PropagatedArtifact, {
			entry: artifact(),
			onDelete
		});

		await userEvent.click(getByRole('button', { name: /Back-propagated from/ }));
		await userEvent.click(getByRole('button', { name: 'Delete artifact' }));
		expect(onDelete).not.toHaveBeenCalled();
	});

	it('offers delete but not regenerate for raw artifacts', async () => {
		const { getByRole, getByText } = await render(PropagatedArtifact, {
			entry: artifact({ metadata: JSON.stringify({ ...summaryMetadata, mode: 'raw' }) }),
			onRegenerate: vi.fn(),
			onDelete: vi.fn()
		});

		await expect.element(getByText('Raw')).toBeVisible();
		await userEvent.click(getByRole('button', { name: /Back-propagated from/ }));
		await expect.element(getByRole('button', { name: 'Delete artifact' })).toBeVisible();
		expect(getByRole('button', { name: 'Regenerate summary' }).query()).toBeNull();
	});

	it('degrades corrupt metadata to the unknown-branch fallback', async () => {
		const { getByRole, getByText } = await render(PropagatedArtifact, {
			entry: artifact({ metadata: '{not json' })
		});

		await expect
			.element(getByRole('button', { name: /Back-propagated from "unknown branch"/ }))
			.toBeVisible();
		await expect.element(getByText('Raw')).toBeVisible();
	});

	it('renders legacy duplicate image parts as distinct thumbnails (037 US5)', async () => {
		// Ported from the retired source-text guard
		// (PropagatedArtifact.test.ts): the grid's each-key is composite
		// (image.data + index, Composer pattern), so duplicated parts from a
		// pre-dedupe row still mount one thumbnail each instead of collapsing.
		const duplicate = {
			type: 'image',
			data: 'data:image/png;base64,iVBORw0KGgo=',
			mimeType: 'image/png',
			width: 1,
			height: 1,
			bytes: 16
		};
		const { getByRole } = await render(PropagatedArtifact, {
			entry: artifact({
				parts: JSON.stringify([{ type: 'text', text: 'dup' }, duplicate, duplicate])
			})
		});

		await userEvent.click(getByRole('button', { name: /Back-propagated from/ }));
		const thumbnails = getByRole('button', { name: 'View image full size' }).all();
		expect(thumbnails).toHaveLength(2);
		for (const thumbnail of thumbnails) {
			await expect.element(thumbnail).toBeVisible();
		}
	});
});

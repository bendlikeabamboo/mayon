import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { page as browserPage } from 'vitest/browser';

import type { Chat } from '#lib/db/index.js';

import { setPointerMedia } from '../../../tests/browser/media';
import { render } from '../../../tests/browser/render';
import '../../app.css';

const state = vi.hoisted(() => ({
	roots: [] as Chat[],
	subtrees: new Map<string, Chat[]>()
}));

vi.mock('#lib/db/index.js', () => ({
	repos: {
		chats: {
			listRoots: async () => state.roots,
			listSubtree: async (id: string) => state.subtrees.get(id) ?? []
		}
	}
}));

vi.mock('#lib/stores/chat.svelte.js', () => ({
	chatStore: {
		chatId: 'root' as string | null,
		deleteBranch: async () => {}
	}
}));

const { default: TreePage } = await import('./+page.svelte');

function chat(overrides: Partial<Chat> & Pick<Chat, 'id' | 'title'>): Chat {
	return {
		parentId: null,
		rootId: overrides.id,
		branchPointMessageId: null,
		depth: 0,
		provider: null,
		model: null,
		brief: null,
		mcpConfig: null,
		createdAt: 1,
		updatedAt: Date.now(),
		...overrides
	};
}

const root = chat({ id: 'root', title: 'Root chat' });
const branch = chat({
	id: 'branch',
	parentId: 'root',
	rootId: 'root',
	depth: 1,
	title: 'Branch chat'
});

function topPadding(container: HTMLElement): string {
	return getComputedStyle(container).paddingTop;
}

beforeEach(async () => {
	localStorage.clear();
	state.roots = [root];
	state.subtrees = new Map([['root', [root, branch]]]);
	await browserPage.viewport(480, 800);
	await setPointerMedia(false);
});

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await setPointerMedia(null);
});

describe('tree route mobile layout', () => {
	it('reserves top space below lg and releases it at lg', async () => {
		const { getByRole } = await render(TreePage);
		const heading = getByRole('heading', { name: 'Conversation tree' });
		await expect.element(heading).toBeVisible();
		const container = heading.element().parentElement?.parentElement as HTMLElement;

		await vi.waitFor(() => expect(topPadding(container)).toBe('56px'));

		await browserPage.viewport(1280, 800);
		await vi.waitFor(() => expect(topPadding(container)).toBe('32px'));
	});

	it('gives the caret control a 40px hit area and toggles the subtree', async () => {
		const { getByRole, getByText } = await render(TreePage);
		const caret = getByRole('button', { name: 'Collapse' });
		await expect.element(caret).toBeVisible();

		const box = caret.element().getBoundingClientRect();
		expect(box.width).toBe(40);
		expect(box.height).toBe(40);

		await userEvent.click(caret);
		await expect.element(getByRole('button', { name: 'Expand' })).toBeVisible();
		expect(getByText('Branch chat').query()).toBeNull();
	});

	it('keeps the delete control inert on fine pointers', async () => {
		const { getByRole } = await render(TreePage);
		const del = getByRole('button', { name: 'Delete branch' });
		await expect.element(del).toBeVisible();

		const style = getComputedStyle(del.element());
		expect(style.opacity).toBe('0');
		expect(style.pointerEvents).toBe('none');
		expect(style.display).not.toBe('none');
	});

	it('reveals the delete control on coarse pointers', async () => {
		const { getByRole } = await render(TreePage);
		const del = getByRole('button', { name: 'Delete branch' });
		await expect.element(del).toBeVisible();

		await setPointerMedia(true);
		await vi.waitFor(() => {
			const style = getComputedStyle(del.element());
			expect(style.opacity).toBe('1');
			expect(style.pointerEvents).toBe('auto');
		});
	});
});

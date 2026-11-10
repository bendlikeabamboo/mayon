import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { SectionEntry } from '#lib/settings/sections.js';

import { render } from '../../../../tests/browser/render';
import SettingsSearch from './SettingsSearch.svelte';

// The settings page composes its sections from these children; only its
// keyboard/search orchestration is under test here, so they render as a
// pass-through stub that still exposes the header snippet.
vi.mock(
	'#lib/components/ai/ProviderConfig.svelte',
	() => import('../../../../tests/browser/settings-section-stub.svelte')
);
vi.mock(
	'#lib/components/mcp/McpServers.svelte',
	() => import('../../../../tests/browser/settings-section-stub.svelte')
);
vi.mock(
	'#lib/components/labs/LabPromptConfig.svelte',
	() => import('../../../../tests/browser/settings-section-stub.svelte')
);
vi.mock(
	'#lib/components/quizzes/QuizPromptConfig.svelte',
	() => import('../../../../tests/browser/settings-section-stub.svelte')
);
vi.mock(
	'#lib/components/chat/LearnerProfileConfig.svelte',
	() => import('../../../../tests/browser/settings-section-stub.svelte')
);
vi.mock(
	'#lib/components/chat/ExpoundInstructionsConfig.svelte',
	() => import('../../../../tests/browser/settings-section-stub.svelte')
);
vi.mock(
	'#lib/components/settings/ChatDisplayConfig.svelte',
	() => import('../../../../tests/browser/settings-section-stub.svelte')
);
vi.mock(
	'#lib/components/settings/DataSection.svelte',
	() => import('../../../../tests/browser/settings-section-stub.svelte')
);
vi.mock(
	'#lib/components/settings/SandboxDbSection.svelte',
	() => import('../../../../tests/browser/settings-section-stub.svelte')
);
vi.mock(
	'#lib/components/settings/SecuritySection.svelte',
	() => import('../../../../tests/browser/settings-section-stub.svelte')
);
vi.mock(
	'#lib/components/settings/TelemetrySection.svelte',
	() => import('../../../../tests/browser/settings-section-stub.svelte')
);

const { default: SettingsPage } = await import('../../../routes/settings/+page.svelte');

const sections: SectionEntry[] = [
	{ id: 'providers', label: 'Providers', aliases: [], cap: null },
	{ id: 'chat', label: 'Chat', aliases: ['strip', 'streaming', 'appearance'], cap: null },
	{ id: 'security', label: 'Security', aliases: ['auth', 'login'], cap: null }
];

beforeEach(() => {
	window.history.replaceState({}, '', '/settings');
});

describe('SettingsSearch', () => {
	it('filters sections through matchSections as the query changes', async () => {
		const { getByText, getByPlaceholder, getByRole } = await render(SettingsSearch, {
			sections,
			onJump: vi.fn()
		});

		const input = getByPlaceholder('Jump to section…');
		await expect.element(getByRole('combobox', { name: 'Search settings' })).toBeVisible();
		await userEvent.fill(input, 'streaming');

		await expect.element(getByText('Chat')).toBeVisible();
		expect(getByText('Security').query()).toBeNull();
		await expect.element(getByRole('listbox', { name: 'Settings sections' })).toBeVisible();
	});

	it('shows the contracted empty state when nothing matches', async () => {
		const { getByText, getByPlaceholder } = await render(SettingsSearch, {
			sections,
			onJump: vi.fn()
		});

		await userEvent.fill(getByPlaceholder('Jump to section…'), 'zzz');

		await expect.element(getByText('No matching section')).toBeVisible();
	});

	it('delegates a jump when a match is selected', async () => {
		const onJump = vi.fn();
		const { getByText, getByPlaceholder } = await render(SettingsSearch, {
			sections,
			onJump
		});

		await userEvent.fill(getByPlaceholder('Jump to section…'), 'auth');
		await userEvent.click(getByText('Security'));

		expect(onJump).toHaveBeenCalledWith('security');
	});

	it('exposes focus() that moves focus to the search input', async () => {
		const { getByPlaceholder, component } = await render(SettingsSearch, {
			sections,
			onJump: vi.fn()
		});

		const input = getByPlaceholder('Jump to section…');
		component.focus();

		await vi.waitFor(() => expect(document.activeElement).toBe(input.element()));
	});
});

describe('settings page keyboard contract', () => {
	it('mounts the search in the header and focuses it on cmd-K with preventDefault', async () => {
		const { getByPlaceholder } = await render(SettingsPage);
		const input = getByPlaceholder('Jump to section…');
		await expect.element(input).toBeVisible();
		(input.element() as HTMLElement).blur();

		const event = new KeyboardEvent('keydown', {
			key: 'k',
			metaKey: true,
			bubbles: true,
			cancelable: true
		});
		window.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		await vi.waitFor(() => expect(document.activeElement).toBe(input.element()));
	});

	it('does not hijack a plain K keypress', async () => {
		const { getByPlaceholder } = await render(SettingsPage);
		const input = getByPlaceholder('Jump to section…');
		(input.element() as HTMLElement).blur();

		const event = new KeyboardEvent('keydown', {
			key: 'k',
			bubbles: true,
			cancelable: true
		});
		window.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
		expect(document.activeElement).not.toBe(input.element());
	});
});

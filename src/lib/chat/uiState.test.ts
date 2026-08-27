import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useFileTestDb, type FileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import {
	briefExpandedKey,
	defaultBriefExpanded,
	isBriefExpanded,
	setBriefExpanded
} from './uiState';

const testDb = useFileTestDb();
let fileDb: FileTestDb;
beforeAll(async () => {
	fileDb = await testDb.setup();
});
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

describe('uiState — key composition', () => {
	it('composes the literal ui-state:<chatId>:briefExpanded key', () => {
		expect(briefExpandedKey('c123')).toBe('ui-state:c123:briefExpanded');
	});

	it('keeps the reserved namespace prefix and facet suffix literals', () => {
		const key = briefExpandedKey('abc');
		expect(key.startsWith('ui-state:')).toBe(true);
		expect(key.endsWith(':briefExpanded')).toBe(true);
	});
});

describe('uiState — default resolution when the key is absent', () => {
	it('defaults untitled (null title) to expanded', async () => {
		await expect(isBriefExpanded('chat-absent', null)).resolves.toBe(true);
	});

	it('defaults empty/whitespace titles to expanded', async () => {
		await expect(isBriefExpanded('chat-absent', '')).resolves.toBe(true);
		await expect(isBriefExpanded('chat-absent', '   ')).resolves.toBe(true);
	});

	it('treats the DEFAULT_TITLE placeholder as untitled → expanded', async () => {
		await expect(isBriefExpanded('chat-absent', 'New chat')).resolves.toBe(true);
		expect(defaultBriefExpanded('New chat')).toBe(true);
	});

	it('defaults a titled chat to collapsed', async () => {
		await expect(isBriefExpanded('chat-absent', 'Docker Volumes')).resolves.toBe(false);
		expect(defaultBriefExpanded('Docker Volumes')).toBe(false);
	});
});

describe('uiState — round-trip persistence', () => {
	it('round-trips a stored boolean through set/get', async () => {
		await setBriefExpanded('rt-chat', false);
		await expect(isBriefExpanded('rt-chat', null)).resolves.toBe(false);

		await setBriefExpanded('rt-chat', true);
		await expect(isBriefExpanded('rt-chat', 'A Titled Chat')).resolves.toBe(true);
	});

	it('keeps values independent per chat', async () => {
		await setBriefExpanded('rt-a', true);
		await setBriefExpanded('rt-b', false);
		await expect(isBriefExpanded('rt-a', 'Titled A')).resolves.toBe(true);
		await expect(isBriefExpanded('rt-b', 'Titled B')).resolves.toBe(false);
	});
});

describe('uiState — corrupt/wrong-type fallback', () => {
	it('falls back to defaults for a wrong-typed JSON string value', async () => {
		await repos.settings.set(briefExpandedKey('rc-1'), 'yes' as unknown as boolean);
		await expect(isBriefExpanded('rc-1', null)).resolves.toBe(true);
		await expect(isBriefExpanded('rc-1', 'Titled')).resolves.toBe(false);
	});

	it('falls back to defaults for other wrong-typed scalars and objects', async () => {
		await repos.settings.set(briefExpandedKey('rc-2'), 1 as unknown as boolean);
		await expect(isBriefExpanded('rc-2', null)).resolves.toBe(true);

		await repos.settings.set(briefExpandedKey('rc-3'), { expanded: true } as unknown as boolean);
		await expect(isBriefExpanded('rc-3', null)).resolves.toBe(true);
	});

	it('falls back to defaults for invalid JSON payloads without throwing', async () => {
		const key = briefExpandedKey('rc-4');
		await setBriefExpanded('rc-4', true);
		await fileDb.driver.exec(`UPDATE settings SET value = '{not json' WHERE key = '${key}'`);
		await expect(isBriefExpanded('rc-4', null)).resolves.toBe(true);
		await expect(isBriefExpanded('rc-4', 'Titled')).resolves.toBe(false);
	});
});

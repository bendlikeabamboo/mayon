import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileTestDb } from '$lib/db/driver/pg-test';
import { repos } from '$lib/db';
import type { ProviderConfig } from '$lib/ai/types';
import type { LanguageModel } from 'ai';
import { GeneratedLabSchema, type GeneratedLab } from '$lib/ai/generate/lab';

const testDb = useFileTestDb();
beforeAll(() => testDb.setup());
beforeEach(() => testDb.reset());
afterAll(() => testDb.teardown());

beforeEach(async () => {
	mockedGetActiveSdkProvider.mockReset();
	mockedGenerateText.mockReset();
	labsStore.list = [];
	labsStore.current = null;
	labsStore.error = null;
	labsStore.rawOffer = null;
	labsStore.generating = false;
});

vi.mock('$lib/ai/client', () => ({
	getActiveSdkProvider: vi.fn()
}));

vi.mock('ai', () => ({
	generateObject: vi.fn(),
	generateText: vi.fn(),
	streamText: vi.fn(),
	tool: vi.fn((def: unknown) => def),
	APICallError: class extends Error {
		statusCode: number;
		responseBody?: string;
		responseHeaders?: Record<string, string>;
		constructor(
			msg: string,
			opts: { statusCode?: number; responseBody?: string; responseHeaders?: Record<string, string> }
		) {
			super(msg);
			this.statusCode = opts?.statusCode ?? 0;
			this.responseBody = opts?.responseBody;
			this.responseHeaders = opts?.responseHeaders;
		}
	}
}));

const { getActiveSdkProvider } = await import('$lib/ai/client');
const mockedGetActiveSdkProvider = vi.mocked(getActiveSdkProvider);

const { generateText } = await import('ai');
const mockedGenerateText = vi.mocked(generateText);

import { labsStore } from './labs.svelte';

const stubConfig: ProviderConfig = {
	id: 'stub',
	kind: 'openai-compatible',
	name: 'stub',
	baseUrl: 'http://stub',
	defaultModel: 'stub-model',
	models: ['stub-model']
};

const validLab: GeneratedLab = GeneratedLabSchema.parse({
	title: 'Stub lab',
	intro: 'intro',
	steps: ['step one'],
	checklist: [{ text: 'done criterion' }]
});

async function seedChat(): Promise<string> {
	const chat = await repos.chats.createRoot({ title: 'C' });
	await repos.messages.append(chat.id, 'user', 'teach me something');
	return chat.id;
}

describe('labsStore.generate', () => {
	it('persists a generated lab and returns its id', async () => {
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validLab }],
			text: ''
		} as never);
		const chatId = await seedChat();

		const id = await labsStore.generate(chatId);

		expect(id).not.toBeNull();
		const lab = await repos.labs.getById(id!);
		expect(lab).not.toBeNull();
		expect(lab!.title).toBe('Stub lab');
		expect(lab!.content).toContain('# Stub lab');
		expect(lab!.content).toContain('1. step one');
		const items = repos.labs.parseChecklist(lab!.checklist);
		expect(items).toHaveLength(1);
		expect(items[0].text).toBe('done criterion');
		expect(items[0].done).toBe(false);
		expect(labsStore.list[0].id).toBe(id);
		expect(labsStore.generating).toBe(false);
		expect(labsStore.error).toBeNull();
		expect(labsStore.rawOffer).toBeNull();
	});

	it('sets rawOffer when generation raises LabGenerationError', async () => {
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});
		mockedGenerateText.mockRejectedValue(new Error('generation failed'));
		const chatId = await seedChat();

		const id = await labsStore.generate(chatId);

		expect(id).toBeNull();
		expect(labsStore.rawOffer).not.toBeNull();
		expect(labsStore.rawOffer!.chatId).toBe(chatId);
		expect(labsStore.rawOffer!.raw).toBe('generation failed');
		expect(await repos.labs.listAll()).toEqual([]);
	});

	it('surfaces a formatted error when there is no active provider', async () => {
		const { MissingKeyError } = await import('$lib/ai/types');
		mockedGetActiveSdkProvider.mockRejectedValue(new MissingKeyError('no provider'));
		const chatId = await seedChat();

		const id = await labsStore.generate(chatId);

		expect(id).toBeNull();
		expect(labsStore.error).not.toBeNull();
		expect(labsStore.error!.title).toBe('Missing API key');
		expect(labsStore.rawOffer).toBeNull();
	});

	it('is a no-op while already generating', async () => {
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validLab }],
			text: ''
		} as never);
		const chatId = await seedChat();
		labsStore.generating = true;
		const id = await labsStore.generate(chatId);
		expect(id).toBeNull();
	});
});

describe('labsStore.saveRaw', () => {
	it('persists raw text as a lab with an empty checklist', async () => {
		const chatId = await seedChat();
		const id = await labsStore.saveRaw(chatId, '# Some title\n\nbody text');
		expect(id).not.toBeNull();
		const lab = await repos.labs.getById(id!);
		expect(lab!.content).toBe('# Some title\n\nbody text');
		expect(lab!.title).toBe('Some title');
		expect(repos.labs.parseChecklist(lab!.checklist)).toEqual([]);
		expect(labsStore.rawOffer).toBeNull();
	});
});

describe('labsStore.toggleItem (optimistic)', () => {
	it('flips the item immediately and persists the new state', async () => {
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: stubConfig,
			toolCapability: true
		});
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validLab }],
			text: ''
		} as never);
		const chatId = await seedChat();
		const id = await labsStore.generate(chatId);
		labsStore.current = await repos.labs.getById(id!);

		const before = repos.labs.parseChecklist(labsStore.current!.checklist);
		expect(before[0].done).toBe(false);

		await labsStore.toggleItem(id!, before[0].id);

		const after = repos.labs.parseChecklist(labsStore.current!.checklist);
		expect(after[0].done).toBe(true);
		const row = await repos.labs.getById(id!);
		expect(repos.labs.parseChecklist(row!.checklist)[0].done).toBe(true);
	});
});

describe('labsStore.loadList / loadLab', () => {
	it('loadList populates the list from the DB', async () => {
		const chatId = await seedChat();
		await repos.labs.create({ chatId, title: 'L', content: 'c' });
		await labsStore.loadList();
		expect(Array.isArray(labsStore.list)).toBe(true);
	});

	it('loadLab sets current to the fetched lab', async () => {
		expect(labsStore.current).toBeNull();
	});
});

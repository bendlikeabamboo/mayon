import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_LAB_PROMPT,
	LabGenerationError,
	generateLab,
	type GenerateLabOptions
} from './generate';
import type { ChatMessage } from '../types';
import type { GeneratedLab } from './lab';
import type { LanguageModel } from 'ai';

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

const { generateText } = await import('ai');
const mockedGenerateText = vi.mocked(generateText);

const mockModel = {} as LanguageModel;

const validLab: GeneratedLab = {
	title: 'T',
	intro: 'intro',
	steps: ['s1'],
	checklist: [{ text: 'c1' }]
};

function optsWith(prompt: string): GenerateLabOptions {
	return { prompt };
}

const messages: ChatMessage[] = [{ role: 'user', content: 'go' }];

describe('generateLab', () => {
	beforeEach(() => {
		mockedGenerateText.mockReset();
	});

	it('returns the parsed object on success', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validLab }],
			text: ''
		} as never);
		const lab = await generateLab(mockModel, messages, optsWith('p'));
		expect(lab).toEqual(validLab);
	});

	it('passes the prompt as the system instruction', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validLab }],
			text: ''
		} as never);
		await generateLab(mockModel, messages, optsWith('MY PROMPT'));
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ system: 'MY PROMPT' })
		);
	});

	it('maps messages to SDK format', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validLab }],
			text: ''
		} as never);
		await generateLab(mockModel, messages, optsWith('p'));
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [{ role: 'user', content: 'go' }]
			})
		);
	});

	it('passes abort signal as abortSignal', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validLab }],
			text: ''
		} as never);
		const ac = new AbortController();
		await generateLab(mockModel, messages, { prompt: 'p', signal: ac.signal });
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: ac.signal })
		);
	});

	it('passes model to generateObject', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validLab }],
			text: ''
		} as never);
		await generateLab(mockModel, messages, optsWith('p'));
		expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({ model: mockModel }));
	});

	it('sets maxRetries to 2', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validLab }],
			text: ''
		} as never);
		await generateLab(mockModel, messages, optsWith('p'));
		expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }));
	});

	it('wraps errors in LabGenerationError', async () => {
		mockedGenerateText.mockRejectedValue(new Error('boom'));
		await expect(generateLab(mockModel, messages, optsWith('p'))).rejects.toThrow(
			LabGenerationError
		);
	});

	it('carries responseBody from APICallError as raw', async () => {
		const { APICallError } = await import('ai');
		const apiErr = new (APICallError as unknown as new (
			msg: string,
			opts: { statusCode?: number; responseBody?: string; responseHeaders?: Record<string, string> }
		) => InstanceType<typeof APICallError>)('fail', {
			statusCode: 500,
			responseBody: 'raw body'
		});
		mockedGenerateText.mockRejectedValue(apiErr);
		try {
			await generateLab(mockModel, messages, optsWith('p'));
		} catch (e) {
			expect(e).toBeInstanceOf(LabGenerationError);
			expect((e as LabGenerationError).raw).toBe('raw body');
		}
	});

	it('carries error message as raw when no responseBody', async () => {
		mockedGenerateText.mockRejectedValue(new Error('network down'));
		try {
			await generateLab(mockModel, messages, optsWith('p'));
		} catch (e) {
			expect(e).toBeInstanceOf(LabGenerationError);
			expect((e as LabGenerationError).raw).toBe('network down');
		}
	});

	it('propagates AbortError from the signal (does not wrap in LabGenerationError)', async () => {
		const ac = new AbortController();
		ac.abort();
		mockedGenerateText.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
		await expect(
			generateLab(mockModel, messages, { prompt: 'p', signal: ac.signal })
		).rejects.toThrow(LabGenerationError);
	});

	it('preserves multiple message roles', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validLab }],
			text: ''
		} as never);
		const multi: ChatMessage[] = [
			{ role: 'user', content: 'q1' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'q2' }
		];
		await generateLab(mockModel, multi, optsWith('p'));
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{ role: 'user', content: 'q1' },
					{ role: 'assistant', content: 'a1' },
					{ role: 'user', content: 'q2' }
				]
			})
		);
	});

	it('excludes system brief notes from the system option (uses only the lab prompt)', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: validLab }],
			text: ''
		} as never);
		const ctx: ChatMessage[] = [
			{ role: 'system', content: 'Calibrate to goal: learn Makefiles.' },
			{ role: 'user', content: 'teach me' },
			{ role: 'assistant', content: 'sure' }
		];
		await generateLab(mockModel, ctx, optsWith('LAB PROMPT'));
		expect(mockedGenerateText).toHaveBeenCalledTimes(1);
		const args = mockedGenerateText.mock.calls[0][0] as {
			system: string;
			messages: Array<{ role: string }>;
		};
		expect(args.system).toContain('LAB PROMPT');
		expect(args.system).not.toContain('learn Makefiles');
		expect(args.messages.every((m) => m.role !== 'system')).toBe(true);
		expect(args.messages).toEqual([
			{ role: 'user', content: 'teach me' },
			{ role: 'assistant', content: 'sure' }
		]);
	});
});

describe('DEFAULT_LAB_PROMPT', () => {
	it('describes the exact JSON shape without fenced blocks', () => {
		expect(DEFAULT_LAB_PROMPT).not.toContain('```json');
		expect(DEFAULT_LAB_PROMPT).toContain('title');
		expect(DEFAULT_LAB_PROMPT).toContain('intro');
		expect(DEFAULT_LAB_PROMPT).toContain('steps');
		expect(DEFAULT_LAB_PROMPT).toContain('checklist');
	});
});

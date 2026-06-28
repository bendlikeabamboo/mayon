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

const { generateObject } = await import('ai');
const mockedGenerateObject = vi.mocked(generateObject);

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
		mockedGenerateObject.mockReset();
	});

	it('returns the parsed object on success', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validLab } as never);
		const lab = await generateLab(mockModel, messages, optsWith('p'));
		expect(lab).toEqual(validLab);
	});

	it('passes the prompt as the system instruction', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validLab } as never);
		await generateLab(mockModel, messages, optsWith('MY PROMPT'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({ system: 'MY PROMPT' })
		);
	});

	it('maps messages to SDK format', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validLab } as never);
		await generateLab(mockModel, messages, optsWith('p'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [{ role: 'user', content: 'go' }]
			})
		);
	});

	it('passes abort signal as abortSignal', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validLab } as never);
		const ac = new AbortController();
		await generateLab(mockModel, messages, { prompt: 'p', signal: ac.signal });
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: ac.signal })
		);
	});

	it('passes model to generateObject', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validLab } as never);
		await generateLab(mockModel, messages, optsWith('p'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({ model: mockModel })
		);
	});

	it('sets maxRetries to 2', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validLab } as never);
		await generateLab(mockModel, messages, optsWith('p'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }));
	});

	it('wraps errors in LabGenerationError', async () => {
		mockedGenerateObject.mockRejectedValue(new Error('boom'));
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
		mockedGenerateObject.mockRejectedValue(apiErr);
		try {
			await generateLab(mockModel, messages, optsWith('p'));
		} catch (e) {
			expect(e).toBeInstanceOf(LabGenerationError);
			expect((e as LabGenerationError).raw).toBe('raw body');
		}
	});

	it('carries error message as raw when no responseBody', async () => {
		mockedGenerateObject.mockRejectedValue(new Error('network down'));
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
		mockedGenerateObject.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
		await expect(
			generateLab(mockModel, messages, { prompt: 'p', signal: ac.signal })
		).rejects.toThrow(LabGenerationError);
	});

	it('preserves multiple message roles', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validLab } as never);
		const multi: ChatMessage[] = [
			{ role: 'user', content: 'q1' },
			{ role: 'assistant', content: 'a1' },
			{ role: 'user', content: 'q2' }
		];
		await generateLab(mockModel, multi, optsWith('p'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{ role: 'user', content: 'q1' },
					{ role: 'assistant', content: 'a1' },
					{ role: 'user', content: 'q2' }
				]
			})
		);
	});
});

describe('DEFAULT_LAB_PROMPT', () => {
	it('instructs the model to emit a json fence with the exact shape', () => {
		expect(DEFAULT_LAB_PROMPT).toContain('```json');
		expect(DEFAULT_LAB_PROMPT).toContain('title');
		expect(DEFAULT_LAB_PROMPT).toContain('intro');
		expect(DEFAULT_LAB_PROMPT).toContain('steps');
		expect(DEFAULT_LAB_PROMPT).toContain('checklist');
	});
});

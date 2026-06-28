import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_BRIEF_PROMPT,
	BriefGenerationError,
	BriefParseError,
	GeneratedBriefSchema,
	generateBrief,
	parseGeneratedBrief,
	type GenerateBriefOptions
} from './generate-brief';
import type { ChatMessage } from '../types';
import type { GeneratedBrief } from './generate-brief';
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

const validBrief: GeneratedBrief = {
	goal: 'be able to write a Makefile',
	context: 'engineer',
	level: 'some',
	mode: 'socratic',
	scopeStrategy: 'guided-inquiry',
	scope: '30 min'
};
const validJson = JSON.stringify(validBrief);
const fencedValid = '```json\n' + validJson + '\n```';

function optsWith(prompt: string): GenerateBriefOptions {
	return { prompt };
}

const messages: ChatMessage[] = [{ role: 'user', content: 'go' }];

describe('GeneratedBriefSchema (strict)', () => {
	it('accepts a well-formed brief', () => {
		expect(GeneratedBriefSchema.parse(validBrief)).toEqual(validBrief);
	});

	it('accepts goal-only (missing optionals)', () => {
		const out = GeneratedBriefSchema.parse({ goal: 'learn rust' });
		expect(out).toEqual({ goal: 'learn rust' });
	});

	it('accepts scopeStrategy', () => {
		const out = GeneratedBriefSchema.parse({ goal: 'learn rust', scopeStrategy: 'deep-dive' });
		expect(out).toEqual({ goal: 'learn rust', scopeStrategy: 'deep-dive' });
	});

	it('rejects unknown scopeStrategy', () => {
		expect(() =>
			GeneratedBriefSchema.parse({ ...validBrief, scopeStrategy: 'nonexistent' })
		).toThrow();
	});

	it('rejects an extra (unknown) field', () => {
		expect(() => GeneratedBriefSchema.parse({ ...validBrief, surprise: 'no' })).toThrow();
	});

	it('rejects empty goal', () => {
		expect(() => GeneratedBriefSchema.parse({ ...validBrief, goal: '' })).toThrow();
	});

	it('rejects bad level enum', () => {
		expect(() => GeneratedBriefSchema.parse({ ...validBrief, level: 'expert' })).toThrow();
	});

	it('rejects bad mode enum', () => {
		expect(() => GeneratedBriefSchema.parse({ ...validBrief, mode: 'lecture' })).toThrow();
	});
});

describe('parseGeneratedBrief', () => {
	it('parses a fenced JSON block', () => {
		expect(parseGeneratedBrief(fencedValid)).toEqual(validBrief);
	});

	it('parses bare JSON', () => {
		expect(parseGeneratedBrief(validJson)).toEqual(validBrief);
	});

	it('throws BriefParseError (carrying raw) on non-JSON text', () => {
		const raw = 'this is not json at all';
		let err: unknown;
		try {
			parseGeneratedBrief(raw);
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(BriefParseError);
		expect((err as BriefParseError).raw).toBe(raw);
	});

	it('throws BriefParseError on a schema mismatch (extra field)', () => {
		const raw = '```json\n' + JSON.stringify({ ...validBrief, extra: 1 }) + '\n```';
		expect(() => parseGeneratedBrief(raw)).toThrow(BriefParseError);
	});
});

describe('generateBrief', () => {
	beforeEach(() => {
		mockedGenerateObject.mockReset();
	});

	it('returns the parsed brief on success', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validBrief } as never);
		const brief = await generateBrief(mockModel, messages, optsWith('p'));
		expect(brief).toEqual(validBrief);
	});

	it('passes the prompt as the system instruction', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validBrief } as never);
		await generateBrief(mockModel, messages, optsWith('MY PROMPT'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({ system: 'MY PROMPT' })
		);
	});

	it('maps messages to SDK format', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validBrief } as never);
		await generateBrief(mockModel, messages, optsWith('p'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [{ role: 'user', content: 'go' }]
			})
		);
	});

	it('passes abort signal as abortSignal', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validBrief } as never);
		const ac = new AbortController();
		await generateBrief(mockModel, messages, { prompt: 'p', signal: ac.signal });
		expect(mockedGenerateObject).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: ac.signal })
		);
	});

	it('sets maxRetries to 2', async () => {
		mockedGenerateObject.mockResolvedValue({ object: validBrief } as never);
		await generateBrief(mockModel, messages, optsWith('p'));
		expect(mockedGenerateObject).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }));
	});

	it('wraps errors in BriefGenerationError', async () => {
		mockedGenerateObject.mockRejectedValue(new Error('boom'));
		await expect(generateBrief(mockModel, messages, optsWith('p'))).rejects.toThrow(
			BriefGenerationError
		);
	});

	it('carries raw message in BriefGenerationError', async () => {
		mockedGenerateObject.mockRejectedValue(new Error('parse fail'));
		try {
			await generateBrief(mockModel, messages, optsWith('p'));
		} catch (e) {
			expect(e).toBeInstanceOf(BriefGenerationError);
			expect((e as BriefGenerationError).raw).toBe('parse fail');
		}
	});

	it('carries responseBody from APICallError as raw', async () => {
		const { APICallError } = await import('ai');
		const apiErr = new (APICallError as unknown as new (
			msg: string,
			opts: { statusCode?: number; responseBody?: string; responseHeaders?: Record<string, string> }
		) => InstanceType<typeof APICallError>)('fail', {
			statusCode: 500,
			responseBody: 'raw brief body'
		});
		mockedGenerateObject.mockRejectedValue(apiErr);
		try {
			await generateBrief(mockModel, messages, optsWith('p'));
		} catch (e) {
			expect(e).toBeInstanceOf(BriefGenerationError);
			expect((e as BriefGenerationError).raw).toBe('raw brief body');
		}
	});
});

describe('DEFAULT_BRIEF_PROMPT', () => {
	it('instructs the model to emit a json fence with the field names', () => {
		expect(DEFAULT_BRIEF_PROMPT).toContain('```json');
		expect(DEFAULT_BRIEF_PROMPT).toContain('goal');
		expect(DEFAULT_BRIEF_PROMPT).toContain('level');
		expect(DEFAULT_BRIEF_PROMPT).toContain('mode');
		expect(DEFAULT_BRIEF_PROMPT).toContain('scopeStrategy');
	});
});

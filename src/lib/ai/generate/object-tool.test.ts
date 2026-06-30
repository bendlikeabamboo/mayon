import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generateObjectViaTool, ObjectToolError, extractObjectErrorRaw } from './object-tool';
import type { LanguageModel } from 'ai';

vi.mock('ai', () => ({
	generateText: vi.fn(),
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

const Schema = z.object({ a: z.string().min(1) }).strict();
const validObject = { a: 'hi' };

function toolCallResult(input: unknown, text = '') {
	return { toolCalls: [{ type: 'tool-call', toolName: 'json', input }], text };
}

describe('generateObjectViaTool', () => {
	beforeEach(() => {
		mockedGenerateText.mockReset();
	});

	it('returns the validated object from the forced tool call', async () => {
		mockedGenerateText.mockResolvedValue(toolCallResult(validObject) as never);
		const out = await generateObjectViaTool(mockModel, {
			schema: Schema,
			system: 's',
			messages: [{ role: 'user', content: 'go' }]
		});
		expect(out.object).toEqual(validObject);
	});

	it('does NOT force a toolChoice (some providers, e.g. Z.AI/GLM, only support auto)', async () => {
		mockedGenerateText.mockResolvedValue(toolCallResult(validObject) as never);
		await generateObjectViaTool(mockModel, {
			schema: Schema,
			system: 's',
			messages: [{ role: 'user', content: 'go' }]
		});
		const args = mockedGenerateText.mock.calls[0][0] as { toolChoice?: unknown };
		expect(args.toolChoice).toBeUndefined();
	});

	it('unwraps a single-stringified tool-call argument (provider stringified the JSON)', async () => {
		mockedGenerateText.mockResolvedValue(toolCallResult(JSON.stringify(validObject)) as never);
		const out = await generateObjectViaTool(mockModel, {
			schema: Schema,
			system: 's',
			messages: [{ role: 'user', content: 'go' }]
		});
		expect(out.object).toEqual(validObject);
	});

	it('unwraps a double-stringified tool-call argument (GLM-style)', async () => {
		mockedGenerateText.mockResolvedValue(
			toolCallResult(JSON.stringify(JSON.stringify(validObject))) as never
		);
		const out = await generateObjectViaTool(mockModel, {
			schema: Schema,
			system: 's',
			messages: [{ role: 'user', content: 'go' }]
		});
		expect(out.object).toEqual(validObject);
	});

	it('unwraps a stringified JSON object emitted as prose (text fallback)', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [],
			text: '```json\n' + JSON.stringify(JSON.stringify(validObject)) + '\n```'
		} as never);
		const out = await generateObjectViaTool(mockModel, {
			schema: Schema,
			system: 's',
			messages: [{ role: 'user', content: 'go' }]
		});
		expect(out.object).toEqual(validObject);
	});

	it('declares exactly one tool named json with the schema', async () => {
		mockedGenerateText.mockResolvedValue(toolCallResult(validObject) as never);
		await generateObjectViaTool(mockModel, {
			schema: Schema,
			system: 's',
			messages: [{ role: 'user', content: 'go' }]
		});
		const args = mockedGenerateText.mock.calls[0][0] as { tools: Record<string, unknown> };
		expect(Object.keys(args.tools)).toEqual(['json']);
	});

	it('forwards system, messages, abortSignal and maxRetries', async () => {
		mockedGenerateText.mockResolvedValue(toolCallResult(validObject) as never);
		const ac = new AbortController();
		await generateObjectViaTool(mockModel, {
			schema: Schema,
			system: 'SYS',
			messages: [{ role: 'user', content: 'q' }],
			signal: ac.signal,
			maxRetries: 3
		});
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({
				system: 'SYS',
				messages: [{ role: 'user', content: 'q' }],
				abortSignal: ac.signal,
				maxRetries: 3
			})
		);
	});

	it('defaults maxRetries to 2 when omitted', async () => {
		mockedGenerateText.mockResolvedValue(toolCallResult(validObject) as never);
		await generateObjectViaTool(mockModel, {
			schema: Schema,
			system: 's',
			messages: [{ role: 'user', content: 'go' }]
		});
		expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 2 }));
	});

	it('falls back to parsing JSON text when the model emits no tool call', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [],
			text: 'Here you go:\n```json\n' + JSON.stringify(validObject) + '\n```'
		} as never);
		const out = await generateObjectViaTool(mockModel, {
			schema: Schema,
			system: 's',
			messages: [{ role: 'user', content: 'go' }]
		});
		expect(out.object).toEqual(validObject);
	});

	it('falls back to parsing bare JSON text when the model emits no tool call', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [],
			text: JSON.stringify(validObject)
		} as never);
		const out = await generateObjectViaTool(mockModel, {
			schema: Schema,
			system: 's',
			messages: [{ role: 'user', content: 'go' }]
		});
		expect(out.object).toEqual(validObject);
	});

	it('throws ObjectToolError carrying model text when there is no tool call and no parseable JSON', async () => {
		mockedGenerateText.mockResolvedValue({ toolCalls: [], text: 'here is prose instead' } as never);
		await expect(
			generateObjectViaTool(mockModel, {
				schema: Schema,
				system: 's',
				messages: [{ role: 'user', content: 'go' }]
			})
		).rejects.toThrow(ObjectToolError);
		try {
			await generateObjectViaTool(mockModel, {
				schema: Schema,
				system: 's',
				messages: [{ role: 'user', content: 'go' }]
			});
		} catch (e) {
			expect((e as ObjectToolError).raw).toBe('here is prose instead');
		}
	});

	it('rejects text-fallback JSON that does not match the schema', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [],
			text: JSON.stringify({ a: 'hi', extra: 1 })
		} as never);
		await expect(
			generateObjectViaTool(mockModel, {
				schema: Schema,
				system: 's',
				messages: [{ role: 'user', content: 'go' }]
			})
		).rejects.toThrow(ObjectToolError);
	});

	it('throws ObjectToolError when the tool input does not match the schema', async () => {
		mockedGenerateText.mockResolvedValue(toolCallResult({ a: 123 }, 'bad') as never);
		await expect(
			generateObjectViaTool(mockModel, {
				schema: Schema,
				system: 's',
				messages: [{ role: 'user', content: 'go' }]
			})
		).rejects.toThrow(ObjectToolError);
	});

	it('rejects unknown keys (strict) on the tool input', async () => {
		mockedGenerateText.mockResolvedValue(toolCallResult({ a: 'hi', extra: 1 }, '') as never);
		await expect(
			generateObjectViaTool(mockModel, {
				schema: Schema,
				system: 's',
				messages: [{ role: 'user', content: 'go' }]
			})
		).rejects.toThrow(ObjectToolError);
	});

	it('wraps a generateText rejection in ObjectToolError', async () => {
		mockedGenerateText.mockRejectedValue(new Error('network down'));
		await expect(
			generateObjectViaTool(mockModel, {
				schema: Schema,
				system: 's',
				messages: [{ role: 'user', content: 'go' }]
			})
		).rejects.toThrow(ObjectToolError);
	});
});

describe('extractObjectErrorRaw', () => {
	it('prefers the APICallError response body', async () => {
		const { APICallError } = await import('ai');
		const apiErr = new (APICallError as unknown as new (
			msg: string,
			opts: { statusCode?: number; responseBody?: string }
		) => InstanceType<typeof APICallError>)('fail', { statusCode: 500, responseBody: 'BODY' });
		expect(extractObjectErrorRaw(apiErr)).toBe('BODY');
	});

	it('falls back to the message when APICallError has no body', async () => {
		const { APICallError } = await import('ai');
		const apiErr = new (APICallError as unknown as new (
			msg: string,
			opts: { statusCode?: number; responseBody?: string }
		) => InstanceType<typeof APICallError>)('nope', { statusCode: 500 });
		expect(extractObjectErrorRaw(apiErr)).toBe('nope');
	});

	it('returns the ObjectToolError raw payload', () => {
		expect(extractObjectErrorRaw(new ObjectToolError('msg', 'raw text'))).toBe('raw text');
	});

	it('returns the message for a plain Error', () => {
		expect(extractObjectErrorRaw(new Error('boom'))).toBe('boom');
	});

	it('stringifies non-error values', () => {
		expect(extractObjectErrorRaw('weird')).toBe('weird');
	});
});

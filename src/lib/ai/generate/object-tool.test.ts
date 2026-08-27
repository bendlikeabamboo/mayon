import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { describeValidation, generateObjectViaTool, ObjectToolError } from './object-tool';
import type { LanguageModel } from 'ai';

vi.mock('ai', () => ({
	generateText: vi.fn(),
	streamText: vi.fn(),
	generateObject: vi.fn(),
	tool: vi.fn((def: unknown) => def),
	APICallError: class extends Error {
		responseBody?: string;
	}
}));

const { generateText } = await import('ai');
const mockedGenerateText = vi.mocked(generateText);

const mockModel = {} as LanguageModel;

const StrictSchema = z.object({ questions: z.array(z.string()).nonempty() }).strict();

const result = { questions: ['q1'] };

describe('generateObjectViaTool (input unwrapping)', () => {
	beforeEach(() => {
		mockedGenerateText.mockReset();
	});

	it('unwraps a double-serialized tool input', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: JSON.stringify(JSON.stringify(result)) }],
			text: ''
		} as never);
		await expect(
			generateObjectViaTool(mockModel, { schema: StrictSchema, system: 's', messages: [] })
		).resolves.toEqual({ object: result, text: '' });
	});

	it('unwraps a fence-wrapped double-serialized tool input', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [
				{ toolName: 'json', input: '```json\n' + JSON.stringify(JSON.stringify(result)) + '\n```' }
			],
			text: ''
		} as never);
		await expect(
			generateObjectViaTool(mockModel, { schema: StrictSchema, system: 's', messages: [] })
		).resolves.toEqual({ object: result, text: '' });
	});

	it('throws schema_mismatch when the tool input cannot satisfy the schema', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: {} }],
			text: 'meh'
		} as never);
		const err = await generateObjectViaTool(mockModel, {
			schema: StrictSchema,
			system: 's',
			messages: []
		}).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ObjectToolError);
		expect((err as ObjectToolError).code).toBe('schema_mismatch');
	});

	it('falls back to parsing fenced JSON text when no tool call was made', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [],
			text: 'Here you go:\n```json\n' + JSON.stringify(result) + '\n```'
		} as never);
		await expect(
			generateObjectViaTool(mockModel, { schema: StrictSchema, system: 's', messages: [] })
		).resolves.toEqual({ object: result, text: expect.stringContaining('Here you go') });
	});

	it('uses the default mechanical contract when no description is given', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: result }],
			text: ''
		} as never);
		await generateObjectViaTool(mockModel, { schema: StrictSchema, system: 's', messages: [] });
		const args = mockedGenerateText.mock.calls[0][0] as {
			tools?: { json?: { description?: string } };
		};
		expect(args.tools?.json?.description).toContain('never serialize it into a string');
	});

	it('passes a caller-supplied tool description through verbatim', async () => {
		mockedGenerateText.mockResolvedValue({
			toolCalls: [{ toolName: 'json', input: result }],
			text: ''
		} as never);
		await generateObjectViaTool(mockModel, {
			schema: StrictSchema,
			system: 's',
			messages: [],
			toolDescription: 'MY SHAPE CONTRACT'
		});
		const args = mockedGenerateText.mock.calls[0][0] as {
			tools?: { json?: { description?: string } };
		};
		expect(args.tools?.json?.description).toBe('MY SHAPE CONTRACT');
	});
});

describe('describeValidation', () => {
	it("returns '' for a valid value", () => {
		expect(describeValidation(StrictSchema, result)).toBe('');
	});

	it('joins multiple issues instead of reporting only the first', () => {
		const schema = z.object({ a: z.string(), b: z.string(), c: z.string() }).strict();
		const detail = describeValidation(schema, {});
		expect(detail.split('; ').length).toBeGreaterThanOrEqual(2);
	});

	it('truncates beyond five issues with a remaining-count note', () => {
		const schema = z
			.object({
				a: z.string(),
				b: z.string(),
				c: z.string(),
				d: z.string(),
				e: z.string(),
				f: z.string(),
				g: z.string()
			})
			.strict();
		const detail = describeValidation(schema, {
			a: 1,
			b: 2,
			c: 3,
			d: 4,
			e: 5,
			f: 6,
			g: 7
		});
		expect(detail.split('; ').length).toBeLessThanOrEqual(6);
		expect(detail).toMatch(/\+\d+ more issues\)$/);
	});
});

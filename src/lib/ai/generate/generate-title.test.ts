import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanTitle, DEFAULT_TITLE, generateTitle } from './generate-title';
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

const { generateText } = await import('ai');
const mockedGenerateText = vi.mocked(generateText);

const mockModel = {} as LanguageModel;

describe('cleanTitle', () => {
	it('returns plain text unchanged', () => {
		expect(cleanTitle('Terraform State Backend')).toBe('Terraform State Backend');
	});

	it('strips surrounding quotes', () => {
		expect(cleanTitle('"Terraform Basics"')).toBe('Terraform Basics');
		expect(cleanTitle('\u201cClickOps Overview\u201d')).toBe('ClickOps Overview');
	});

	it('strips a code fence', () => {
		expect(cleanTitle('```json\nTerraform\n```')).toBe('Terraform');
	});

	it('strips trailing punctuation', () => {
		expect(cleanTitle('ClickOps and Terraform!')).toBe('ClickOps and Terraform');
		expect(cleanTitle('Why though?')).toBe('Why though');
	});

	it('collapses internal whitespace and newlines', () => {
		expect(cleanTitle('  Multi   \n  word   ')).toBe('Multi word');
	});

	it('clamps very long titles with an ellipsis', () => {
		const long = 'A'.repeat(120);
		const out = cleanTitle(long);
		expect(out.length).toBe(80);
		expect(out.endsWith('\u2026')).toBe(true);
	});

	it('falls back to the default placeholder when empty', () => {
		expect(cleanTitle('')).toBe(DEFAULT_TITLE);
		expect(cleanTitle('   \n\t " " ')).toBe(DEFAULT_TITLE);
	});
});

describe('generateTitle', () => {
	beforeEach(() => {
		mockedGenerateText.mockReset();
	});

	it('returns cleaned text from generateText', async () => {
		mockedGenerateText.mockResolvedValue({ text: '"Docker Volumes"' } as never);
		const title = await generateTitle(mockModel, [
			{ role: 'user', content: 'how do volumes work' },
			{ role: 'assistant', content: 'they persist data' }
		]);
		expect(title).toBe('Docker Volumes');
	});

	it('passes the title system prompt', async () => {
		mockedGenerateText.mockResolvedValue({ text: 'T' } as never);
		await generateTitle(mockModel, [{ role: 'user', content: 'hi' }]);
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({
				system: expect.stringContaining('title')
			})
		);
	});

	it('maps messages to SDK format', async () => {
		mockedGenerateText.mockResolvedValue({ text: 'T' } as never);
		await generateTitle(mockModel, [
			{ role: 'user', content: 'how do volumes work' },
			{ role: 'assistant', content: 'they persist data' }
		]);
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{ role: 'user', content: 'how do volumes work' },
					{ role: 'assistant', content: 'they persist data' }
				]
			})
		);
	});

	it('passes the model to generateText', async () => {
		mockedGenerateText.mockResolvedValue({ text: 'T' } as never);
		await generateTitle(mockModel, [{ role: 'user', content: 'hi' }]);
		expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({ model: mockModel }));
	});

	it('sets maxRetries to 0', async () => {
		mockedGenerateText.mockResolvedValue({ text: 'T' } as never);
		await generateTitle(mockModel, [{ role: 'user', content: 'hi' }]);
		expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
	});

	it('uses a prompt that asks for a 3 to 10 word title', async () => {
		mockedGenerateText.mockResolvedValue({ text: 'T' } as never);
		await generateTitle(mockModel, [{ role: 'user', content: 'hi' }]);
		const prompt = mockedGenerateText.mock.calls[0][0].system;
		expect(prompt).toContain('3');
		expect(prompt).toContain('10');
	});

	it('falls back to the placeholder when the model returns nothing usable', async () => {
		mockedGenerateText.mockResolvedValue({ text: '   ' } as never);
		const title = await generateTitle(mockModel, [{ role: 'user', content: 'hi' }]);
		expect(title).toBe(DEFAULT_TITLE);
	});

	it('passes abort signal as abortSignal', async () => {
		mockedGenerateText.mockResolvedValue({ text: 'T' } as never);
		const ac = new AbortController();
		await generateTitle(mockModel, [{ role: 'user', content: 'hi' }], { signal: ac.signal });
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ abortSignal: ac.signal })
		);
	});

	it('propagates errors from generateText', async () => {
		mockedGenerateText.mockRejectedValue(new Error('model error'));
		await expect(generateTitle(mockModel, [{ role: 'user', content: 'hi' }])).rejects.toThrow(
			'model error'
		);
	});
});

import { describe, expect, it } from 'vitest';
import { cleanTitle, DEFAULT_TITLE, generateTitle } from './generate-title';
import type { ChatMessage, ChatStreamOptions, Provider, ProviderConfig, Token } from '../types';

/**
 * Stub provider emitting one scripted reply per `chatStream` call, char by char
 * (mirrors generate.test.ts). Records each call's message list for assertions.
 */
function scriptedProvider(replies: string[]): { provider: Provider; calls: ChatMessage[][] } {
	const calls: ChatMessage[][] = [];
	let call = 0;
	const config: ProviderConfig = {
		id: 'stub',
		kind: 'openai-compatible',
		name: 'stub',
		baseUrl: 'http://stub',
		defaultModel: 'stub-model',
		models: ['stub-model']
	};
	const provider: Provider = {
		kind: 'openai-compatible',
		config,
		async *chatStream(messages: ChatMessage[], opts?: ChatStreamOptions): AsyncIterable<Token> {
			calls.push(messages);
			if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			const reply = replies[Math.min(call, replies.length - 1)] ?? '';
			call += 1;
			for (const ch of reply) {
				if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
				yield { text: ch };
			}
		},
		generateLab: () => Promise.reject(new Error('unused')),
		generateQuiz: () => Promise.reject(new Error('unused')),
		gradeShortAnswer: () => Promise.reject(new Error('unused'))
	};
	return { provider, calls };
}

describe('cleanTitle', () => {
	it('returns plain text unchanged', () => {
		expect(cleanTitle('Terraform State Backend')).toBe('Terraform State Backend');
	});

	it('strips surrounding quotes', () => {
		expect(cleanTitle('"Terraform Basics"')).toBe('Terraform Basics');
		expect(cleanTitle('“ClickOps Overview”')).toBe('ClickOps Overview');
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
		expect(out.endsWith('…')).toBe(true);
	});

	it('falls back to the default placeholder when empty', () => {
		expect(cleanTitle('')).toBe(DEFAULT_TITLE);
		expect(cleanTitle('   \n\t " " ')).toBe(DEFAULT_TITLE);
	});
});

describe('generateTitle', () => {
	it('streams a reply, cleans it, and prepends the title system prompt', async () => {
		const { provider, calls } = scriptedProvider(['"Docker Volumes"']);
		const title = await generateTitle(provider, [
			{ role: 'user', content: 'how do volumes work' },
			{ role: 'assistant', content: 'they persist data' }
		]);
		expect(title).toBe('Docker Volumes');
		// The first turn sent to the provider is the title system instruction.
		expect(calls[0][0].role).toBe('system');
		expect(calls[0][0].content).toContain('title');
		// The provided context follows it.
		expect(calls[0].slice(1).map((m) => m.role)).toEqual(['user', 'assistant']);
	});

	it('falls back to the placeholder when the model returns nothing usable', async () => {
		const { provider } = scriptedProvider(['   ']);
		const title = await generateTitle(provider, [{ role: 'user', content: 'hi' }]);
		expect(title).toBe(DEFAULT_TITLE);
	});

	it('propagates an abort signal from the stream', async () => {
		const { provider } = scriptedProvider(['irrelevant']);
		const ctrl = new AbortController();
		ctrl.abort();
		await expect(
			generateTitle(provider, [{ role: 'user', content: 'hi' }], { signal: ctrl.signal })
		).rejects.toThrow('AbortError');
	});
});

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_BRIEF_PROMPT,
	BriefGenerationError,
	BriefParseError,
	GeneratedBriefSchema,
	generateBrief,
	parseGeneratedBrief,
	type GenerateBriefOptions
} from './generate-brief';
import type { ChatMessage, ChatStreamOptions, Provider, ProviderConfig, Token } from '../types';
import type { GeneratedBrief } from './generate-brief';

function scriptedProvider(replies: string[]): Provider {
	let call = 0;
	const calls: ChatMessage[][] = [];
	const config: ProviderConfig = {
		id: 'stub',
		kind: 'openai-compatible',
		name: 'stub',
		baseUrl: 'http://stub',
		defaultModel: 'stub-model',
		models: ['stub-model']
	};
	return {
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
		generateLab: () => {
			throw new Error('unused');
		},
		generateQuiz: () => Promise.reject(new Error('unused')),
		gradeShortAnswer: () => Promise.reject(new Error('unused'))
	};
}

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
	it('parses a valid fenced reply on the first attempt', async () => {
		const provider = scriptedProvider([fencedValid]);
		const brief = await generateBrief(provider, [{ role: 'user', content: 'go' }], optsWith('p'));
		expect(brief).toEqual(validBrief);
	});

	it('retries once and succeeds when the second reply is valid', async () => {
		const provider = scriptedProvider(['garbage', fencedValid]);
		const brief = await generateBrief(provider, [{ role: 'user', content: 'x' }], optsWith('p'));
		expect(brief).toEqual(validBrief);
	});

	it('feeds the bad output back as an assistant turn + correction on retry', async () => {
		const provider = scriptedProvider(['garbage', fencedValid]);
		const seen: ChatMessage[][] = [];
		const orig = provider.chatStream.bind(provider);
		provider.chatStream = async function* (messages: ChatMessage[], o?: ChatStreamOptions) {
			seen.push(messages);
			yield* orig(messages, o);
		};
		await generateBrief(provider, [{ role: 'user', content: 'x' }], optsWith('p'));
		const second = seen[1];
		expect(second.at(-2)).toEqual({ role: 'assistant', content: 'garbage' });
		expect(second.at(-1)?.role).toBe('user');
		expect(second.at(-1)?.content).toContain('not valid JSON');
	});

	it('throws BriefGenerationError (with raw) after exhausting retries', async () => {
		const provider = scriptedProvider(['bad1', 'bad2', 'bad3']);
		let err: unknown;
		try {
			await generateBrief(provider, [{ role: 'user', content: 'x' }], optsWith('p'));
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(BriefGenerationError);
		expect((err as BriefGenerationError).raw).toBe('bad3');
	});

	it('propagates AbortError from the stream (does not retry)', async () => {
		const provider = scriptedProvider([fencedValid]);
		const ac = new AbortController();
		ac.abort();
		await expect(
			generateBrief(provider, [{ role: 'user', content: 'x' }], {
				...optsWith('p'),
				signal: ac.signal
			})
		).rejects.toThrow(/Aborted/);
	});

	it('does not retry on a non-parse stream error (propagates)', async () => {
		const provider: Provider = {
			...scriptedProvider([fencedValid]),
			chatStream(): AsyncIterable<Token> {
				// eslint-disable-next-line require-yield -- intentionally throws before yielding
				return (async function* () {
					throw new Error('network down');
				})();
			}
		};
		await expect(
			generateBrief(provider, [{ role: 'user', content: 'x' }], optsWith('p'))
		).rejects.toThrow('network down');
	});

	it('forces reasoning disabled', async () => {
		const provider = scriptedProvider([fencedValid]);
		const seen: { opts?: ChatStreamOptions }[] = [];
		const orig = provider.chatStream.bind(provider);
		provider.chatStream = async function* (messages: ChatMessage[], o?: ChatStreamOptions) {
			seen.push({ opts: o });
			yield* orig(messages, o);
		};
		await generateBrief(provider, [{ role: 'user', content: 'x' }], optsWith('p'));
		expect(seen[0].opts?.reasoning).toBe('disabled');
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

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LAB_PROMPT,
	LabGenerationError,
	generateLab,
	type GenerateLabOptions
} from './generate';
import type { ChatMessage, ChatStreamOptions, Provider, ProviderConfig, Token } from '../types';
import type { GeneratedLab } from './lab';

/**
 * A controllable stub provider for orchestrator tests. It emits one scripted
 * full-string reply per `chatStream` call (regardless of the message list), in
 * order, so tests can simulate "bad then good" retry sequences and aborts.
 */
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
			// Honor an abort signal between/within calls (simulates mid-stream cancel).
			if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			const reply = replies[Math.min(call, replies.length - 1)] ?? '';
			call += 1;
			// Yield the reply one char at a time to exercise accumulation.
			for (const ch of reply) {
				if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
				yield { text: ch };
			}
		},
		generateLab: () => {
			throw new Error('not used — orchestrator drives chatStream directly');
		},
		generateQuiz: () => Promise.reject(new Error('P4')),
		gradeShortAnswer: () => Promise.reject(new Error('P4'))
	};
}

const validLab: GeneratedLab = {
	title: 'T',
	intro: 'intro',
	steps: ['s1'],
	checklist: [{ text: 'c1' }]
};
const validJson = JSON.stringify(validLab);
const fencedValid = '```json\n' + validJson + '\n```';

function optsWith(prompt: string): GenerateLabOptions {
	return { prompt };
}

describe('generateLab', () => {
	it('parses a valid fenced reply on the first attempt', async () => {
		const provider = scriptedProvider([fencedValid]);
		const lab = await generateLab(provider, [{ role: 'user', content: 'go' }], optsWith('p'));
		expect(lab).toEqual(validLab);
	});

	it('prepends the lab prompt as a leading system message', async () => {
		const provider = scriptedProvider([fencedValid]);
		const seen: ChatMessage[][] = [];
		// Wrap to capture the messages handed to chatStream.
		const orig = provider.chatStream.bind(provider);
		provider.chatStream = async function* (messages: ChatMessage[], o?: ChatStreamOptions) {
			seen.push(messages);
			yield* orig(messages, o);
		};
		await generateLab(provider, [{ role: 'user', content: 'ctx' }], optsWith('MY PROMPT'));
		expect(seen[0][0]).toEqual({ role: 'system', content: 'MY PROMPT' });
		// Original context follows.
		expect(seen[0][1]).toEqual({ role: 'user', content: 'ctx' });
	});

	it('retries once and succeeds when the second reply is valid', async () => {
		const provider = scriptedProvider(['garbage', fencedValid]);
		const lab = await generateLab(provider, [{ role: 'user', content: 'x' }], optsWith('p'));
		expect(lab).toEqual(validLab);
	});

	it('feeds the bad output back as an assistant turn + correction on retry', async () => {
		const provider = scriptedProvider(['garbage', fencedValid]);
		const seen: ChatMessage[][] = [];
		const orig = provider.chatStream.bind(provider);
		provider.chatStream = async function* (messages: ChatMessage[], o?: ChatStreamOptions) {
			seen.push(messages);
			yield* orig(messages, o);
		};
		await generateLab(provider, [{ role: 'user', content: 'x' }], optsWith('p'));
		// Second call's tail: [..., assistant:garbage, user:correction].
		const second = seen[1];
		expect(second.at(-2)).toEqual({ role: 'assistant', content: 'garbage' });
		expect(second.at(-1)?.role).toBe('user');
		expect(second.at(-1)?.content).toContain('not valid JSON');
	});

	it('throws LabGenerationError (with raw) after exhausting retries', async () => {
		const provider = scriptedProvider(['bad1', 'bad2', 'bad3']);
		let err: unknown;
		try {
			await generateLab(provider, [{ role: 'user', content: 'x' }], optsWith('p'));
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(LabGenerationError);
		expect((err as LabGenerationError).raw).toBe('bad3');
	});

	it('propagates AbortError from the stream (does not retry)', async () => {
		const provider = scriptedProvider([fencedValid]);
		const ac = new AbortController();
		ac.abort();
		await expect(
			generateLab(provider, [{ role: 'user', content: 'x' }], {
				...optsWith('p'),
				signal: ac.signal
			})
		).rejects.toThrow(/Aborted/);
	});

	it('does not retry on a non-parse stream error (propagates)', async () => {
		const provider: Provider = {
			...scriptedProvider([fencedValid]),
			chatStream(): AsyncIterable<Token> {
				// A throwing async iterable (no yield) so the orchestrator surfaces
				// the transport error instead of treating it as a parse failure.
				// eslint-disable-next-line require-yield -- intentionally throws before yielding
				return (async function* () {
					throw new Error('network down');
				})();
			}
		};
		await expect(
			generateLab(provider, [{ role: 'user', content: 'x' }], optsWith('p'))
		).rejects.toThrow('network down');
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

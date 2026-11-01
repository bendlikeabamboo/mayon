import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryEventRecord } from '@mayon/shared';
import { telemetryState } from './state.svelte';

// Spy the relay boundary: emitTelemetry hands records here when enabled.
vi.mock('#lib/telemetry/relay.js', () => ({ relayTelemetry: vi.fn() }));

vi.mock('#lib/db/index.js', () => ({
	repos: {
		quizzes: { create: vi.fn(async (row: Record<string, unknown>) => ({ id: 'quiz-1', ...row })) },
		quizQuestions: { add: vi.fn(async () => ({})) },
		agentTraces: { create: vi.fn(async (row: { id: string }) => ({ ...row, id: 'trace-1' })) }
	}
}));

vi.mock('#lib/chat/context.js', () => ({
	assembleContext: vi.fn(async () => [{ role: 'user', content: 'conversation context' }])
}));

vi.mock('#lib/ai/client.js', () => ({
	getActiveSdkProvider: vi.fn(async () => ({
		model: { modelId: 'mock-sink' },
		config: { kind: 'openai-compatible', defaultModel: 'mock-sink' }
	})),
	getAmbientEffort: vi.fn(async () => 'off')
}));

vi.mock('#lib/ai/dialects.js', () => ({
	resolveRequestSettings: vi.fn(() => ({
		callSettings: {},
		providerOptions: {},
		droppedExtraKeys: []
	}))
}));

vi.mock('#lib/ai/generate/generate-quiz.js', () => ({
	QuizGenerationError: class extends Error {
		constructor(message: string) {
			super(message);
			this.name = 'QuizGenerationError';
		}
	},
	generateQuiz: vi.fn()
}));

vi.mock('ai', () => ({ generateText: vi.fn() }));

const { relayTelemetry } = await import('#lib/telemetry/relay.js');
const relayMock = vi.mocked(relayTelemetry);
const { generateQuiz } = await import('#lib/ai/generate/generate-quiz.js');
const mockedGenerateQuiz = vi.mocked(generateQuiz);
const { generateText } = await import('ai');
const mockedGenerateText = vi.mocked(generateText);

const REQUEST = {
	system: 'You generate a quiz.',
	messages: [{ role: 'user', content: 'conversation context' }],
	schema: 'GeneratedQuizSchema'
};

function enabled(): void {
	telemetryState.applyConfig({
		enabled: true,
		host: 'https://lf.example.com',
		publicKey: 'pk-lf-x',
		captureMode: 'content',
		updatedAt: ''
	});
}

function records(): TelemetryEventRecord[] {
	return relayMock.mock.calls.map((c) => c[0]);
}

beforeEach(() => {
	relayMock.mockClear();
	mockedGenerateQuiz.mockReset();
	mockedGenerateText.mockReset();
	telemetryState.applyConfig({
		enabled: false,
		host: '',
		publicKey: '',
		captureMode: 'content',
		updatedAt: ''
	});
});

describe('store-side tap: quizzesStore.generate emits a quiz record', () => {
	it('emits kind quiz with chatId, model, provider, input, output, and success outcome', async () => {
		enabled();
		const generated = { questions: [] };
		mockedGenerateQuiz.mockImplementation(async (_model, _ctx, opts) => {
			opts?.onTrace?.({ request: REQUEST, result: { object: generated } });
			return generated;
		});
		const { quizzesStore } = await import('#lib/stores/quizzes.svelte.js');
		const id = await quizzesStore.generate('chat-77');
		expect(id).toBe('quiz-1');
		expect(relayMock).toHaveBeenCalledTimes(1);
		const rec = records()[0];
		expect(rec.kind).toBe('quiz');
		expect(rec.chatId).toBe('chat-77');
		expect(rec.model).toBe('mock-sink');
		expect(rec.provider).toBe('openai-compatible');
		expect(rec.outcome).toBe('success');
		expect(rec.input).toEqual({ system: REQUEST.system, messages: REQUEST.messages });
		expect(rec.output).toBe(JSON.stringify(generated));
		expect(typeof rec.startedAt).toBe('string');
		expect(typeof rec.durationMs).toBe('number');
		expect(rec.usage).toBeUndefined();
	});

	it('emits an error-outcome record when generation fails', async () => {
		enabled();
		mockedGenerateQuiz.mockImplementation(async (_model, _ctx, opts) => {
			opts?.onTrace?.({ request: REQUEST, error: 'provider down' });
			throw new Error('provider down');
		});
		const { quizzesStore } = await import('#lib/stores/quizzes.svelte.js');
		await quizzesStore.generate('chat-77');
		const rec = records()[0];
		expect(rec.kind).toBe('quiz');
		expect(rec.outcome).toBe('error');
		expect(rec.errorDetail).toBe('provider down');
	});

	it('emits nothing while telemetry is disabled', async () => {
		const generated = { questions: [] };
		mockedGenerateQuiz.mockImplementation(async (_model, _ctx, opts) => {
			opts?.onTrace?.({ request: REQUEST, result: { object: generated } });
			return generated;
		});
		const { quizzesStore } = await import('#lib/stores/quizzes.svelte.js');
		await quizzesStore.generate('chat-77');
		expect(relayMock).not.toHaveBeenCalled();
	});
});

describe('metadata capture mode strips generator records (FR-009)', () => {
	function tracedQuiz(): void {
		mockedGenerateQuiz.mockImplementation(async (_model, _ctx, opts) => {
			opts?.onTrace?.({ request: REQUEST, result: { object: { questions: [] } } });
			return { questions: [] };
		});
	}

	function metadataMode(): void {
		telemetryState.applyConfig({
			enabled: true,
			host: 'https://lf.example.com',
			publicKey: 'pk-lf-x',
			captureMode: 'metadata',
			updatedAt: ''
		});
	}

	it('omits input and output keys entirely (absent, not empty) from a quiz record', async () => {
		metadataMode();
		tracedQuiz();
		const { quizzesStore } = await import('#lib/stores/quizzes.svelte.js');
		await quizzesStore.generate('chat-77');
		expect(relayMock).toHaveBeenCalledTimes(1);
		const rec = records()[0];
		expect('input' in rec).toBe(false);
		expect('output' in rec).toBe(false);
		// Structure stays intact per mode semantics.
		expect(rec.kind).toBe('quiz');
		expect(rec.chatId).toBe('chat-77');
		expect(rec.model).toBe('mock-sink');
		expect(rec.provider).toBe('openai-compatible');
		expect(rec.startedAt).toBeTruthy();
		expect(typeof rec.durationMs).toBe('number');
		expect(rec.outcome).toBe('success');
	});

	it('reads the mode per record: a metadata switch applies to the next record without restart', async () => {
		enabled();
		tracedQuiz();
		const { quizzesStore } = await import('#lib/stores/quizzes.svelte.js');
		await quizzesStore.generate('chat-77');
		expect(records()[0].output).toBe(JSON.stringify({ questions: [] }));
		metadataMode();
		await quizzesStore.generate('chat-77');
		const rec = records()[1];
		expect('input' in rec).toBe(false);
		expect('output' in rec).toBe(false);
		expect(rec.kind).toBe('quiz');
	});
});

describe('ai-module-side tap: generateBranchArtifactSummary emits a branch-summary record', () => {
	it('emits kind branch-summary with the traced request, output text, and usage', async () => {
		enabled();
		mockedGenerateText.mockResolvedValue({
			text: 'the handoff summary',
			usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
		} as never);
		const { generateBranchArtifactSummary } =
			await import('#lib/ai/generate/generate-branch-artifact-summary.js');
		await generateBranchArtifactSummary('branch-9');
		expect(relayMock).toHaveBeenCalledTimes(1);
		const rec = records()[0];
		expect(rec.kind).toBe('branch-summary');
		expect(rec.chatId).toBe('branch-9');
		expect(rec.model).toBe('mock-sink');
		expect(rec.provider).toBe('openai-compatible');
		expect(rec.outcome).toBe('success');
		expect(rec.output).toBe('the handoff summary');
		expect(rec.usage).toEqual({ input: 1, output: 1, total: 2 });
		const input = rec.input as { system: string; messages: Array<{ role: string }> };
		expect(input.system).toContain('handoff note');
		expect(input.messages.at(-1)?.role).toBe('user');
	});

	it('emits an aborted-outcome record when the signal aborts mid-generation', async () => {
		enabled();
		const ac = new AbortController();
		ac.abort();
		mockedGenerateText.mockRejectedValue(new Error('The operation was aborted'));
		const { generateBranchArtifactSummary } =
			await import('#lib/ai/generate/generate-branch-artifact-summary.js');
		await expect(generateBranchArtifactSummary('branch-9', ac.signal)).rejects.toThrow();
		const rec = records()[0];
		expect(rec.outcome).toBe('aborted');
		expect(rec.errorDetail).toBe('The operation was aborted');
	});
});

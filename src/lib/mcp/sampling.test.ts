import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from './client';
import { FakeMcpTransport } from './fake-transport';
import { registerSamplingHandler, type SamplingTurnState } from './sampling';
import type { McpServerConfig } from './types';
import type { LanguageModel } from 'ai';
import type { ProviderConfig } from '$lib/ai/types';

vi.mock('ai', () => ({
	generateText: vi.fn(),
	streamText: vi.fn(),
	generateObject: vi.fn(),
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
const mockConfig = { modelId: 'test-model' } as unknown as ProviderConfig;

const baseConfig: McpServerConfig = {
	id: 'srv-1',
	name: 'test-server',
	transport: 'stdio',
	enabled: true,
	allowSampling: true,
	samplingMaxCallsPerTurn: 2,
	samplingMaxTokensPerTurn: 4096,
	createdAt: Date.now()
};

function makeSetup(overrides?: { config?: McpServerConfig; turnState?: SamplingTurnState }) {
	const transport = new FakeMcpTransport();
	const client = new McpClient(transport, overrides?.config ?? baseConfig);
	client.turnContext = {
		chatId: 'c1',
		rootChatId: 'c1',
		model: mockModel,
		config: mockConfig,
		budget: { subCalls: 0, maxSubCalls: 10 },
		requestApproval: vi.fn().mockResolvedValue({ approved: true }),
		onTrace: vi.fn()
	};
	return { client, transport, turnState: overrides?.turnState ?? { callCount: 0, tokensUsed: 0 } };
}

async function fireSampling(transport: FakeMcpTransport, params?: unknown) {
	transport.emitRequest({ id: 1, method: 'sampling/createMessage', params });
	await vi.waitFor(() => expect(transport.sentResponses).toHaveLength(1), { timeout: 500 });
	return transport.sentResponses[0];
}

describe('registerSamplingHandler', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('denies when allowSampling is false', async () => {
		const { client, transport, turnState } = makeSetup({
			config: { ...baseConfig, allowSampling: false }
		});
		registerSamplingHandler(client, { ...baseConfig, allowSampling: false }, turnState);
		await client.initialize();
		const resp = await fireSampling(transport);
		expect(resp.error).toEqual({ code: -32603, message: 'sampling denied' });
	});

	it('denies when per-turn call count is exceeded', async () => {
		const { client, transport, turnState } = makeSetup({
			turnState: { callCount: 2, tokensUsed: 0 }
		});
		registerSamplingHandler(client, baseConfig, turnState);
		await client.initialize();
		const resp = await fireSampling(transport);
		expect(resp.error).toEqual({
			code: -32603,
			message: 'sampling denied: per-turn call limit reached'
		});
	});

	it('denies when cumulative token budget is exhausted', async () => {
		const { client, transport, turnState } = makeSetup({
			turnState: { callCount: 0, tokensUsed: 4096 }
		});
		registerSamplingHandler(client, baseConfig, turnState);
		await client.initialize();
		const resp = await fireSampling(transport);
		expect(resp.error).toEqual({
			code: -32603,
			message: 'sampling denied: per-turn token budget exhausted'
		});
	});

	it('denies when requested tokens exceed remaining budget', async () => {
		const { client, transport, turnState } = makeSetup({
			turnState: { callCount: 0, tokensUsed: 3000 }
		});
		registerSamplingHandler(client, baseConfig, turnState);
		await client.initialize();
		mockedGenerateText.mockResolvedValue({
			text: 'hi',
			usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
		} as unknown as Awaited<ReturnType<typeof generateText>>);
		const resp = await fireSampling(transport, { maxTokens: 2048 });
		expect(resp.error).toEqual({
			code: -32603,
			message: 'sampling denied: requested tokens exceed remaining budget'
		});
	});

	it('denies when no approval mechanism and no provider call', async () => {
		const { client, transport, turnState } = makeSetup();
		client.turnContext!.requestApproval = undefined;
		registerSamplingHandler(client, baseConfig, turnState);
		await client.initialize();
		const resp = await fireSampling(transport);
		expect(resp.error).toEqual({ code: -32603, message: 'sampling denied: no approval mechanism' });
		expect(mockedGenerateText).not.toHaveBeenCalled();
	});

	it('denies when approval is declined', async () => {
		const { client, transport, turnState } = makeSetup();
		client.turnContext!.requestApproval = vi
			.fn()
			.mockResolvedValue({ approved: false, aborted: true });
		registerSamplingHandler(client, baseConfig, turnState);
		await client.initialize();
		const resp = await fireSampling(transport);
		expect(resp.error).toEqual({ code: -32603, message: 'sampling denied' });
		expect(mockedGenerateText).not.toHaveBeenCalled();
	});

	it('returns sanitized assistant text on approval and debits budget', async () => {
		const { client, transport, turnState } = makeSetup();
		registerSamplingHandler(client, baseConfig, turnState);
		await client.initialize();
		mockedGenerateText.mockResolvedValue({
			text: 'Hello!',
			usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
		} as unknown as Awaited<ReturnType<typeof generateText>>);
		const resp = await fireSampling(transport, {
			messages: [{ role: 'user', content: 'Say hello' }],
			maxTokens: 100
		});
		expect(resp.error).toBeUndefined();
		expect(resp.result).toEqual({
			role: 'assistant',
			content: [{ type: 'text', text: 'Hello!' }],
			model: 'test-model'
		});
		expect(turnState.callCount).toBe(1);
		expect(turnState.tokensUsed).toBe(15);
	});

	it('denies second call in same turn when per-turn cap is 1', async () => {
		const { client, transport, turnState } = makeSetup({
			config: { ...baseConfig, samplingMaxCallsPerTurn: 1 }
		});
		registerSamplingHandler(client, { ...baseConfig, samplingMaxCallsPerTurn: 1 }, turnState);
		await client.initialize();
		mockedGenerateText.mockResolvedValue({
			text: 'ok',
			usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
		} as unknown as Awaited<ReturnType<typeof generateText>>);
		const first = await fireSampling(transport, { maxTokens: 100 });
		expect(first.result).toBeDefined();
		transport.sentResponses.splice(0);
		transport.emitRequest({ id: 2, method: 'sampling/createMessage', params: { maxTokens: 100 } });
		await vi.waitFor(() => expect(transport.sentResponses).toHaveLength(1), { timeout: 500 });
		const second = transport.sentResponses[0];
		expect(second.error).toEqual({
			code: -32603,
			message: 'sampling denied: per-turn call limit reached'
		});
	});

	it('returns error when ctx.signal is already aborted', async () => {
		const { client, transport, turnState } = makeSetup();
		const ac = new AbortController();
		ac.abort();
		client.turnContext!.signal = ac.signal;
		registerSamplingHandler(client, baseConfig, turnState);
		await client.initialize();
		mockedGenerateText.mockReturnValue(new Promise(() => {}));
		const resp = await fireSampling(transport, { maxTokens: 100 });
		expect(resp.error).toBeDefined();
		expect(resp.error?.code).toBe(-32603);
	});
});

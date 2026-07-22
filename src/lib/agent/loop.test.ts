import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import type { Message } from '$lib/db/schema';
import type { ProviderConfig } from '$lib/ai/types';
import type { AgentTurnDeps } from './loop';

vi.mock('ai', () => {
	const toolFn = vi.fn(() => ({}));
	const jsonSchemaFn = vi.fn((s) => s);
	const streamTextFn = vi.fn();
	return {
		streamText: streamTextFn,
		tool: toolFn,
		jsonSchema: jsonSchemaFn,
		APICallError: class APICallError extends Error {
			statusCode: number;
			responseBody?: string;
			responseHeaders?: Record<string, string>;
			constructor(
				msg: string,
				opts?: {
					statusCode?: number;
					responseBody?: string;
					responseHeaders?: Record<string, string>;
				}
			) {
				super(msg);
				this.statusCode = opts?.statusCode ?? 0;
				this.responseBody = opts?.responseBody;
				this.responseHeaders = opts?.responseHeaders;
			}
		}
	};
});

vi.mock('$lib/agent/capability', () => ({
	isSessionDisabled: vi.fn(() => false),
	disableToolsForSession: vi.fn(() => {})
}));

vi.mock('$lib/agent/registry', () => {
	const toolDefs = [
		{
			id: 'read_checklist',
			description: 'Read checklist',
			parameters: { type: 'object', properties: {} },
			risk: 'readonly' as const,
			generative: false
		},
		{
			id: 'branch_chat',
			description: 'Branch a chat',
			parameters: { type: 'object', properties: {} },
			risk: 'high' as const,
			generative: false
		},
		{
			id: 'toggle_checklist_item',
			description: 'Toggle item',
			parameters: { type: 'object', properties: {} },
			risk: 'low' as const,
			generative: false
		},
		{
			id: 'toggle_checklist_item',
			description: 'Toggle item',
			parameters: { type: 'object', properties: {} },
			risk: 'low' as const,
			generative: false
		},
		{
			id: 'present_choices',
			description: 'Present pacing choices',
			parameters: { type: 'object', properties: {} },
			risk: 'readonly' as const,
			generative: false,
			terminal: true
		},
		{
			id: 'create_quiz',
			description: 'Generate a quiz',
			parameters: { type: 'object', properties: {} },
			risk: 'high' as const,
			generative: true
		}
	];
	return {
		getToolDefinitions: vi.fn(() => toolDefs),
		getToolDefinition: vi.fn((id: string) => toolDefs.find((d) => d.id === id)),
		toolsRun: vi.fn()
	};
});

vi.mock('$lib/agent/critic', () => ({
	validateTurn: vi.fn()
}));

vi.mock('$lib/chat/context', () => ({
	toCoreMessages: vi.fn((msgs) => msgs)
}));

vi.mock('$lib/chat/brief', () => ({
	buildCapabilitiesPreamble: vi.fn(() => 'preamble'),
	buildFirstTurnOrientationPreamble: vi.fn(() => 'orientation')
}));

vi.mock('$lib/ai/sdk-factory', () => ({
	providerOptionsForReasoning: vi.fn(() => ({}))
}));

const { streamText, APICallError } = await import('ai');
const mockedStreamText = vi.mocked(streamText);

function newApiError(message: string, statusCode: number) {
	return new (APICallError as unknown as new (msg: string, opts: { statusCode: number }) => Error)(
		message,
		{ statusCode }
	);
}

const { isSessionDisabled, disableToolsForSession } = await import('$lib/agent/capability');
const mockedIsSessionDisabled = vi.mocked(isSessionDisabled);
const mockedDisableToolsForSession = vi.mocked(disableToolsForSession);

const { toolsRun, getToolDefinition } = await import('$lib/agent/registry');
const mockedToolsRun = vi.mocked(toolsRun);
void getToolDefinition;

const { validateTurn } = await import('$lib/agent/critic');
const mockedValidateTurn = vi.mocked(validateTurn);

const { toCoreMessages } = await import('$lib/chat/context');
const mockedToCoreMessages = vi.mocked(toCoreMessages);

const { buildCapabilitiesPreamble } = await import('$lib/chat/brief');
const mockedBuildCapabilitiesPreamble = vi.mocked(buildCapabilitiesPreamble);
const { buildFirstTurnOrientationPreamble } = await import('$lib/chat/brief');
const mockedBuildFirstTurnOrientationPreamble = vi.mocked(buildFirstTurnOrientationPreamble);

const { providerOptionsForReasoning } = await import('$lib/ai/sdk-factory');
const mockedProviderOptionsForReasoning = vi.mocked(providerOptionsForReasoning);

const { runAgentTurn } = await import('./loop');

function scriptedFullStream(
	parts: Array<{ type: string; [k: string]: unknown }>
): AsyncIterable<unknown> {
	return (async function* () {
		for (const p of parts) yield p;
	})();
}

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		id: 'test',
		kind: 'openai-compatible',
		name: 'Test',
		baseUrl: '',
		defaultModel: 'test-model',
		models: ['test-model'],
		...overrides
	};
}

function fakeMessage(partial: Record<string, unknown> = {}): Message {
	return {
		id: crypto.randomUUID(),
		chatId: 'chat-1',
		role: 'assistant',
		content: '',
		ord: 0,
		model: null,
		createdAt: Date.now(),
		tokens: null,
		toolCallId: null,
		toolName: null,
		metadata: null,
		...partial
	} as unknown as Message;
}

function makeDeps(overrides: Partial<AgentTurnDeps> = {}): AgentTurnDeps {
	const messages: Message[] = [];
	const bufferStates: string[] = [];
	const reasoningStates: string[] = [];
	return {
		model: {} as LanguageModel,
		config: makeConfig(),
		chatId: 'chat-1',
		rootChatId: 'chat-1',
		signal: new AbortController().signal,
		effort: 'on',
		updateStreamBuffer: vi.fn((n) => bufferStates.push(n)),
		updateReasoningBuffer: vi.fn((n) => reasoningStates.push(n)),
		appendAssistantText: vi.fn(async (content, _opts) => {
			const msg = fakeMessage({ content, ord: messages.length });
			messages.push(msg);
			return msg;
		}),
		appendAssistantToolCall: vi.fn(async (p) => {
			const msg = fakeMessage({
				toolCallId: p.toolCallId,
				toolName: p.toolName,
				metadata: JSON.stringify(p.args),
				ord: messages.length
			});
			messages.push(msg);
			return msg;
		}),
		appendToolResult: vi.fn(async (r) => {
			const msg = fakeMessage({
				role: 'tool',
				content: r.summary,
				toolCallId: r.toolCallId,
				toolName: r.toolName,
				ord: messages.length
			});
			messages.push(msg);
			return msg;
		}),
		reassembleContext: vi.fn(async () => []),
		requestApproval: vi.fn(async () => ({ approved: true })),
		notifyLowRisk: vi.fn(),
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedIsSessionDisabled.mockReturnValue(false);
	mockedValidateTurn.mockResolvedValue([]);
	mockedToolsRun.mockReset();
	mockedToolsRun.mockResolvedValue({ ok: true, summary: 'ok' });
	mockedToCoreMessages.mockImplementation((msgs) => msgs as never);
	mockedBuildCapabilitiesPreamble.mockReturnValue('preamble');
	mockedBuildFirstTurnOrientationPreamble.mockReturnValue('orientation');
	mockedProviderOptionsForReasoning.mockReturnValue({});
});

describe('runAgentTurn', () => {
	it('(a) text-only turn finalizes; one assistant text row persisted; no tool rows; buffer set to full text', async () => {
		mockedStreamText.mockReturnValue({
			fullStream: scriptedFullStream([
				{ type: 'text-delta', text: 'Hello' },
				{ type: 'text-delta', text: ' world' },
				{ type: 'finish', finishReason: 'stop' }
			])
		} as never);

		const deps = makeDeps();
		const result = await runAgentTurn(deps);

		expect(result).toEqual({ aborted: false });
		expect(deps.appendAssistantText).toHaveBeenCalledOnce();
		expect(deps.appendAssistantText).toHaveBeenCalledWith('Hello world', { reasoning: undefined });
		expect(deps.updateStreamBuffer).toHaveBeenCalledWith('Hello');
		expect(deps.updateStreamBuffer).toHaveBeenCalledWith('Hello world');
		expect(deps.appendAssistantToolCall).not.toHaveBeenCalled();
		expect(deps.appendToolResult).not.toHaveBeenCalled();
	});

	it('(b) read_checklist turn: tool-call -> toolsRun -> result persisted -> follow-up text', async () => {
		mockedStreamText
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{
						type: 'tool-call',
						toolCallId: 'tc1',
						toolName: 'read_checklist',
						args: { labId: 'lab1' }
					},
					{ type: 'finish', finishReason: 'tool-calls' }
				])
			} as never)
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'You have 1 of 3 done.' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);
		mockedToolsRun.mockResolvedValue({ ok: true, summary: '1/3 steps done' });

		const deps = makeDeps();
		const result = await runAgentTurn(deps);

		expect(result).toEqual({ aborted: false });
		expect(deps.reassembleContext).toHaveBeenCalledTimes(2);
		expect(mockedToolsRun).toHaveBeenCalledOnce();
		expect(mockedToolsRun).toHaveBeenCalledWith(
			'read_checklist',
			{ labId: 'lab1' },
			expect.objectContaining({
				chatId: 'chat-1',
				rootChatId: 'chat-1'
			})
		);
		expect(deps.appendAssistantToolCall).toHaveBeenCalledOnce();
		expect(deps.appendToolResult).toHaveBeenCalledOnce();
		expect(deps.appendToolResult).toHaveBeenCalledWith(
			expect.objectContaining({ summary: '1/3 steps done' })
		);
		expect(deps.appendAssistantText).toHaveBeenCalledOnce();
		expect(deps.appendAssistantText).toHaveBeenCalledWith('You have 1 of 3 done.', {
			reasoning: undefined
		});
	});

	it('(c) maxIterations: loop stops at 6; finalizes with exhaustion note; no runaway', async () => {
		for (let i = 0; i < 10; i++) {
			mockedStreamText.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'tool-call', toolCallId: `tc-${i}`, toolName: 'read_checklist', args: {} },
					{ type: 'finish', finishReason: 'tool-calls' }
				])
			} as never);
		}
		mockedToolsRun.mockResolvedValue({ ok: true, summary: 'ok' });

		const deps = makeDeps();
		const start = Date.now();
		const result = await runAgentTurn(deps);
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(5000);
		expect(result).toEqual({ aborted: false });
		expect(deps.appendAssistantText).toHaveBeenCalled();
		const lastCall = mockedAppendAssistantTextContent(deps);
		expect(lastCall).toContain('tool budget reached');
		expect(mockedStreamText).toHaveBeenCalledTimes(6);
	});

	it('(d) abort mid-stream: partial buf persisted; resolves { aborted: true }', async () => {
		const ac = new AbortController();
		const deps = makeDeps({
			signal: ac.signal,
			updateStreamBuffer: vi.fn((n) => {
				if (n.length > 3) ac.abort();
			})
		});

		mockedStreamText.mockReturnValue({
			fullStream: scriptedFullStream([
				{ type: 'text-delta', text: 'partial' },
				{ type: 'text-delta', text: ' text' },
				{ type: 'finish', finishReason: 'stop' }
			])
		} as never);

		const result = await runAgentTurn(deps);
		expect(result).toEqual({ aborted: true });
		expect(deps.appendAssistantText).toHaveBeenCalled();
		const content = mockedAppendAssistantTextContent(deps);
		expect(content).toBeTruthy();
		expect(content.length).toBeGreaterThan(0);
	});

	it('(d) abort mid-tool-run: second tool result synthesized as aborted', async () => {
		const ac = new AbortController();
		let toolsRunResolve!: () => void;
		const toolPromise = new Promise<void>((resolve) => {
			toolsRunResolve = resolve;
		});

		mockedStreamText.mockReturnValue({
			fullStream: scriptedFullStream([
				{ type: 'tool-call', toolCallId: 'tc1', toolName: 'read_checklist', args: {} },
				{ type: 'tool-call', toolCallId: 'tc2', toolName: 'read_checklist', args: {} },
				{ type: 'finish', finishReason: 'tool-calls' }
			])
		} as never);

		mockedToolsRun
			.mockImplementationOnce(async () => {
				await toolPromise;
				return { ok: true, summary: 'first ok' };
			})
			.mockResolvedValueOnce({ ok: true, summary: 'should not see' });

		const deps = makeDeps({ signal: ac.signal });
		const turnP = runAgentTurn(deps);

		await vi.waitFor(() => expect(mockedToolsRun).toHaveBeenCalled());
		ac.abort();
		toolsRunResolve();

		const result = await turnP;
		expect(result).toEqual({ aborted: true });
		expect(deps.appendToolResult).toHaveBeenCalledTimes(2);
		expect(deps.appendToolResult).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ summary: 'aborted' })
		);
	});

	it('(e) incapable provider: streamText called with tools:{}; text-only response', async () => {
		mockedStreamText.mockReturnValue({
			fullStream: scriptedFullStream([
				{ type: 'text-delta', text: 'Hello' },
				{ type: 'finish', finishReason: 'stop' }
			])
		} as never);

		const deps = makeDeps({
			config: makeConfig({ toolCapability: undefined })
		});

		const result = await runAgentTurn(deps);
		expect(result).toEqual({ aborted: false });

		expect(mockedStreamText).toHaveBeenCalledOnce();
		const callArgs = mockedStreamText.mock.calls[0][0];
		expect(callArgs.tools).toEqual({});

		expect(deps.appendAssistantText).toHaveBeenCalledOnce();
	});

	it('(e2) firstTurn flag: streamText called with tools:{}; system contains orientation; no tool-enabled retry', async () => {
		mockedStreamText.mockReturnValue({
			fullStream: scriptedFullStream([
				{ type: 'text-delta', text: 'Welcome!' },
				{ type: 'finish', finishReason: 'stop' }
			])
		} as never);

		const deps = makeDeps({ firstTurn: true });
		const result = await runAgentTurn(deps);

		expect(result).toEqual({ aborted: false });
		expect(mockedStreamText).toHaveBeenCalledOnce();
		const callArgs = mockedStreamText.mock.calls[0][0];
		expect(callArgs.tools).toEqual({});
		expect(callArgs.system).toContain('orientation');
		expect(mockedBuildFirstTurnOrientationPreamble).toHaveBeenCalledOnce();
		expect(mockedBuildCapabilitiesPreamble).not.toHaveBeenCalled();
	});

	it('(e3) firstTurn absent with capable provider: tools enabled (regression guard)', async () => {
		mockedStreamText.mockReturnValue({
			fullStream: scriptedFullStream([
				{ type: 'text-delta', text: 'Hello' },
				{ type: 'finish', finishReason: 'stop' }
			])
		} as never);

		const deps = makeDeps({ config: makeConfig({ toolCapability: 'on' as const }) });
		const result = await runAgentTurn(deps);

		expect(result).toEqual({ aborted: false });
		expect(mockedStreamText).toHaveBeenCalledOnce();
		const callArgs = mockedStreamText.mock.calls[0][0];
		expect(Object.keys(callArgs.tools as object).length).toBeGreaterThan(0);
		expect(callArgs.system).toContain('preamble');
		expect(mockedBuildCapabilitiesPreamble).toHaveBeenCalledOnce();
		expect(mockedBuildFirstTurnOrientationPreamble).not.toHaveBeenCalled();
	});

	describe('(f) critic', () => {
		it('broken mermaid: exactly one correction re-stream fires; corrected text persisted', async () => {
			let validateCount = 0;
			mockedValidateTurn.mockImplementation(async () => {
				validateCount++;
				if (validateCount === 1) return [{ type: 'mermaid', message: 'parse error' }];
				return [];
			});

			mockedStreamText
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'text-delta', text: '```mermaid\nbad' },
						{ type: 'finish', finishReason: 'stop' }
					])
				} as never)
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'text-delta', text: '```mermaid\ngraph TD\nA-->B\n```' },
						{ type: 'finish', finishReason: 'stop' }
					])
				} as never);

			const deps = makeDeps();
			const result = await runAgentTurn(deps);

			expect(result).toEqual({ aborted: false });
			expect(mockedStreamText).toHaveBeenCalledTimes(2);
			expect(deps.updateStreamBuffer).toHaveBeenCalledWith('');
			expect(deps.appendAssistantText).toHaveBeenCalledOnce();
			expect(deps.appendAssistantText).toHaveBeenCalledWith('```mermaid\ngraph TD\nA-->B\n```', {
				reasoning: undefined
			});
		});

		it('still broken after 2 tries: best-effort persisted; console.warn called', async () => {
			mockedValidateTurn.mockResolvedValue([{ type: 'mermaid', message: 'still broken' }]);
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			mockedStreamText
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'text-delta', text: 'broken mermaid' },
						{ type: 'finish', finishReason: 'stop' }
					])
				} as never)
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'text-delta', text: 'still broken' },
						{ type: 'finish', finishReason: 'stop' }
					])
				} as never);

			const deps = makeDeps();
			const result = await runAgentTurn(deps);

			expect(result).toEqual({ aborted: false });
			expect(deps.appendAssistantText).toHaveBeenCalledOnce();
			expect(warnSpy).toHaveBeenCalledWith('[agent] critic: still broken after max corrections');
			warnSpy.mockRestore();
		});

		it('valid turn: zero correction streams', async () => {
			mockedStreamText.mockReturnValue({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'valid reply' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

			const deps = makeDeps();
			const result = await runAgentTurn(deps);

			expect(result).toEqual({ aborted: false });
			expect(mockedStreamText).toHaveBeenCalledOnce();
		});
	});

	it('(n) manifest: when enabled, streamText called with tools containing low+high defs; when disabled, tools:{}', async () => {
		mockedStreamText.mockReturnValue({
			fullStream: scriptedFullStream([
				{ type: 'text-delta', text: 'Hi' },
				{ type: 'finish', finishReason: 'stop' }
			])
		} as never);

		const deps1 = makeDeps({ config: makeConfig({ toolCapability: 'on' as const }) });
		await runAgentTurn(deps1);
		const enabledTools = mockedStreamText.mock.calls[0][0].tools as Record<string, unknown>;
		expect(Object.keys(enabledTools!)).toContain('read_checklist');
		expect(Object.keys(enabledTools!)).toContain('branch_chat');
		expect(Object.keys(enabledTools!)).toContain('toggle_checklist_item');

		vi.clearAllMocks();
		const deps2 = makeDeps({ config: makeConfig({ toolCapability: undefined }) });
		await runAgentTurn(deps2);
		const disabledTools = mockedStreamText.mock.calls[0][0].tools;
		expect(disabledTools).toEqual({});
	});

	describe('(g) safety-net', () => {
		it('APICallError 400 with tools message: disableToolsForSession called; retried with tools:{}', async () => {
			let isDisabled = false;
			mockedIsSessionDisabled.mockImplementation(() => isDisabled);
			mockedDisableToolsForSession.mockImplementation(() => {
				isDisabled = true;
			});

			const apiError = newApiError('tools not supported', 400);

			mockedStreamText
				.mockImplementationOnce(() => {
					throw apiError;
				})
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'text-delta', text: 'fallback text' },
						{ type: 'finish', finishReason: 'stop' }
					])
				} as never);

			const deps = makeDeps({
				config: makeConfig({ toolCapability: 'on' as const })
			});

			const result = await runAgentTurn(deps);

			expect(result).toEqual({ aborted: false });
			expect(mockedDisableToolsForSession).toHaveBeenCalledOnce();
			expect(deps.appendAssistantText).toHaveBeenCalledOnce();
			expect(deps.appendAssistantText).toHaveBeenCalledWith('fallback text', {
				reasoning: undefined
			});

			const retryCall = mockedStreamText.mock.calls[1][0];
			expect(retryCall.tools).toEqual({});
		});

		it('second qualifying error does NOT retry again (isSessionDisabled true from start)', async () => {
			mockedIsSessionDisabled.mockReturnValue(true);
			const apiError = newApiError('tools not supported', 400);

			mockedStreamText.mockImplementation(() => {
				throw apiError;
			});

			const deps = makeDeps({
				config: makeConfig({ toolCapability: 'on' as const })
			});

			await expect(runAgentTurn(deps)).rejects.toThrow(apiError);
			expect(mockedDisableToolsForSession).not.toHaveBeenCalled();
		});
	});

	it('(h) high approved: requestApproval called; toolsRun runs; result persisted', async () => {
		mockedStreamText
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{
						type: 'tool-call',
						toolCallId: 'tc1',
						toolName: 'branch_chat',
						args: { topic: 'Deep dive' }
					},
					{ type: 'finish', finishReason: 'tool-calls' }
				])
			} as never)
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'Branched!' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

		const approvalFn = vi.fn(async () => ({ approved: true }));
		mockedToolsRun.mockResolvedValue({
			ok: true,
			summary: 'Branched "Deep dive"',
			detail: { artifact: { kind: 'chat', id: 'child-1' } }
		});

		const deps = makeDeps({ requestApproval: approvalFn });
		const result = await runAgentTurn(deps);

		expect(result).toEqual({ aborted: false });
		expect(approvalFn).toHaveBeenCalledOnce();
		expect(approvalFn).toHaveBeenCalledWith({
			toolCallId: 'tc1',
			toolName: 'branch_chat',
			description: 'Branch a chat',
			args: { topic: 'Deep dive' }
		});
		expect(mockedToolsRun).toHaveBeenCalledWith(
			'branch_chat',
			{ topic: 'Deep dive' },
			expect.any(Object)
		);
		expect(deps.appendToolResult).toHaveBeenCalledOnce();
		expect(deps.appendToolResult).toHaveBeenCalledWith(
			expect.objectContaining({ summary: 'Branched "Deep dive"' })
		);
	});

	it('(i) high declined: requestApproval → declined; toolsRun NOT called; result persisted as declined', async () => {
		mockedStreamText
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'tool-call', toolCallId: 'tc1', toolName: 'branch_chat', args: {} },
					{ type: 'finish', finishReason: 'tool-calls' }
				])
			} as never)
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'Okay, continuing.' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

		const deps = makeDeps({
			requestApproval: vi.fn(async () => ({ approved: false }))
		});

		const result = await runAgentTurn(deps);

		expect(result).toEqual({ aborted: false });
		expect(deps.requestApproval).toHaveBeenCalledOnce();
		expect(mockedToolsRun).not.toHaveBeenCalled();
		expect(deps.appendToolResult).toHaveBeenCalledOnce();
		expect(deps.appendToolResult).toHaveBeenCalledWith(
			expect.objectContaining({ summary: 'user declined' })
		);
	});

	it('(j) two parallel high: both requestApproval fire; approve one, decline other; results in emitted order', async () => {
		mockedStreamText
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'tool-call', toolCallId: 'tc1', toolName: 'branch_chat', args: { topic: 'A' } },
					{ type: 'tool-call', toolCallId: 'tc2', toolName: 'branch_chat', args: { topic: 'B' } },
					{ type: 'finish', finishReason: 'tool-calls' }
				])
			} as never)
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'Done' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

		const approvalPromise = (approved: boolean) =>
			new Promise<{ approved: boolean; aborted?: boolean }>((r) => {
				setTimeout(() => r({ approved }), 10);
			});

		const deps = makeDeps({
			requestApproval: vi.fn(async (req) => {
				if (req.toolCallId === 'tc1') return approvalPromise(true);
				return approvalPromise(false);
			})
		});

		mockedToolsRun.mockResolvedValue({ ok: true, summary: 'ok' });

		const result = await runAgentTurn(deps);
		expect(result).toEqual({ aborted: false });
		expect(deps.requestApproval).toHaveBeenCalledTimes(2);
		expect(mockedToolsRun).toHaveBeenCalledTimes(1);
		expect(deps.appendToolResult).toHaveBeenCalledTimes(2);

		const resultCalls = (deps.appendToolResult as ReturnType<typeof vi.fn>).mock.calls;
		expect(resultCalls[0][0]).toHaveProperty('toolCallId', 'tc1');
		expect(resultCalls[1][0]).toHaveProperty('toolCallId', 'tc2');
	});

	it('(k) low auto-run: notifyLowRisk called with summary; no requestApproval; result persisted', async () => {
		mockedStreamText
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{
						type: 'tool-call',
						toolCallId: 'tc1',
						toolName: 'toggle_checklist_item',
						args: { labId: 'l1', itemId: 'i1' }
					},
					{ type: 'finish', finishReason: 'tool-calls' }
				])
			} as never)
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'Toggled!' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

		const lowNotify = vi.fn();
		mockedToolsRun.mockResolvedValue({ ok: true, summary: 'Step 1: checked' });

		const deps = makeDeps({ notifyLowRisk: lowNotify });
		const result = await runAgentTurn(deps);

		expect(result).toEqual({ aborted: false });
		expect(deps.requestApproval).not.toHaveBeenCalled();
		expect(lowNotify).toHaveBeenCalledWith('toggle_checklist_item', 'Step 1: checked');
		expect(mockedToolsRun).toHaveBeenCalledOnce();
		expect(deps.appendToolResult).toHaveBeenCalledOnce();
	});

	it('(l) invalid args: tool returns {ok:false}; result persisted; no crash', async () => {
		mockedStreamText
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{
						type: 'tool-call',
						toolCallId: 'tc1',
						toolName: 'toggle_checklist_item',
						args: {}
					},
					{ type: 'finish', finishReason: 'tool-calls' }
				])
			} as never)
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'Oops' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

		mockedToolsRun.mockResolvedValue({ ok: false, summary: 'missing labId or itemId' });

		const deps = makeDeps();
		const result = await runAgentTurn(deps);

		expect(result).toEqual({ aborted: false });
		expect(deps.appendToolResult).toHaveBeenCalledOnce();
		expect(deps.appendToolResult).toHaveBeenCalledWith(
			expect.objectContaining({ summary: 'missing labId or itemId' })
		);
	});

	it('(m) abort during approval: signal aborted while card pending → resolved as aborted', async () => {
		const ac = new AbortController();
		let resolveApproval!: (v: { approved: boolean; aborted?: boolean }) => void;
		const approvalPromise = new Promise<{ approved: boolean; aborted?: boolean }>((r) => {
			resolveApproval = r;
		});

		mockedStreamText.mockReturnValue({
			fullStream: scriptedFullStream([
				{ type: 'tool-call', toolCallId: 'tc1', toolName: 'branch_chat', args: {} },
				{ type: 'finish', finishReason: 'tool-calls' }
			])
		} as never);

		const deps = makeDeps({
			signal: ac.signal,
			requestApproval: vi.fn(async () => approvalPromise)
		});

		const turnP = runAgentTurn(deps);
		await vi.waitFor(() => expect(deps.requestApproval).toHaveBeenCalled());
		ac.abort();
		resolveApproval({ approved: false, aborted: true });

		const result = await turnP;
		expect(result).toEqual({ aborted: true });
		expect(deps.appendToolResult).toHaveBeenCalledOnce();
		expect(deps.appendToolResult).toHaveBeenCalledWith(
			expect.objectContaining({ summary: 'aborted' })
		);
	});

	describe('(o–s) generative tools', () => {
		it('(o) manifest: create_quiz appears in enabled tools', async () => {
			mockedStreamText.mockReturnValue({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'Hi' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

			const deps = makeDeps({ config: makeConfig({ toolCapability: 'on' as const }) });
			await runAgentTurn(deps);
			const enabledTools = mockedStreamText.mock.calls[0][0].tools as Record<string, unknown>;
			expect(Object.keys(enabledTools!)).toContain('create_quiz');
		});

		it('(p) first generative approved runs: budget maxSubCalls===1; model/config forwarded; result persisted', async () => {
			mockedStreamText
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'tool-call', toolCallId: 'tc1', toolName: 'create_quiz', args: {} },
						{ type: 'finish', finishReason: 'tool-calls' }
					])
				} as never)
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'text-delta', text: 'Created!' },
						{ type: 'finish', finishReason: 'stop' }
					])
				} as never);

			mockedToolsRun.mockResolvedValue({
				ok: true,
				summary: 'Created quiz (3 questions)',
				detail: { artifact: { kind: 'quiz', id: 'q1' } }
			});

			const deps = makeDeps({
				requestApproval: vi.fn(async () => ({ approved: true }))
			});
			const result = await runAgentTurn(deps);

			expect(result).toEqual({ aborted: false });
			expect(mockedToolsRun).toHaveBeenCalledOnce();
			expect(mockedToolsRun).toHaveBeenCalledWith(
				'create_quiz',
				{},
				expect.objectContaining({
					chatId: 'chat-1',
					rootChatId: 'chat-1',
					budget: expect.objectContaining({ maxSubCalls: 1, subCalls: 1 }),
					model: deps.model,
					config: deps.config
				})
			);
			expect(deps.appendToolResult).toHaveBeenCalledOnce();
		});

		it('(q) cap-depth-one enforced: two create_quiz → first runs, second synthesized as cap; both persisted', async () => {
			mockedStreamText
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'tool-call', toolCallId: 'tc1', toolName: 'create_quiz', args: {} },
						{ type: 'tool-call', toolCallId: 'tc2', toolName: 'create_quiz', args: {} },
						{ type: 'finish', finishReason: 'tool-calls' }
					])
				} as never)
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'text-delta', text: 'Only one.' },
						{ type: 'finish', finishReason: 'stop' }
					])
				} as never);

			mockedToolsRun.mockResolvedValue({
				ok: true,
				summary: 'Created quiz (3 questions)',
				detail: { artifact: { kind: 'quiz', id: 'q1' } }
			});

			const deps = makeDeps({
				requestApproval: vi.fn(async () => ({ approved: true }))
			});
			const result = await runAgentTurn(deps);

			expect(result).toEqual({ aborted: false });
			expect(mockedToolsRun).toHaveBeenCalledOnce();
			expect(deps.appendToolResult).toHaveBeenCalledTimes(2);

			const resultCalls = (deps.appendToolResult as ReturnType<typeof vi.fn>).mock.calls;
			expect(resultCalls[0][0]).toHaveProperty('toolCallId', 'tc1');
			expect(resultCalls[0][0]).toHaveProperty('summary', 'Created quiz (3 questions)');
			expect(resultCalls[1][0]).toHaveProperty('toolCallId', 'tc2');
			expect(resultCalls[1][0]).toHaveProperty('summary', 'one generative action per turn');
		});

		it('(r) refused then continue: declined generative → loop proceeds; next iteration text-only', async () => {
			mockedStreamText
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'tool-call', toolCallId: 'tc1', toolName: 'create_quiz', args: {} },
						{ type: 'finish', finishReason: 'tool-calls' }
					])
				} as never)
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'text-delta', text: 'Continuing without quiz.' },
						{ type: 'finish', finishReason: 'stop' }
					])
				} as never);

			const deps = makeDeps({
				requestApproval: vi.fn(async () => ({ approved: false }))
			});
			const result = await runAgentTurn(deps);

			expect(result).toEqual({ aborted: false });
			expect(mockedToolsRun).not.toHaveBeenCalled();
			expect(deps.appendToolResult).toHaveBeenCalledOnce();
			expect(deps.appendToolResult).toHaveBeenCalledWith(
				expect.objectContaining({ summary: 'user declined' })
			);
			expect(deps.appendAssistantText).toHaveBeenCalledOnce();
			expect(deps.appendAssistantText).toHaveBeenCalledWith('Continuing without quiz.', {
				reasoning: undefined
			});
		});

		it('(s) non-generative high tool unaffected: branch_chat + create_quiz → both approved; branch not budget-gated', async () => {
			mockedStreamText
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'tool-call', toolCallId: 'tc1', toolName: 'branch_chat', args: { topic: 'A' } },
						{ type: 'tool-call', toolCallId: 'tc2', toolName: 'create_quiz', args: {} },
						{ type: 'finish', finishReason: 'tool-calls' }
					])
				} as never)
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'text-delta', text: 'Done.' },
						{ type: 'finish', finishReason: 'stop' }
					])
				} as never);

			mockedToolsRun
				.mockResolvedValueOnce({ ok: true, summary: 'Branched' })
				.mockResolvedValueOnce({ ok: true, summary: 'Created quiz' });

			const deps = makeDeps({
				requestApproval: vi.fn(async () => ({ approved: true }))
			});
			const result = await runAgentTurn(deps);

			expect(result).toEqual({ aborted: false });
			expect(mockedToolsRun).toHaveBeenCalledTimes(2);
			expect(deps.appendToolResult).toHaveBeenCalledTimes(2);
			expect(deps.requestApproval).toHaveBeenCalledTimes(2);
		});
	});

	describe('(t) reasoning', () => {
		it('reasoning-delta parts are accumulated and passed on final persist; interim tool-text omit reasoning', async () => {
			mockedStreamText
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'reasoning-delta', text: 'thinking' },
						{ type: 'reasoning-delta', text: '…' },
						{ type: 'text-delta', text: 'pre-tool text' },
						{ type: 'finish', finishReason: 'tool-calls' },
						{ type: 'tool-call', toolCallId: 'tc1', toolName: 'read_checklist', args: {} }
					])
				} as never)
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'reasoning-delta', text: 'more' },
						{ type: 'text-delta', text: 'Final reply' },
						{ type: 'finish', finishReason: 'stop' }
					])
				} as never);

			mockedToolsRun.mockResolvedValue({ ok: true, summary: 'ok' });

			const deps = makeDeps();
			const result = await runAgentTurn(deps);

			expect(result).toEqual({ aborted: false });
			expect(deps.updateReasoningBuffer).toHaveBeenCalled();

			const allCalls = (deps.appendAssistantText as ReturnType<typeof vi.fn>).mock.calls;
			const interimCall = allCalls.find((c) => c[0] === 'pre-tool text');
			expect(interimCall).toBeDefined();
			expect(interimCall![1]?.reasoning).toBeUndefined();

			const finalCall = allCalls.find((c) => c[0] === 'Final reply');
			expect(finalCall).toBeDefined();
			expect(finalCall![1]?.reasoning).toContain('thinking…');
			expect(finalCall![1]?.reasoning).toContain('more');
		});

		it('text-only turn with reasoning: reasoning passed on final persist', async () => {
			mockedStreamText.mockReturnValue({
				fullStream: scriptedFullStream([
					{ type: 'reasoning-delta', text: 'hmm' },
					{ type: 'text-delta', text: 'Reply' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

			const deps = makeDeps();
			await runAgentTurn(deps);

			expect(deps.appendAssistantText).toHaveBeenCalledOnce();
			const call = (deps.appendAssistantText as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(call[0]).toBe('Reply');
			expect(call[1]?.reasoning).toBe('hmm');
		});

		it('turn without reasoning: opts.reasoning is undefined', async () => {
			mockedStreamText.mockReturnValue({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'No reasoning' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

			const deps = makeDeps();
			await runAgentTurn(deps);

			expect(deps.appendAssistantText).toHaveBeenCalledOnce();
			const call = (deps.appendAssistantText as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(call[1]?.reasoning).toBeUndefined();
		});
	});

	describe('(u) terminal tools', () => {
		it('terminal tool ends the turn with no second streamText call', async () => {
			mockedStreamText.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'reasoning-delta', text: 'thinking…' },
					{ type: 'text-delta', text: 'prose' },
					{
						type: 'tool-call',
						toolCallId: 'tc1',
						toolName: 'present_choices',
						args: { nextUnit: 'Unit 2', options: ['continue', 'go deeper'], progress: 'Unit 2 / 5' }
					},
					{ type: 'finish', finishReason: 'tool-calls' }
				])
			} as never);

			mockedToolsRun.mockResolvedValue({ ok: true, summary: 'Next: Unit 2 (continue, go deeper)' });

			const deps = makeDeps();
			const result = await runAgentTurn(deps);

			expect(result).toEqual({ aborted: false });
			expect(mockedStreamText).toHaveBeenCalledOnce();
			expect(deps.appendAssistantText).toHaveBeenCalledOnce();
			expect(deps.appendAssistantText).toHaveBeenCalledWith('prose', {
				reasoning: 'thinking…'
			});
			expect(deps.appendAssistantToolCall).toHaveBeenCalledOnce();
			expect(mockedToolsRun).toHaveBeenCalledOnce();
		});

		it('mixed terminal + non-terminal does not short-circuit', async () => {
			mockedStreamText
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'tool-call', toolCallId: 'tc1', toolName: 'read_checklist', args: {} },
						{ type: 'tool-call', toolCallId: 'tc2', toolName: 'present_choices', args: {} },
						{ type: 'finish', finishReason: 'tool-calls' }
					])
				} as never)
				.mockReturnValueOnce({
					fullStream: scriptedFullStream([
						{ type: 'text-delta', text: 'Follow-up' },
						{ type: 'finish', finishReason: 'stop' }
					])
				} as never);

			mockedToolsRun.mockResolvedValue({ ok: true, summary: 'ok' });

			const deps = makeDeps();
			const result = await runAgentTurn(deps);

			expect(result).toEqual({ aborted: false });
			expect(mockedStreamText).toHaveBeenCalledTimes(2);
		});
	});
});

function mockedAppendAssistantTextContent(deps: AgentTurnDeps): string {
	return (deps.appendAssistantText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
}

describe('disabledToolIds filtering', () => {
	it('excludes specified tool from SDK tools object and trace toolNames', async () => {
		mockedStreamText.mockReturnValue({
			fullStream: scriptedFullStream([
				{ type: 'text-delta', text: 'Hi' },
				{ type: 'finish', finishReason: 'stop' }
			])
		} as never);

		const traceCapture: Array<{ tools: string[] }> = [];
		const deps = makeDeps({
			config: makeConfig({ toolCapability: 'on' as const }),
			disabledToolIds: ['branch_chat'],
			onTrace: (e) => {
				if (e.kind === 'request' && e.tools) {
					traceCapture.push({ tools: e.tools as string[] });
				}
			}
		});
		await runAgentTurn(deps);

		const enabledTools = mockedStreamText.mock.calls[0][0].tools as Record<string, unknown>;
		expect(Object.keys(enabledTools!)).not.toContain('branch_chat');
		expect(Object.keys(enabledTools!)).toContain('read_checklist');
		expect(Object.keys(enabledTools!)).toContain('create_quiz');

		expect(traceCapture).toHaveLength(1);
		expect(traceCapture[0].tools).not.toContain('branch_chat');
		expect(traceCapture[0].tools).toContain('read_checklist');
	});

	it('empty or undefined disabledToolIds has no effect', async () => {
		mockedStreamText.mockReturnValue({
			fullStream: scriptedFullStream([
				{ type: 'text-delta', text: 'Hi' },
				{ type: 'finish', finishReason: 'stop' }
			])
		} as never);

		const deps = makeDeps({ config: makeConfig({ toolCapability: 'on' as const }) });
		await runAgentTurn(deps);

		const enabledTools = mockedStreamText.mock.calls[0][0].tools as Record<string, unknown>;
		expect(Object.keys(enabledTools!)).toContain('branch_chat');
		expect(Object.keys(enabledTools!)).toHaveLength(5);
	});
});

describe('generative buf suppression + chip', () => {
	it('generative tool call suppresses pre-tool buf; clears stream buffer; signals chip', async () => {
		mockedStreamText
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'Here is a quiz for you:' },
					{ type: 'tool-call', toolCallId: 'tc1', toolName: 'create_quiz', args: {} },
					{ type: 'finish', finishReason: 'tool-calls' }
				])
			} as never)
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'Quiz created. Check it out.' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

		mockedToolsRun.mockResolvedValue({
			ok: true,
			summary: 'Created quiz (3 questions)',
			detail: { artifact: { kind: 'quiz', id: 'q1' } }
		});

		const notifyGenerativeStatus = vi.fn();
		const deps = makeDeps({
			requestApproval: vi.fn(async () => ({ approved: true })),
			notifyGenerativeStatus
		});
		await runAgentTurn(deps);

		expect(deps.appendAssistantText).not.toHaveBeenCalledWith(
			'Here is a quiz for you:',
			expect.anything()
		);
		const bufferCalls = (deps.updateStreamBuffer as ReturnType<typeof vi.fn>).mock.calls;
		const lastClearIdx = bufferCalls.findLastIndex((c: unknown[]) => c[0] === '');
		expect(lastClearIdx).toBeGreaterThanOrEqual(0);
		expect(deps.appendAssistantText).toHaveBeenCalledTimes(1);
		expect(deps.appendAssistantText).toHaveBeenCalledWith('Quiz created. Check it out.', {
			reasoning: undefined
		});

		expect(notifyGenerativeStatus).toHaveBeenCalledWith({
			toolName: 'create_quiz',
			label: 'Creating your quiz…'
		});
		expect(notifyGenerativeStatus).toHaveBeenLastCalledWith(null);
	});

	it('non-generative tool call does NOT suppress buf', async () => {
		mockedStreamText
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'Some preamble' },
					{ type: 'tool-call', toolCallId: 'tc1', toolName: 'branch_chat', args: {} },
					{ type: 'finish', finishReason: 'tool-calls' }
				])
			} as never)
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'Branched.' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

		mockedToolsRun.mockResolvedValue({
			ok: true,
			summary: 'Branched',
			detail: { artifact: { kind: 'chat', id: 'c2' } }
		});

		const notifyGenerativeStatus = vi.fn();
		const deps = makeDeps({
			requestApproval: vi.fn(async () => ({ approved: true })),
			notifyGenerativeStatus
		});
		await runAgentTurn(deps);

		const calls = (deps.appendAssistantText as ReturnType<typeof vi.fn>).mock.calls;
		expect(calls[0][0]).toBe('Some preamble');
		expect(notifyGenerativeStatus).not.toHaveBeenCalled();
	});

	it('declined generative tool clears chip; buf suppressed', async () => {
		mockedStreamText
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'Let me make a quiz' },
					{ type: 'tool-call', toolCallId: 'tc1', toolName: 'create_quiz', args: {} },
					{ type: 'finish', finishReason: 'tool-calls' }
				])
			} as never)
			.mockReturnValueOnce({
				fullStream: scriptedFullStream([
					{ type: 'text-delta', text: 'OK, no quiz then.' },
					{ type: 'finish', finishReason: 'stop' }
				])
			} as never);

		const notifyGenerativeStatus = vi.fn();
		const deps = makeDeps({
			requestApproval: vi.fn(async () => ({ approved: false })),
			notifyGenerativeStatus
		});
		await runAgentTurn(deps);

		expect(deps.appendAssistantText).not.toHaveBeenCalledWith(
			'Let me make a quiz',
			expect.anything()
		);
		expect(notifyGenerativeStatus).toHaveBeenCalledWith(null);
	});
});

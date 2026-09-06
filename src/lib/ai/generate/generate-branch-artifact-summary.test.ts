import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';

vi.mock('ai', () => ({
	generateText: vi.fn()
}));
vi.mock('$lib/ai/client', () => ({
	getActiveSdkProvider: vi.fn()
}));
vi.mock('$lib/ai/dialects', () => ({
	resolveRequestSettings: vi.fn(() => ({
		callSettings: {},
		providerOptions: {},
		droppedExtraKeys: []
	}))
}));
vi.mock('$lib/chat/context', () => ({
	assembleContext: vi.fn(async (chatId: string) => [
		{ role: 'user' as const, content: `parent context for ${chatId}` },
		{ role: 'assistant' as const, content: "the branch's big reply" }
	])
}));
vi.mock('$lib/db', () => ({
	repos: {
		agentTraces: {
			create: vi.fn(async (row: { id: string }) => ({ ...row, id: row.id || 'trace-1' }))
		}
	}
}));

const { generateText } = await import('ai');
const mockedGenerateText = vi.mocked(generateText);
const { getActiveSdkProvider } = await import('$lib/ai/client');
const mockedGetActiveSdkProvider = vi.mocked(getActiveSdkProvider);
const { repos } = await import('$lib/db');

describe('generateBranchArtifactSummary', () => {
	beforeEach(() => {
		mockedGenerateText.mockReset();
		mockedGetActiveSdkProvider.mockResolvedValue({
			model: {} as LanguageModel,
			config: { kind: 'openai-compatible', defaultModel: 'test-model' }
		} as never);
	});

	it('anchors the task as the TRAILING user turn after the transcript', async () => {
		mockedGenerateText.mockResolvedValue({ text: 'summary' } as never);
		await import('./generate-branch-artifact-summary').then((m) =>
			m.generateBranchArtifactSummary('branch-1')
		);
		const call = mockedGenerateText.mock.calls[0][0];
		const messages = call.messages as Array<{ role: string; content: string }>;
		expect(messages.at(-1)!.role).toBe('user');
		expect(messages.at(-1)!.content).toContain('handoff summary');
		// The transcript itself precedes the task.
		expect(messages.at(-2)!.role).toBe('assistant');
		expect(messages.at(-2)!.content).toBe("the branch's big reply");
	});

	it('task demands the branch delta only: facts exact, narration dropped', async () => {
		mockedGenerateText.mockResolvedValue({ text: 'summary' } as never);
		await import('./generate-branch-artifact-summary').then((m) =>
			m.generateBranchArtifactSummary('branch-1')
		);
		const call = mockedGenerateText.mock.calls[0][0];
		const task = (call.messages as Array<{ content: string }>).at(-1)!.content;
		// Load-bearing facts survive verbatim — corrections are the payload.
		expect(task).toContain('Corrections and reversals');
		expect(task).toContain('Preserve these verbatim');
		expect(task).toContain('fenced code snippet');
		// Narration and echo are the things we cut.
		expect(task).toContain('Exploratory narration');
		expect(task).toContain('Turn-by-turn recaps');
		expect(task).toContain('never for load-bearing facts');
		// No hard word ceiling: the budget is relevance, not length.
		expect(task).not.toContain('words');
	});

	it('system prompt carries only the role framing, not the full task', async () => {
		mockedGenerateText.mockResolvedValue({ text: 'summary' } as never);
		await import('./generate-branch-artifact-summary').then((m) =>
			m.generateBranchArtifactSummary('branch-1')
		);
		const call = mockedGenerateText.mock.calls[0][0];
		expect(call.system).toContain('handoff note');
		expect(call.system).not.toContain('120 words');
	});

	it('returns the summary text and the persisted trace id', async () => {
		mockedGenerateText.mockResolvedValue({ text: 'a real summary' } as never);
		const { generateBranchArtifactSummary } = await import('./generate-branch-artifact-summary');
		const out = await generateBranchArtifactSummary('branch-1');
		expect(out.summary).toBe('a real summary');
		expect(out.traceId).toBe('trace-1');
		expect(repos.agentTraces.create).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'branch_artifact_summary', chatId: 'branch-1' })
		);
	});

	it('passes maxRetries 0 and the abort signal, and throws on failure', async () => {
		const ac = new AbortController();
		mockedGenerateText.mockRejectedValueOnce(new Error('provider down'));
		const { generateBranchArtifactSummary } = await import('./generate-branch-artifact-summary');
		await expect(generateBranchArtifactSummary('branch-1', ac.signal)).rejects.toThrow(
			'provider down'
		);
		expect(mockedGenerateText).toHaveBeenCalledWith(
			expect.objectContaining({ maxRetries: 0, abortSignal: ac.signal })
		);
	});
});

/**
 * Chat session store (architecture.md §4–5, P2).
 *
 * A runes-class singleton mirroring `stores/db.svelte.ts` / `theme.svelte.ts`.
 * Owns the conversation view's state: the active chat, its messages, the live
 * stream buffer, and branching helpers. Components/routes import `chatStore`
 * and call `load(chatId)` on navigation.
 *
 * Persistence decision (plan): the user row is appended immediately; assistant
 * tokens accumulate in `streamBuffer` and are persisted on finish/Stop. A
 * reload mid-stream loses the in-flight turn (accepted).
 *
 * Error handling mirrors `StreamDemo`: `AbortError` is swallowed; everything
 * else goes through `formatProviderError` into the `error` state.
 */
import { browser } from '$app/environment';
import { repos } from '$lib/db';
import type { Chat, Message } from '$lib/db/schema';
import { assembleContext } from '$lib/chat/context';
import type { ResolvedOffsets } from '$lib/chat/selection';
import {
	selectionOverlapsExisting,
	serializeAddFormats,
	type ExpoundOptions
} from '$lib/chat/expound';
import type { LearningBrief } from '$lib/chat/brief';
import { parseBrief, disabledToolsForBrief } from '$lib/chat/brief';
import { getActiveSdkProvider } from '$lib/ai/client';
import { mapSdkError } from '$lib/ai/sdk-errors';
import { formatProviderError, type FormattedProviderError } from '$lib/ai/errors';
import type { ChatMessage, ProviderConfig, ReasoningEffort } from '$lib/ai/types';
import type { LanguageModel } from 'ai';
import { runAgentTurn } from '$lib/agent/loop';
import { getToolDefinitions } from '$lib/agent/registry';
import { generateTitle, DEFAULT_TITLE } from '$lib/ai/generate/generate-title';
import { generateBrief } from '$lib/ai/generate/generate-brief';
import { toastState } from '$lib/stores/toasts.svelte';
import { TraceBuilder, buildObjectTrace, type ObjectTraceInput } from '$lib/agent/trace';
import { diagnosticsStore } from '$lib/stores/diagnostics.svelte';

function isAbortError(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'AbortError';
}

export interface ApprovalEntry {
	toolCallId: string;
	toolName: string;
	description: string;
	args: unknown;
	resolve: (decision: { approved: boolean; aborted?: boolean }) => void;
}

export type PublicApprovalEntry = Omit<ApprovalEntry, 'resolve'>;

export interface McpSamplingEntry {
	id: string;
	serverName: string;
	prompt: string;
	maxTokens: number;
	remainingBudget: number;
	resolve: (approved: boolean) => void;
}

export type PublicMcpSamplingEntry = Omit<McpSamplingEntry, 'resolve'>;

export interface ElicitationEntry {
	id: string;
	serverName: string;
	schema: Record<string, unknown>;
	message: string;
	resolve: (outcome: { accepted: boolean; data?: Record<string, unknown> }) => void;
}

export type PublicElicitationEntry = Omit<ElicitationEntry, 'resolve'>;

/**
 * Raised when an expound excerpt overlaps an existing span for the same source
 * message (a word can't belong to two expounds; one branch per excerpt falls
 * out of the same check). Defense-in-depth — the context menu already disables
 * "Expound…". Surfaced by the route via `chatStore.error`.
 */
export class ExcerptOverlapError extends Error {
	constructor(message = 'That excerpt already belongs to an expound branch.') {
		super(message);
		this.name = 'ExcerptOverlapError';
	}
}

class ChatState {
	chatId = $state<string | null>(null);
	chat = $state<Chat | null>(null);
	messages = $state<Message[]>([]);
	streaming = $state(false);
	streamBuffer = $state('');
	streamBufferRender = $state('');
	reasoningBuffer = $state('');
	error = $state<FormattedProviderError | null>(null);
	lastFailedPrompt = $state<string | null>(null);
	loading = $state(false);
	generativeStatus = $state<{ toolName: string; label: string } | null>(null);

	/**
	 * A prompt staged to auto-send once the next branch finishes loading. Set by
	 * `createExpoundBranch`; drained by the route's `loadAll` after navigation so
	 * the first user message + stream lands on the freshly-opened branch.
	 */
	pendingPrompt = $state<{ text: string; hidden?: boolean } | null>(null);

	private controller: AbortController | null = null;
	/** Separate abort for the parallel first-message title request. */
	private titleController: AbortController | null = null;
	private titling = false;
	private rafId: number | null = null;

	private startRenderFlush() {
		const tick = () => {
			this.streamBufferRender = this.streamBuffer;
			if (this.streaming) this.rafId = requestAnimationFrame(tick);
			else this.rafId = null;
		};
		this.rafId = requestAnimationFrame(tick);
	}

	inferredBrief = $state<LearningBrief | null>(null);
	private inferring = false;
	private inferDismissed = false;
	private inferController: AbortController | null = null;

	pendingApprovals = $state<ApprovalEntry[]>([]);

	pendingMcpSampling = $state<McpSamplingEntry[]>([]);

	pendingElicitations = $state<ElicitationEntry[]>([]);

	/** First-turn-only: suppress `branch_chat` after a manual branch (UX1a). */
	manualBranchPending = $state<boolean>(false);

	/** True when the live assistant bubble should render (buffer non-empty while streaming). */
	get showLiveBubble(): boolean {
		return this.streaming && this.streamBufferRender.length > 0;
	}

	/**
	 * Load a chat and its messages into the store. Fully resets transient state
	 * so switching chats never leaks a previous conversation's buffer/error.
	 */
	async load(chatId: string): Promise<void> {
		// Abort any in-flight stream AND title request for the previous chat.
		this.stop();
		this.titleController?.abort();
		this.inferController?.abort();
		this.inferredBrief = null;
		this.inferDismissed = false;
		this.inferring = false;
		this.loading = true;
		this.error = null;
		this.streamBuffer = '';
		this.streamBufferRender = '';
		this.reasoningBuffer = '';
		this.streaming = false;
		this.generativeStatus = null;
		this.chatId = chatId;
		try {
			const [chat, msgs] = await Promise.all([
				repos.chats.getById(chatId),
				repos.messages.listByChat(chatId)
			]);
			this.chat = chat;
			this.messages = msgs;
		} catch (err) {
			this.chat = null;
			this.messages = [];
			this.error = {
				title: 'Could not load chat',
				message: err instanceof Error ? err.message : String(err)
			};
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Create a fresh root chat and return its id (the caller navigates to it).
	 * When `brief` is provided it is authored on the root; omitting it (or the
	 * "Just start chatting" escape) creates a brief-less chat — exactly today's
	 * behavior, so `assembleContext` emits no system note.
	 */
	async createAndNavigate(opts?: { title?: string; brief?: LearningBrief }): Promise<string> {
		const chat = await repos.chats.createRoot({
			title: opts?.title ?? DEFAULT_TITLE,
			brief: opts?.brief ?? null
		});
		return chat.id;
	}

	/**
	 * Set (or replace) the brief on the current root chat and reflect it in the
	 * store. No streaming impact — the new framing applies to the next
	 * `assembleContext`. Editable from the collapsed summary chip (root only).
	 */
	async saveBrief(brief: LearningBrief): Promise<void> {
		const chat = this.chat;
		if (!chat) return;
		await repos.chats.updateBrief(chat.id, brief);
		this.chat = { ...chat, brief: JSON.stringify(brief) };
	}

	/** Send a user prompt and stream the assistant reply, persisting on finish. */
	async send(text: string, opts?: { effort?: ReasoningEffort; hidden?: boolean }): Promise<void> {
		const prompt = text.trim();
		if (!prompt || this.streaming || !this.chatId) return;

		this.error = null;
		const chatId = this.chatId;
		const effort: ReasoningEffort = opts?.effort ?? 'on';
		const hidden = opts?.hidden ?? false;
		const chat = this.chat;
		// A root that still holds the placeholder title and has no prior turns:
		// this is the first real message → fire the parallel title request.
		const isFirstRootTurn =
			chat !== null &&
			chat.parentId === null &&
			chat.title === DEFAULT_TITLE &&
			!this.messages.some((m) => m.role === 'user' || m.role === 'assistant');

		const rootBriefRaw =
			chat?.parentId === null
				? chat.brief
				: chat
					? await repos.chats.getById(chat.rootId).then((r) => r?.brief ?? null)
					: null;

		// 1) Persist the user row immediately and reflect it in the UI.
		const userRow = await repos.messages.append(chatId, 'user', prompt, {
			metadata: hidden ? JSON.stringify({ hidden: true }) : undefined
		});
		this.messages = [...this.messages, userRow];
		await repos.chats.touch(chatId);

		// 2) Begin streaming.
		this.streaming = true;
		this.streamBuffer = '';
		this.streamBufferRender = '';
		this.reasoningBuffer = '';
		this.generativeStatus = null;
		this.controller = new AbortController();
		this.startRenderFlush();

		const builder = new TraceBuilder();
		const startTime = Date.now();
		let model: LanguageModel | undefined;
		let config: ProviderConfig | undefined;
		let mcpSession: { unmountAll: () => void } | null = null;

		try {
			const [_ctx, sdk] = await Promise.all([assembleContext(chatId), getActiveSdkProvider()]);
			model = sdk.model;
			config = sdk.config;

			if (isFirstRootTurn) {
				void this.autoTitleRoot(model, prompt);
			}

			const shouldInferBrief =
				chat && chat.parentId === null && parseBrief(chat.brief) === null && !this.inferDismissed;
			if (shouldInferBrief) {
				void this.inferBriefRoot(model, _ctx);
			}

			const toolCallCounter = { count: 0 };
			const chatMcpConfig = await repos.mcp.getChatMcpConfig(chatId);
			const enabledServers = (await repos.mcp.listServers()).filter((s) => s.enabled);
			try {
				const { connectSession } = await import('$lib/mcp/lifecycle');
				mcpSession = await connectSession(enabledServers, (e) => {
					builder.emit(e);
					diagnosticsStore.liveEmit(e);
				});
			} catch (err) {
				console.warn('[mcp] session connect failed:', err);
			}
			const mcpDisabled: string[] = [];
			for (const server of enabledServers) {
				if (chatMcpConfig === null) continue;
				const entry = chatMcpConfig[server.id];
				if (!entry) continue;
				if (entry.enabled === false) {
					const prefix = `mcp.${server.id}.`;
					for (const def of getToolDefinitions()) {
						if (def.id.startsWith(prefix)) mcpDisabled.push(def.id);
					}
				} else if (entry.tools && entry.tools.length > 0) {
					const prefix = `mcp.${server.id}.`;
					for (const def of getToolDefinitions()) {
						if (def.id.startsWith(prefix) && !entry.tools.includes(def.id)) {
							mcpDisabled.push(def.id);
						}
					}
				}
			}

			{
				const { resourceServerIds } = await import('$lib/mcp/resources');
				const enabledResourceServers = enabledServers.filter((s) => {
					if (chatMcpConfig === null || chatMcpConfig[s.id]?.enabled !== false) {
						return resourceServerIds().has(s.id);
					}
					return false;
				});
				if (enabledResourceServers.length === 0 && resourceServerIds().size > 0) {
					mcpDisabled.push('mcp_read_resource');
				}
			}

			const { aborted } = await runAgentTurn({
				model,
				config,
				chatId,
				rootChatId: chat?.rootId ?? chatId,
				signal: this.controller.signal,
				effort,
				disabledToolIds: [
					...disabledToolsForBrief(rootBriefRaw),
					...(this.manualBranchPending ? ['branch_chat'] : []),
					...mcpDisabled
				],
				firstTurn: isFirstRootTurn,
				updateStreamBuffer: (n) => (this.streamBuffer = n),
				updateReasoningBuffer: (n) => (this.reasoningBuffer = n),
				appendAssistantText: async (content, opts) => {
					const row = await repos.messages.append(chatId, 'assistant', content, {
						model: opts?.model,
						metadata: opts?.reasoning ? JSON.stringify({ reasoning: opts.reasoning }) : undefined
					});
					this.messages = [...this.messages, row];
					await repos.chats.touch(chatId);
					builder.assistantMessageId = row.id;
					builder.empty = !content;
					return row;
				},
				appendAssistantToolCall: async (p) => {
					const row = await repos.messages.append(chatId, 'assistant', '', {
						toolCallId: p.toolCallId,
						toolName: p.toolName,
						metadata: p.args != null ? JSON.stringify(p.args) : undefined
					});
					this.messages = [...this.messages, row];
					await repos.chats.touch(chatId);
					toolCallCounter.count++;
					return row;
				},
				appendToolResult: async (r) => {
					const row = await repos.messages.appendToolResult(chatId, r);
					this.messages = [...this.messages, row];
					await repos.chats.touch(chatId);
					if (r.toolName === 'save_brief') {
						const fresh = await repos.chats.getById(chatId);
						if (fresh) this.chat = fresh;
					}
					return row;
				},
				reassembleContext: () => assembleContext(chatId),
				requestApproval: (req) => this.requestApprovalImpl(req),
				notifyLowRisk: (toolLabel, summary) => this.notifyLowRiskImpl(toolLabel, summary),
				notifyGenerativeStatus: (status) => (this.generativeStatus = status),
				onTrace: (e) => {
					builder.emit(e);
					diagnosticsStore.liveEmit(e);
				}
			});

			if (!aborted && import.meta.env.DEV) {
				try {
					const rootBrief = parseBrief(chat && chat.parentId === null ? chat.brief : null);
					if (rootBrief) {
						const { strategyForBrief } = await import('$lib/chat/brief');
						const { lintTurn } = await import('$lib/dev/strategy-lint');
						const strat = strategyForBrief(rootBrief);
						const result = lintTurn(strat.id, this.streamBuffer);
						if (result.pass) {
							console.info('[strategy-lint]', result.strategy, 'PASS', result.words, 'words');
						} else {
							const failures = result.checks
								.filter((c) => !c.ok)
								.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`)
								.join(', ');
							console.warn(
								'[strategy-lint]',
								result.strategy,
								'FAIL',
								result.words,
								'words —',
								failures
							);
						}
					}
					if (toolCallCounter.count > 0) {
						console.info('[agent]', toolCallCounter.count, 'tool calls this turn');
					}
				} catch {
					/* best-effort; never throws into the chat path */
				}
			}
		} catch (err) {
			if (!isAbortError(err)) {
				this.error = formatProviderError(mapSdkError(err));
				this.lastFailedPrompt = prompt;
				builder.emit({
					kind: 'error',
					message: err instanceof Error ? `${err.name}: ${err.message}` : String(err)
				});
			}
		} finally {
			mcpSession?.unmountAll();
			for (const a of this.pendingApprovals) {
				a.resolve({ approved: false, aborted: true });
			}
			this.pendingApprovals = [];
			for (const e of this.pendingMcpSampling) {
				e.resolve(false);
			}
			this.pendingMcpSampling = [];
			for (const e of this.pendingElicitations) {
				e.resolve({ accepted: false });
			}
			this.pendingElicitations = [];
			if (this.rafId !== null) {
				cancelAnimationFrame(this.rafId);
				this.rafId = null;
			}
			this.streamBufferRender = this.streamBuffer;
			const wasAborted = this.controller?.signal.aborted ?? false;
			if (wasAborted && this.streamBuffer.trim()) {
				try {
					const row = await repos.messages.append(chatId, 'assistant', this.streamBuffer, {
						metadata: JSON.stringify({ interrupted: true })
					});
					this.messages = [...this.messages, row];
				} catch {
					/* best-effort */
				}
			}
			this.streaming = false;
			this.streamBuffer = '';
			this.streamBufferRender = '';
			this.reasoningBuffer = '';
			this.generativeStatus = null;
			this.controller = null;
			this.manualBranchPending = false;
			diagnosticsStore.endTurn();
			try {
				await repos.agentTraces.create({
					id: '',
					createdAt: startTime,
					chatId,
					assistantMessageId: builder.assistantMessageId ?? null,
					model: (model as { modelId?: string } | undefined)?.modelId ?? '',
					configKind: config?.kind ?? 'openai-compatible',
					reasoning: effort,
					durationMs: Date.now() - startTime,
					trace: builder.toJSON()
				});
			} catch {
				/* best-effort; never surfaces to user */
			}
			if (!this.error) this.lastFailedPrompt = null;
		}
	}

	/** Stop the in-flight stream (AbortError is swallowed in `send`). */
	stop(): void {
		this.controller?.abort();
	}

	/** Clear the staged expound prompt (called by the route after draining it). */
	clearPendingPrompt(): void {
		this.pendingPrompt = null;
	}

	/** Abort in-flight work and drop the active-conversation view from the store. */
	private clearActiveView(): void {
		this.stop();
		this.titleController?.abort();
		this.inferController?.abort();
		this.inferredBrief = null;
		this.inferDismissed = false;
		this.inferring = false;
		this.chat = null;
		this.chatId = null;
		this.messages = [];
		this.error = null;
		this.streamBuffer = '';
		this.streamBufferRender = '';
		this.streaming = false;
		this.generativeStatus = null;
		this.lastFailedPrompt = null;
	}

	async deleteLastDanglingUser(): Promise<void> {
		const msgs = this.messages;
		if (msgs.length === 0) return;
		const last = msgs[msgs.length - 1];
		if (last.role !== 'user') return;
		await repos.messages.delete(last.id);
		this.messages = msgs.filter((m) => m.id !== last.id);
	}

	async deleteChat(chatId: string): Promise<void> {
		await repos.chats.deleteSubtree(chatId);
		if (this.chat && (this.chat.id === chatId || this.chat.rootId === chatId)) {
			this.clearActiveView();
		}
		void repos.settings.delete('draft:' + chatId);
	}

	async deleteBranch(id: string): Promise<void> {
		await repos.chats.deleteBranch(id);
		if (this.chatId) {
			const stillThere = await repos.chats.getById(this.chatId);
			if (!stillThere) this.clearActiveView();
		}
		void repos.settings.delete('draft:' + id);
	}

	/**
	 * Best-effort: after a root chat's first message, ask the active provider for
	 * a concise title and persist it (replacing the {@link DEFAULT_TITLE}
	 * placeholder). Runs in parallel with the main assistant stream (not awaited
	 * by `send`), so the title lands before the reply finishes.
	 *
	 * Context is just the first user message (no `assembleContext` walk). The
	 * request always runs with reasoning OFF (fast, no thinking). Swallows every
	 * error so title generation can never break the chat; `titling` guards
	 * against re-entrancy while the async gen is in flight. Its own
	 * `titleController` is aborted by `load`/`deleteChat` (not by `stop`).
	 */
	private async autoTitleRoot(model: LanguageModel, firstMessage: string): Promise<void> {
		const chat = this.chat;
		if (!chat || chat.parentId !== null || chat.title !== DEFAULT_TITLE) return;
		if (this.titling) return;
		this.titling = true;
		this.titleController = new AbortController();
		let traceInput: ObjectTraceInput | null = null;
		const startTime = Date.now();
		try {
			const ctx: ChatMessage[] = [{ role: 'user', content: firstMessage }];
			const title = await generateTitle(model, ctx, {
				signal: this.titleController.signal,
				onTrace: (t) => {
					traceInput = {
						kind: 'title',
						request: t.request,
						result: t.result,
						error: t.error,
						raw: t.raw
					};
				}
			});
			if (!this.chat || this.chat.id !== chat.id || this.chat.title !== DEFAULT_TITLE) return;
			await repos.chats.updateTitle(chat.id, title);
			this.chat = { ...this.chat, title };
		} catch {
			/* best-effort; leave the placeholder title in place */
		} finally {
			this.titling = false;
			this.titleController = null;
			if (traceInput) {
				try {
					const { config } = await getActiveSdkProvider();
					await repos.agentTraces.create({
						id: '',
						createdAt: startTime,
						chatId: chat.id,
						kind: 'title',
						model: (model as { modelId?: string }).modelId ?? '',
						configKind: config.kind,
						reasoning: '',
						durationMs: Date.now() - startTime,
						trace: buildObjectTrace(traceInput)
					});
				} catch {
					/* best-effort; never surfaces */
				}
			}
		}
	}

	branchFromSelection(
		await this.saveBrief(b ?? this.inferredBrief!);
		this.inferredBrief = null;
		this.inferDismissed = false;
	}

	dismissInferredBrief(): void {
		this.inferDismissed = true;
		this.inferredBrief = null;
	}

	private requestApprovalImpl(req: {
		toolCallId: string;
		toolName: string;
		description: string;
		args: unknown;
	}): Promise<{ approved: boolean; aborted?: boolean }> {
		return new Promise((resolve) => {
			const entry: ApprovalEntry = {
				toolCallId: req.toolCallId,
				toolName: req.toolName,
				description: req.description,
				args: req.args,
				resolve
			};
			this.pendingApprovals = [...this.pendingApprovals, entry];
			const onAbort = () => {
				resolve({ approved: false, aborted: true });
				this.pendingApprovals = this.pendingApprovals.filter((a) => a !== entry);
			};
			this.controller?.signal.addEventListener('abort', onAbort, { once: true });
		});
	}

	approve(toolCallId: string): void {
		const idx = this.pendingApprovals.findIndex((a) => a.toolCallId === toolCallId);
		if (idx === -1) return;
		this.pendingApprovals[idx].resolve({ approved: true });
		this.pendingApprovals = this.pendingApprovals.filter((a) => a.toolCallId !== toolCallId);
	}

	decline(toolCallId: string): void {
		const idx = this.pendingApprovals.findIndex((a) => a.toolCallId === toolCallId);
		if (idx === -1) return;
		this.pendingApprovals[idx].resolve({ approved: false });
		this.pendingApprovals = this.pendingApprovals.filter((a) => a.toolCallId !== toolCallId);
	}

	approveSampling(id: string): void {
		const idx = this.pendingMcpSampling.findIndex((e) => e.id === id);
		if (idx === -1) return;
		this.pendingMcpSampling[idx].resolve(true);
		this.pendingMcpSampling = this.pendingMcpSampling.filter((e) => e.id !== id);
	}

	declineSampling(id: string): void {
		const idx = this.pendingMcpSampling.findIndex((e) => e.id === id);
		if (idx === -1) return;
		this.pendingMcpSampling[idx].resolve(false);
		this.pendingMcpSampling = this.pendingMcpSampling.filter((e) => e.id !== id);
	}

	submitElicitation(id: string, data: Record<string, unknown>): void {
		const idx = this.pendingElicitations.findIndex((e) => e.id === id);
		if (idx === -1) return;
		this.pendingElicitations[idx].resolve({ accepted: true, data });
		this.pendingElicitations = this.pendingElicitations.filter((e) => e.id !== id);
	}

	cancelElicitation(id: string): void {
		const idx = this.pendingElicitations.findIndex((e) => e.id === id);
		if (idx === -1) return;
		this.pendingElicitations[idx].resolve({ accepted: false });
		this.pendingElicitations = this.pendingElicitations.filter((e) => e.id !== id);
	}

	requestSamplingImpl(req: {
		id: string;
		serverName: string;
		prompt: string;
		maxTokens: number;
		remainingBudget: number;
	}): Promise<boolean> {
		return new Promise((resolve) => {
			const entry: McpSamplingEntry = { ...req, resolve };
			this.pendingMcpSampling = [...this.pendingMcpSampling, entry];
			const onAbort = () => {
				resolve(false);
				this.pendingMcpSampling = this.pendingMcpSampling.filter((e) => e !== entry);
			};
			this.controller?.signal.addEventListener('abort', onAbort, { once: true });
		});
	}

	requestElicitationImpl(req: {
		id: string;
		serverName: string;
		schema: Record<string, unknown>;
		message: string;
	}): Promise<{ accepted: boolean; data?: Record<string, unknown> }> {
		return new Promise((resolve) => {
			const entry: ElicitationEntry = {
				...req,
				resolve: (outcome) => resolve(outcome)
			};
			this.pendingElicitations = [...this.pendingElicitations, entry];
			const onAbort = () => {
				resolve({ accepted: false });
				this.pendingElicitations = this.pendingElicitations.filter((e) => e !== entry);
			};
			this.controller?.signal.addEventListener('abort', onAbort, { once: true });
		});
	}

	private notifyLowRiskImpl(toolLabel: string, summary: string): void {
		toastState.push({ title: toolLabel, description: summary });
	}

	private async inferBriefRoot(model: LanguageModel, ctx: ChatMessage[]): Promise<void> {
		const chat = this.chat;
		if (!chat || chat.parentId !== null || parseBrief(chat.brief) !== null) return;
		if (this.inferring || this.inferDismissed) return;
		this.inferring = true;
		this.inferController = new AbortController();
		let traceInput: ObjectTraceInput | null = null;
		const startTime = Date.now();
		try {
			const brief = await generateBrief(model, ctx, {
				signal: this.inferController.signal,
				onTrace: (t) => {
					traceInput = {
						kind: 'brief',
						request: t.request,
						result: t.result,
						error: t.error,
						raw: t.raw
					};
				}
			});
			if (!this.inferDismissed) {
				this.inferredBrief = brief;
			}
		} catch {
			/* best-effort */
		} finally {
			this.inferring = false;
			this.inferController = null;
			if (traceInput) {
				try {
					const { config } = await getActiveSdkProvider();
					await repos.agentTraces.create({
						id: '',
						createdAt: startTime,
						chatId: chat.id,
						kind: 'brief',
						model: (model as { modelId?: string }).modelId ?? '',
						configKind: config.kind,
						reasoning: '',
						durationMs: Date.now() - startTime,
						trace: buildObjectTrace(traceInput)
					});
				} catch {
					/* best-effort; never surfaces */
				}
			}
		}
	}

	/**
	 * Branch a child off `messageId` grounded in a highlighted excerpt, then
	 * stage `prompt` for auto-send on the new branch. Enforces one branch per
	 * excerpt / no overlapping spans (defense-in-depth; the menu already
	 * disables). Throws {@link ExcerptOverlapError} on conflict — creates no
	 * chat/branch_source row in that case. Returns the child chat id.
	 *
	 * Offsets are as resolved by `resolveSelection` against the source map
	 * (`src/lib/chat/selection.ts`); an unresolved selection disables the menu
	 * before reaching the store.
	 */
	async createExpoundBranch(
		messageId: string,
		rawContent: string,
		resolved: ResolvedOffsets,
		prompt: string,
		expoundOpts?: ExpoundOptions
	): Promise<string> {
		const existing = await repos.branchSources.listBySourceMessage(messageId);
		if (selectionOverlapsExisting(resolved, existing)) {
			throw new ExcerptOverlapError();
		}

		const childId = await this.createBranchChild(
			messageId,
			resolved.startChar,
			resolved.endChar,
			resolved.excerpt,
			expoundOpts
				? {
						customInstructions: expoundOpts.customInstructions || undefined,
						addFormats: serializeAddFormats(expoundOpts.toggles)
					}
				: undefined
		);
		this.pendingPrompt = { text: prompt, hidden: true };
		return childId;
	}

	/** Branch a child off a whole message (no span / no branch_source row). */
	async branchFromMessage(messageId: string): Promise<string> {
		if (!this.chat) throw new Error('Cannot branch: no active chat');
		this.manualBranchPending = true;
		const child = await repos.chats.createChild({
			parentId: this.chat.id,
			branchPointMessageId: messageId,
			title: branchTitle(this.chat.title)
		});
		return child.id;
	}

	private async createBranchChild(
		messageId: string,
		startChar: number,
		endChar: number,
		excerpt: string,
		extra?: { customInstructions?: string; addFormats?: string }
	): Promise<string> {
		if (!this.chat) throw new Error('Cannot branch: no active chat');
		this.manualBranchPending = true;
		const child = await repos.chats.createChild({
			parentId: this.chat.id,
			branchPointMessageId: messageId,
			title: branchTitle(this.chat.title, excerpt)
		});
		await repos.branchSources.create({
			sourceMessageId: messageId,
			startChar,
			endChar,
			excerpt,
			branchChatId: child.id,
			...extra
		});
		return child.id;
	}
}

/** Title for a branched child: first line of the excerpt, or "Branch of <root>". */
function branchTitle(parentTitle: string, excerpt?: string): string {
	if (excerpt) {
		const firstLine = excerpt
			.split('\n')
			.map((l) => l.trim())
			.find((l) => l.length > 0);
		if (firstLine) return firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;
	}
	return `Branch of ${parentTitle}`;
}

/** Singleton — the single active conversation view across the app. */
export const chatStore = new ChatState();

/**
 * Convenience for routes that only need the list of root chats (the `/chat`
 * list page). Kept outside the singleton so it doesn't compete with an active
 * conversation's loaded messages.
 */
export async function listRootChats(): Promise<Chat[]> {
	if (!browser) return [];
	return repos.chats.listRoots();
}

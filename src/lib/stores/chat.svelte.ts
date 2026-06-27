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
import { resolveSelectionOffsets, type SelectionInput } from '$lib/chat/highlight';
import { selectionOverlapsExisting } from '$lib/chat/expound';
import type { LearningBrief } from '$lib/chat/brief';
import { parseBrief } from '$lib/chat/brief';
import { generateTitle, DEFAULT_TITLE } from '$lib/ai/generate/generate-title';
import { generateBrief } from '$lib/ai/generate/generate-brief';
import type { ChatMessage, Provider, ReasoningMode } from '$lib/ai/types';
import { getActiveProvider } from '$lib/ai/client';
import { formatProviderError, type FormattedProviderError } from '$lib/ai/errors';

function isAbortError(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'AbortError';
}

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
	error = $state<FormattedProviderError | null>(null);
	loading = $state(false);

	/**
	 * A prompt staged to auto-send once the next branch finishes loading. Set by
	 * `createExpoundBranch`; drained by the route's `loadAll` after navigation so
	 * the first user message + stream lands on the freshly-opened branch.
	 */
	pendingPrompt = $state<string | null>(null);

	private controller: AbortController | null = null;
	/** Separate abort for the parallel first-message title request. */
	private titleController: AbortController | null = null;
	private titling = false;

	inferredBrief = $state<LearningBrief | null>(null);
	private inferring = false;
	private inferDismissed = false;
	private inferController: AbortController | null = null;

	/** True when the live assistant bubble should render (buffer non-empty while streaming). */
	get showLiveBubble(): boolean {
		return this.streaming && this.streamBuffer.length > 0;
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
		this.streaming = false;
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
	async send(text: string, opts?: { reasoning?: ReasoningMode }): Promise<void> {
		const prompt = text.trim();
		if (!prompt || this.streaming || !this.chatId) return;

		this.error = null;
		const chatId = this.chatId;
		const reasoning: ReasoningMode = opts?.reasoning ?? 'auto';
		const chat = this.chat;
		// A root that still holds the placeholder title and has no prior turns:
		// this is the first real message → fire the parallel title request.
		const isFirstRootTurn =
			chat !== null &&
			chat.parentId === null &&
			chat.title === DEFAULT_TITLE &&
			!this.messages.some((m) => m.role === 'user' || m.role === 'assistant');

		// 1) Persist the user row immediately and reflect it in the UI.
		const userRow = await repos.messages.append(chatId, 'user', prompt);
		this.messages = [...this.messages, userRow];
		await repos.chats.touch(chatId);

		// 2) Begin streaming.
		this.streaming = true;
		this.streamBuffer = '';
		this.controller = new AbortController();

		try {
			const [ctx, provider] = await Promise.all([assembleContext(chatId), getActiveProvider()]);

			// 3) Fire the parallel title request (first message only). Not awaited:
			// the title lands before the main reply finishes; failures are swallowed.
			if (isFirstRootTurn) {
				void this.autoTitleRoot(provider, prompt);
			}

			const shouldInferBrief =
				chat && chat.parentId === null && parseBrief(chat.brief) === null && !this.inferDismissed;
			if (shouldInferBrief) {
				void this.inferBriefRoot(provider, ctx);
			}

			// 4) Stream the main assistant reply, honoring the composer reasoning.
			for await (const token of provider.chatStream(ctx, {
				signal: this.controller.signal,
				reasoning
			})) {
				this.streamBuffer += token.text ?? token.delta ?? '';
			}

			// 5) Persist the assistant turn (only if anything was produced).
			if (this.streamBuffer.length > 0) {
				const assistantRow = await repos.messages.append(chatId, 'assistant', this.streamBuffer);
				this.messages = [...this.messages, assistantRow];
				await repos.chats.touch(chatId);

				if (import.meta.env.DEV) {
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
					} catch {
						/* best-effort; never throws into the chat path */
					}
				}
			}
		} catch (err) {
			if (!isAbortError(err)) {
				this.error = formatProviderError(err);
			}
			// Even on error, persist whatever partial buffer we collected so the
			// turn isn't lost (matches the "assistant row appended on finish/stop"
			// decision — Stop yields an AbortError we swallow, but partial text
			// may still be worth keeping).
			if (this.streamBuffer.length > 0) {
				try {
					const partial = await repos.messages.append(chatId, 'assistant', this.streamBuffer);
					this.messages = [...this.messages, partial];
					await repos.chats.touch(chatId);
				} catch {
					/* persistence best-effort; the in-memory buffer is already visible */
				}
			}
		} finally {
			this.streaming = false;
			this.streamBuffer = '';
			this.controller = null;
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

	/**
	 * Delete a conversation tree rooted at `chatId` (root + all descendants + all
	 * attached artifacts). Clears the active view if it was pointing into the
	 * deleted tree.
	 */
	async deleteChat(chatId: string): Promise<void> {
		await repos.chats.deleteSubtree(chatId);
		if (this.chat && (this.chat.id === chatId || this.chat.rootId === chatId)) {
			// Abort any in-flight stream AND title request before clearing state.
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
			this.streaming = false;
		}
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
	private async autoTitleRoot(provider: Provider, firstMessage: string): Promise<void> {
		const chat = this.chat;
		if (!chat || chat.parentId !== null || chat.title !== DEFAULT_TITLE) return;
		if (this.titling) return;
		this.titling = true;
		this.titleController = new AbortController();
		try {
			const ctx: ChatMessage[] = [{ role: 'user', content: firstMessage }];
			const title = await generateTitle(provider, ctx, {
				signal: this.titleController.signal
			});
			// Re-check: a retitle (or a concurrent auto-title) may have landed.
			if (!this.chat || this.chat.id !== chat.id || this.chat.title !== DEFAULT_TITLE) return;
			await repos.chats.updateTitle(chat.id, title);
			this.chat = { ...this.chat, title };
		} catch {
			/* best-effort; leave the placeholder title in place */
		} finally {
			this.titling = false;
			this.titleController = null;
		}
	}

	/**
	 * Branch a child off `messageId` grounded in a highlighted span. Resolves
	 * raw offsets via `resolveSelectionOffsets`, falling back to the full
	 * excerpt span when mapping can't be confident. Returns the child chat id.
	 */
	async confirmInferredBrief(b?: LearningBrief): Promise<void> {
		await this.saveBrief(b ?? this.inferredBrief!);
		this.inferredBrief = null;
		this.inferDismissed = false;
	}

	dismissInferredBrief(): void {
		this.inferDismissed = true;
		this.inferredBrief = null;
	}

	private async inferBriefRoot(provider: Provider, ctx: ChatMessage[]): Promise<void> {
		const chat = this.chat;
		if (!chat || chat.parentId !== null || parseBrief(chat.brief) !== null) return;
		if (this.inferring || this.inferDismissed) return;
		this.inferring = true;
		this.inferController = new AbortController();
		try {
			const brief = await generateBrief(provider, ctx, {
				signal: this.inferController.signal
			});
			if (!this.inferDismissed) {
				this.inferredBrief = brief;
			}
		} catch {
			/* best-effort */
		} finally {
			this.inferring = false;
			this.inferController = null;
		}
	}

	branchFromSelection(
		messageId: string,
		rawContent: string,
		selection: SelectionInput
	): Promise<string> {
		const excerpt = selection.excerpt;
		const resolved =
			resolveSelectionOffsets(rawContent, selection) ??
			({ startChar: 0, endChar: excerpt.length, excerpt } as const);

		return this.createBranchChild(messageId, resolved.startChar, resolved.endChar, excerpt);
	}

	/**
	 * Branch a child off `messageId` grounded in a highlighted excerpt, then
	 * stage `prompt` for auto-send on the new branch. Enforces one branch per
	 * excerpt / no overlapping spans (defense-in-depth; the menu already
	 * disables). Throws {@link ExcerptOverlapError} on conflict — creates no
	 * chat/branch_source row in that case. Returns the child chat id.
	 */
	async createExpoundBranch(
		messageId: string,
		rawContent: string,
		selection: SelectionInput,
		prompt: string
	): Promise<string> {
		const excerpt = selection.excerpt;
		const resolved =
			resolveSelectionOffsets(rawContent, selection) ??
			({ startChar: 0, endChar: excerpt.length, excerpt } as const);

		// Overlap guard: an exact-span re-select overlaps itself.
		const existing = await repos.branchSources.listBySourceMessage(messageId);
		if (selectionOverlapsExisting(resolved, existing)) {
			throw new ExcerptOverlapError();
		}

		const childId = await this.createBranchChild(
			messageId,
			resolved.startChar,
			resolved.endChar,
			excerpt
		);
		this.pendingPrompt = prompt;
		return childId;
	}

	/** Branch a child off a whole message (no span / no branch_source row). */
	async branchFromMessage(messageId: string): Promise<string> {
		if (!this.chat) throw new Error('Cannot branch: no active chat');
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
		excerpt: string
	): Promise<string> {
		if (!this.chat) throw new Error('Cannot branch: no active chat');
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
			branchChatId: child.id
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

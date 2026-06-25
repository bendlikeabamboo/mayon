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
import { getActiveProvider } from '$lib/ai/client';
import { formatProviderError, type FormattedProviderError } from '$lib/ai/errors';

function isAbortError(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'AbortError';
}

class ChatState {
	chatId = $state<string | null>(null);
	chat = $state<Chat | null>(null);
	messages = $state<Message[]>([]);
	streaming = $state(false);
	streamBuffer = $state('');
	error = $state<FormattedProviderError | null>(null);
	loading = $state(false);

	private controller: AbortController | null = null;

	/** True when the live assistant bubble should render (buffer non-empty while streaming). */
	get showLiveBubble(): boolean {
		return this.streaming && this.streamBuffer.length > 0;
	}

	/**
	 * Load a chat and its messages into the store. Fully resets transient state
	 * so switching chats never leaks a previous conversation's buffer/error.
	 */
	async load(chatId: string): Promise<void> {
		// Abort any in-flight stream for the previous chat.
		this.stop();
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

	/** Create a fresh root chat and return its id (the caller navigates to it). */
	async createAndNavigate(title?: string): Promise<string> {
		const chat = await repos.chats.createRoot({ title: title ?? 'New chat' });
		return chat.id;
	}

	/** Send a user prompt and stream the assistant reply, persisting on finish. */
	async send(text: string): Promise<void> {
		const prompt = text.trim();
		if (!prompt || this.streaming || !this.chatId) return;

		this.error = null;
		const chatId = this.chatId;

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
			for await (const token of provider.chatStream(ctx, { signal: this.controller.signal })) {
				this.streamBuffer += token.text ?? token.delta ?? '';
			}

			// 5) Persist the assistant turn (only if anything was produced).
			if (this.streamBuffer.length > 0) {
				const assistantRow = await repos.messages.append(chatId, 'assistant', this.streamBuffer);
				this.messages = [...this.messages, assistantRow];
				await repos.chats.touch(chatId);
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

	/**
	 * Branch a child off `messageId` grounded in a highlighted span. Resolves
	 * raw offsets via `resolveSelectionOffsets`, falling back to the full
	 * excerpt span when mapping can't be confident. Returns the child chat id.
	 */
	async branchFromSelection(
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

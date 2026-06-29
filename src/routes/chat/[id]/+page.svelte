<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { FlaskConical, ListChecks, Network, Sparkles, Target, Wrench } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { chatStore, ExcerptOverlapError } from '$lib/stores/chat.svelte';
	import { labsStore } from '$lib/stores/labs.svelte';
	import { quizzesStore } from '$lib/stores/quizzes.svelte';
	import { diagnosticsStore } from '$lib/stores/diagnostics.svelte';
	import { repos } from '$lib/db';
	import { breadcrumbToRoot } from '$lib/chat/tree';
	import { buildExpoundPrompt } from '$lib/chat/expound';
	import {
		parseBrief,
		summarizeBrief,
		strategyForBrief,
		type LearningBrief
	} from '$lib/chat/brief';
	import { extractGateBlock } from '$lib/ai/generate/generate-gate';
	import BriefCard from '$lib/components/chat/BriefCard.svelte';
	import type { Chat, Lab, Quiz } from '$lib/db/schema';
	import type { SelectionInput } from '$lib/chat/highlight';
	import type { ExpoundOptions } from '$lib/chat/expound';
	import type { ReasoningMode } from '$lib/ai/types';
	import MessageList from '$lib/components/chat/MessageList.svelte';
	import Composer from '$lib/components/chat/Composer.svelte';
	import ApprovalCard from '$lib/components/chat/ApprovalCard.svelte';
	import Breadcrumb from '$lib/components/chat/Breadcrumb.svelte';
	import CrossLinks from '$lib/components/chat/CrossLinks.svelte';
	import DiagnosticsPanel from '$lib/components/chat/DiagnosticsPanel.svelte';

	let breadcrumb = $state<Chat[]>([]);
	let children = $state<Chat[]>([]);
	let siblings = $state<Chat[]>([]);
	let labs = $state<Lab[]>([]);
	let quizzes = $state<Quiz[]>([]);
	/** When true, the brief editor is open (root only). */
	let editingBrief = $state(false);
	/** When true, the intake card on this chat is dismissed for the session. */
	let intakeDismissed = $state(false);
	let editingInferred = $state(false);
	let rootChat = $state<Chat | null>(null);

	/** The parsed brief for the ROOT of this chat's tree (inherited by branches). */
	const rootBrief = $derived<LearningBrief | null>(
		chatStore.chat
			? parseBrief(
					chatStore.chat.parentId === null ? chatStore.chat.brief : (rootChat?.brief ?? null)
				)
			: null
	);

	/**
	 * True when the brief intake card should render: root chat, no messages yet,
	 * no brief, and not dismissed this session. Branches never show intake (they
	 * inherit the root's brief). Reset on chat switch.
	 */
	const showBriefIntake = $derived(
		!intakeDismissed &&
			chatStore.chat !== null &&
			chatStore.chat.parentId === null &&
			chatStore.chat.id === chatStore.chat.rootId &&
			chatStore.messages.length === 0 &&
			rootBrief === null
	);

	const activeStrategy = $derived(rootBrief ? strategyForBrief(rootBrief) : null);

	const lastAssistantRaw = $derived(() => {
		for (let i = chatStore.messages.length - 1; i >= 0; i--) {
			if (chatStore.messages[i].role === 'assistant') return chatStore.messages[i].content;
		}
		return '';
	});

	const gate = $derived(activeStrategy?.gated ? extractGateBlock(lastAssistantRaw()) : null);

	const suggestedReplies = $derived(gate?.options ?? activeStrategy?.replies);

	async function loadNav(chat: Chat) {
		const subtree = await repos.chats.listSubtree(chat.rootId);
		const byId = new Map(subtree.map((c) => [c.id, c]));
		rootChat = byId.get(chat.rootId) ?? chat;
		breadcrumb = breadcrumbToRoot(chat, byId);
		// Children: direct descendants of the current chat.
		children = await repos.chats.listChildren(chat.id);
		// Siblings: children of the parent (if any), excluding self.
		if (chat.parentId) {
			siblings = (await repos.chats.listChildren(chat.parentId)).filter((c) => c.id !== chat.id);
		} else {
			siblings = [];
		}
		// Existing labs for this chat (shown as chips under the composer).
		labs = await repos.labs.listByChat(chat.id);
		// Existing quizzes for this chat (shown as chips under the composer).
		quizzes = await repos.quizzes.listByChat(chat.id);
	}

	async function loadAll(chatId: string) {
		editingBrief = false;
		intakeDismissed = false;
		editingInferred = false;
		rootChat = null;
		await chatStore.load(chatId);
		if (chatStore.chat) {
			await loadNav(chatStore.chat);
			diagnosticsStore.load(chatId);
		}
		// Drain a staged expound prompt: auto-send + auto-stream the first turn
		// on the freshly-opened branch. Sent once, after the branch is loaded.
		if (chatStore.pendingPrompt) {
			const p = chatStore.pendingPrompt;
			chatStore.clearPendingPrompt();
			void chatStore.send(p);
		}
	}

	onMount(() => {
		const initial = page.params.id;
		if (initial) return loadAll(initial);
	});

	// Reload when navigating between chats ([id] changes).
	let lastId = page.params.id;
	$effect(() => {
		const current = page.params.id;
		if (current && current !== lastId) {
			lastId = current;
			void loadAll(current);
		}
	});

	async function onSend(text: string, reasoning: ReasoningMode) {
		await chatStore.send(text, { reasoning });
	}

	async function onExpound(
		messageId: string,
		raw: string,
		sel: SelectionInput,
		opts: ExpoundOptions
	) {
		const prompt = buildExpoundPrompt(opts);
		try {
			const childId = await chatStore.createExpoundBranch(messageId, raw, sel, prompt);
			await goto(`/chat/${childId}`);
		} catch (err) {
			if (err instanceof ExcerptOverlapError) {
				chatStore.error = {
					title: 'Excerpt already expounded',
					message: 'That excerpt already belongs to an expound branch. Pick a different span.'
				};
			} else {
				chatStore.error = {
					title: 'Could not expound',
					message: err instanceof Error ? err.message : String(err)
				};
			}
		}
	}

	function onCopy(text: string) {
		void navigator.clipboard?.writeText(text);
	}

	async function onBranchWhole(messageId: string) {
		const childId = await chatStore.branchFromMessage(messageId);
		await goto(`/chat/${childId}`);
	}

	async function onGenerateLab() {
		if (!chatStore.chat) return;
		const id = await labsStore.generate(chatStore.chat.id);
		if (id) await goto(`/lab/${id}`);
	}

	async function onGenerateQuiz() {
		if (!chatStore.chat) return;
		const id = await quizzesStore.generate(chatStore.chat.id);
		if (id) await goto(`/quiz/${id}`);
	}

	async function onSaveRawLab() {
		if (!labsStore.rawOffer) return;
		const id = await labsStore.saveRaw(labsStore.rawOffer.chatId, labsStore.rawOffer.raw);
		if (id) await goto(`/lab/${id}`);
	}

	async function onSaveBrief(brief: LearningBrief) {
		await chatStore.saveBrief(brief);
		editingBrief = false;
	}

	async function onSaveIntakeBrief(brief: LearningBrief) {
		await chatStore.saveBrief(brief);
	}

	/** "Just start chatting" on the [id] intake: dismiss the card, no brief. */
	function onSkipIntake() {
		intakeDismissed = true;
	}

	async function onConfirmInferred() {
		await chatStore.confirmInferredBrief();
		editingInferred = false;
	}

	async function onSaveInferred(brief: LearningBrief) {
		await chatStore.confirmInferredBrief(brief);
		editingInferred = false;
	}
</script>

<svelte:head>
	<title>{chatStore.chat?.title ?? 'Chat'} — Mayon</title>
</svelte:head>

<div class="mx-auto flex h-full max-w-3xl flex-col gap-3 p-4">
	{#if chatStore.loading}
		<p class="py-8 text-center text-sm text-muted-foreground">Loading chat…</p>
	{:else if !chatStore.chat}
		<div class="py-8 text-center">
			<p class="text-sm text-muted-foreground">Chat not found.</p>
			<Button href="/chat" variant="link" class="mt-2">Back to chat list</Button>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-2">
			<div class="min-w-0 flex-1">
				<Breadcrumb chain={breadcrumb} />
			</div>
			<div class="flex shrink-0 items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					onclick={onGenerateLab}
					disabled={chatStore.streaming || labsStore.generating || quizzesStore.generating}
					title="Generate a hands-on lab from this chat"
				>
					<FlaskConical class="size-4" />
					{#if labsStore.generating}
						Generating…
					{:else}
						Generate lab
					{/if}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onclick={onGenerateQuiz}
					disabled={chatStore.streaming || labsStore.generating || quizzesStore.generating}
					title="Generate a self-graded quiz from this chat"
				>
					<ListChecks class="size-4" />
					{#if quizzesStore.generating}
						Generating…
					{:else}
						Generate quiz
					{/if}
				</Button>
				<Button
					href="/tree"
					variant="ghost"
					size="sm"
					class="shrink-0"
					title="Open the conversation tree"
				>
					<Network class="size-4" /> Tree
				</Button>
				<Button
					variant="ghost"
					size="icon"
					title="Diagnostics"
					aria-label="Diagnostics"
					onclick={() => diagnosticsStore.toggle()}
				>
					<Wrench class="size-4" />
				</Button>
			</div>
		</div>

		<CrossLinks chatId={chatStore.chat.id} />

		{#if showBriefIntake}
			<BriefCard mode="intake" onSave={onSaveIntakeBrief} onSkip={onSkipIntake} />
		{:else if rootBrief && editingBrief}
			<BriefCard
				mode="edit"
				brief={rootBrief}
				onSave={onSaveBrief}
				onDismiss={() => {
					editingBrief = false;
				}}
			/>
		{:else if rootBrief}
			<button
				type="button"
				class="flex items-center gap-2 self-start rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground {chatStore
					.chat?.parentId
					? 'cursor-default'
					: 'cursor-pointer'}"
				title={chatStore.chat?.parentId ? 'Inherited from the root chat' : 'Edit your brief'}
				onclick={() => {
					if (!chatStore.chat?.parentId) editingBrief = true;
				}}
			>
				<Target class="size-3 shrink-0" />
				<span class="truncate">{summarizeBrief(rootBrief)}</span>
				{#if chatStore.chat?.parentId}
					<span class="shrink-0 text-muted-foreground/70">(inherited)</span>
				{/if}
			</button>
		{:else if chatStore.inferredBrief && chatStore.chat?.parentId === null && !editingInferred}
			<div class="self-start rounded-md border border-border bg-card p-3 text-sm">
				<div class="flex items-center gap-2">
					<Sparkles class="size-3 shrink-0 text-muted-foreground" />
					<span class="text-muted-foreground">Heard:</span>
					<span class="truncate">{summarizeBrief(chatStore.inferredBrief)}</span>
				</div>
				<div class="mt-2 flex gap-2">
					<Button variant="default" size="sm" onclick={onConfirmInferred}>Use this</Button>
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							editingInferred = true;
						}}>Edit</Button
					>
					<Button variant="ghost" size="sm" onclick={() => chatStore.dismissInferredBrief()}
						>Dismiss</Button
					>
				</div>
			</div>
		{:else if editingInferred && chatStore.inferredBrief}
			<BriefCard
				mode="edit"
				brief={chatStore.inferredBrief}
				onSave={onSaveInferred}
				onDismiss={() => {
					editingInferred = false;
				}}
			/>
		{/if}

		<MessageList
			messages={chatStore.messages}
			streaming={chatStore.streaming}
			streamBuffer={chatStore.streamBuffer}
			{onExpound}
			{onCopy}
			{onBranchWhole}
		/>

		{#each chatStore.pendingApprovals as a (a.toolCallId)}
			<ApprovalCard
				entry={a}
				onApprove={() => chatStore.approve(a.toolCallId)}
				onDecline={() => chatStore.decline(a.toolCallId)}
			/>
		{/each}

		{#if chatStore.error}
			<div class="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
				<p class="font-medium text-red-700 dark:text-red-400">{chatStore.error.title}</p>
				<p class="mt-0.5 text-red-700/90 dark:text-red-400/90">{chatStore.error.message}</p>
				{#if chatStore.error.hint}
					<p class="mt-1 text-xs text-muted-foreground">{chatStore.error.hint}</p>
				{/if}
				{#if chatStore.error.title === 'Missing API key'}
					<Button href="/settings" variant="outline" size="sm" class="mt-2">Open Settings</Button>
				{/if}
			</div>
		{/if}

		{#if labsStore.error}
			<div class="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
				<p class="font-medium text-red-700 dark:text-red-400">{labsStore.error.title}</p>
				<p class="mt-0.5 text-red-700/90 dark:text-red-400/90">{labsStore.error.message}</p>
				{#if labsStore.error.hint}
					<p class="mt-1 text-xs text-muted-foreground">{labsStore.error.hint}</p>
				{/if}
			</div>
		{/if}

		{#if quizzesStore.error}
			<div class="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
				<p class="font-medium text-red-700 dark:text-red-400">{quizzesStore.error.title}</p>
				<p class="mt-0.5 text-red-700/90 dark:text-red-400/90">{quizzesStore.error.message}</p>
				{#if quizzesStore.error.hint}
					<p class="mt-1 text-xs text-muted-foreground">{quizzesStore.error.hint}</p>
				{/if}
				<Button variant="outline" size="sm" class="mt-2" onclick={onGenerateQuiz}>Regenerate</Button
				>
			</div>
		{/if}

		{#if labsStore.rawOffer && labsStore.rawOffer.chatId === chatStore.chat.id}
			<div class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				<p class="font-medium text-amber-700 dark:text-amber-400">Lab output couldn't be parsed</p>
				<p class="mt-0.5 text-amber-700/90 dark:text-amber-400/90">
					The model returned output that didn't match the lab schema after retries.
				</p>
				<div class="mt-2 flex gap-2">
					<Button variant="outline" size="sm" onclick={onSaveRawLab}>Save raw text as lab</Button>
					<Button variant="ghost" size="sm" onclick={() => labsStore.dismissRawOffer()}
						>Dismiss</Button
					>
				</div>
			</div>
		{/if}

		{#if gate?.progress}
			<p class="text-xs font-medium text-muted-foreground">{gate.progress}</p>
		{/if}

		<Composer
			bind:streaming={chatStore.streaming}
			{onSend}
			onStop={chatStore.stop.bind(chatStore)}
			{suggestedReplies}
		/>

		<!-- Children + siblings + labs + quizzes under the composer -->
		{#if children.length > 0 || siblings.length > 0 || labs.length > 0 || quizzes.length > 0}
			<div class="space-y-2 border-t border-border pt-2">
				{#if labs.length > 0}
					<div>
						<p class="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Labs ({labs.length})
						</p>
						<ul class="flex flex-wrap gap-1.5">
							{#each labs as l (l.id)}
								<li>
									<a
										href="/lab/{l.id}"
										class="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs hover:bg-accent"
										title={l.title}
									>
										<FlaskConical class="size-3" />
										{l.title}
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if quizzes.length > 0}
					<div>
						<p class="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Quizzes ({quizzes.length})
						</p>
						<ul class="flex flex-wrap gap-1.5">
							{#each quizzes as q (q.id)}
								<li>
									<a
										href="/quiz/{q.id}"
										class="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs hover:bg-accent"
										title={new Date(q.createdAt).toLocaleString()}
									>
										<ListChecks class="size-3" />
										Quiz
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if children.length > 0}
					<div>
						<p class="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Branches from here ({children.length})
						</p>
						<ul class="flex flex-wrap gap-1.5">
							{#each children as c (c.id)}
								<li>
									<a
										href="/chat/{c.id}"
										class="inline-block rounded-md border border-border bg-background px-2 py-0.5 text-xs hover:bg-accent"
										title={c.title}
									>
										{c.title}
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
				{#if siblings.length > 0}
					<div>
						<p class="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Siblings ({siblings.length})
						</p>
						<ul class="flex flex-wrap gap-1.5">
							{#each siblings as c (c.id)}
								<li>
									<a
										href="/chat/{c.id}"
										class="inline-block rounded-md border border-border bg-background px-2 py-0.5 text-xs hover:bg-accent"
										title={c.title}
									>
										{c.title}
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
	<DiagnosticsPanel chatId={chatStore.chat!.id} />
</div>

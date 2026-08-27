<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ArrowRight } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import Composer from '$lib/components/chat/Composer.svelte';
	import { listProviders } from '$lib/ai/client';
	import type { ProviderConfig, ReasoningEffort } from '$lib/ai/types';
	import { repos } from '$lib/db';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { quizzesStore } from '$lib/stores/quizzes.svelte';
	import { labsStore } from '$lib/stores/labs.svelte';
	import { timeAgo } from '$lib/utils/time';
	import { parseBrief } from '$lib/chat/brief';
	import { deriveStarters, type Starter } from '$lib/chat/starters';
	import RowCard from '$lib/components/RowCard.svelte';
	import { entry } from '$lib/motion/stagger';
	import type { LabChecklistItem } from '$lib/db';
	import type { Chat, Quiz } from '$lib/db/schema';

	interface InProgressLab {
		id: string;
		title: string;
		chatId: string;
		updatedAt: number;
	}

	let providerList = $state<ProviderConfig[]>([]);
	let recentChats = $state<Chat[]>([]);
	let latestRoot = $state<Chat | null>(null);
	let inProgressLabs = $state<InProgressLab[]>([]);
	let recentQuizzes = $state<Quiz[]>([]);
	let starters = $state<Starter[]>(deriveStarters(null));
	let greeting = $state('Welcome');
	let loading = $state(true);

	onMount(async () => {
		const [provList, chats, allLabs, allQuizzes] = await Promise.all([
			listProviders(),
			repos.chats.listRoots(),
			repos.labs.listAll(),
			repos.quizzes.listAll()
		]);

		providerList = provList;
		// listRoots returns most-recently-touched roots first — the head is the
		// continue-learning candidate (see resumeHeuristic note below).
		latestRoot = chats[0] ?? null;
		recentChats = chats.slice(0, 5);

		const inProgress: InProgressLab[] = [];
		for (const lab of allLabs) {
			if (inProgress.length >= 3) break;
			try {
				const items = JSON.parse(lab.checklist) as LabChecklistItem[];
				if (Array.isArray(items) && items.some((item) => item.done === false)) {
					inProgress.push({
						id: lab.id,
						title: lab.title,
						chatId: lab.chatId,
						updatedAt: lab.updatedAt
					});
				}
			} catch {
				// malformed checklist — not in-progress
			}
		}
		inProgressLabs = inProgress;
		recentQuizzes = allQuizzes.slice(0, 3);

		starters = deriveStarters({
			brief: parseBrief(latestRoot?.brief ?? null),
			labTitles: inProgress.map((l) => l.title),
			chatTitles: recentChats.map((c) => c.title)
		});

		const h = new Date().getHours();
		greeting =
			h < 5
				? 'Working late?'
				: h < 12
					? 'Good morning'
					: h < 18
						? 'Good afternoon'
						: 'Good evening';

		loading = false;
	});

	let hasHistory = $derived(
		recentChats.length > 0 || inProgressLabs.length > 0 || recentQuizzes.length > 0
	);

	/**
	 * Resume qualification heuristic: chat rows carry no completion signal
	 * (`chats` has neither a completed marker nor an archived flag), so the
	 * most-recently-updated root counts as the in-progress continue-learning
	 * candidate. Hidden entirely in the zero-history state.
	 */
	let resumeCandidate = $derived(hasHistory && latestRoot ? latestRoot : null);

	let resumeHint = $derived.by(() => {
		const parsed = parseBrief(resumeCandidate?.brief ?? null);
		return parsed ? parsed.goal : null;
	});

	// ── start-from-home ─────────────────────────────────────────────

	let starting = $state(false);
	let heroPrompt = $state('');

	/**
	 * Chosen send-from-home pattern (the one /chat's brief intake already
	 * uses): create the root honestly, stage the first message in the store's
	 * `pendingPrompt`, then navigate — the chat route drains `pendingPrompt`
	 * during `loadAll` and streams the reply visibly. No silent writes; the
	 * composer's effort choice isn't threaded (pendingPrompt carries text
	 * only), so home-launched sends use the default reasoning effort.
	 */
	async function startChat(text: string) {
		const t = text.trim();
		if (!t || starting) return;
		starting = true;
		try {
			const id = await chatStore.createAndNavigate();
			chatStore.pendingPrompt = { text: t };
			await goto(`/chat/${id}`);
		} finally {
			starting = false;
		}
	}

	async function onHeroSend(text: string, _effort: ReasoningEffort) {
		await startChat(text);
	}

	/** Launcher prerequisite: ensure a conversation exists to bind artifacts to. */
	async function ensureHomeChat(): Promise<string | null> {
		if (chatStore.chat) return chatStore.chat.id;
		const createdId = await chatStore.createAndNavigate();
		await chatStore.load(createdId);
		return chatStore.chat ? createdId : null;
	}

	async function onLaunchBranch() {
		const parentId = await ensureHomeChat();
		const parent = chatStore.chat;
		if (!parentId || !parent) return;
		try {
			// Same UX1a intent as branchFromMessage: suppress auto-branch_chat next turn.
			chatStore.manualBranchPending = true;
			const child = await repos.chats.createChild({
				parentId,
				branchPointMessageId: null,
				title: 'Branch of ' + parent.title
			});
			await goto(`/chat/${child.id}`);
		} catch (err) {
			chatStore.error = {
				title: 'Could not branch',
				message: err instanceof Error ? err.message : String(err)
			};
		}
	}

	async function onLaunchQuiz() {
		const chatId = await ensureHomeChat();
		if (!chatId) return;
		const id = await quizzesStore.generate(chatId);
		if (id) await goto(`/quiz/${id}`);
	}

	async function onLaunchLab() {
		const chatId = await ensureHomeChat();
		if (!chatId) return;
		const id = await labsStore.generate(chatId);
		if (id) await goto(`/lab/${id}`);
	}
</script>

<svelte:head>
	<title>Mayon</title>
</svelte:head>

{#if loading}
	<div class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
		<p class="text-sm text-muted-foreground">Loading…</p>
	</div>
{:else if providerList.length === 0}
	<div class="art-stagger mx-auto flex max-w-2xl flex-col items-center gap-8 p-8">
		<header
			in:entry|global={{ index: 0, count: 2 }}
			class="flex flex-col items-center gap-1.5 pt-6 text-center"
		>
			<p class="text-[11px] font-medium tracking-[0.2em] text-muted-foreground uppercase">Mayon</p>
			<h1 class="text-3xl font-semibold tracking-tight">{greeting}</h1>
			<p class="max-w-md text-sm text-muted-foreground">
				A local-first learning app built around a branchable chat graph.
			</p>
		</header>
		<div in:entry|global={{ index: 1, count: 2 }} class="surface-card w-full p-6 text-center">
			<p class="text-sm text-muted-foreground">Add a provider to start.</p>
			<Button href="/settings" class="mt-3">Open Settings</Button>
		</div>
	</div>
{:else}
	<div class="art-stagger mx-auto flex max-w-2xl flex-col gap-10 p-8">
		{#if hasHistory}
			<div in:entry|global={{ index: 0, count: 3 }} class="relative w-full">
				<header class="flex flex-col items-center gap-1.5 pt-4 pb-2 text-center">
					<p class="text-[11px] font-medium tracking-[0.2em] text-muted-foreground uppercase">
						Mayon
					</p>
					<h1 class="text-3xl font-semibold tracking-tight">{greeting}</h1>
				</header>
				<Button
					variant="ghost"
					size="sm"
					href="/chat"
					class="absolute top-2 right-0 text-muted-foreground"
				>
					All chats
				</Button>
			</div>

			{#if resumeCandidate}
				<a
					in:entry|global={{ index: 1, count: 3 }}
					href="/chat/{resumeCandidate.id}"
					class="group surface-card flex w-full items-center justify-between gap-4 rounded-xl p-5 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring hover:shadow-md"
				>
					<span class="min-w-0">
						<span class="block text-xs font-medium tracking-wider text-primary uppercase">
							Continue learning
						</span>
						<span class="mt-1 block truncate text-base font-semibold">
							{resumeCandidate.title}
						</span>
						<span class="mt-0.5 block truncate text-xs text-muted-foreground">
							{timeAgo(resumeCandidate.updatedAt)}{#if resumeHint}&nbsp;·&nbsp;Goal:
								{resumeHint}{/if}
						</span>
					</span>
					<span
						class="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors group-hover:bg-primary/90"
					>
						Continue
						<ArrowRight class="size-4" />
					</span>
				</a>
			{/if}
		{:else}
			<header
				in:entry|global={{ index: 0, count: 2 }}
				class="flex flex-col items-center gap-1.5 pt-6 text-center"
			>
				<p class="text-[11px] font-medium tracking-[0.2em] text-muted-foreground uppercase">
					Mayon
				</p>
				<h1 class="text-3xl font-semibold tracking-tight">{greeting}</h1>
				<p class="max-w-md text-sm text-muted-foreground">
					A local-first learning app built around a branchable chat graph.
				</p>
			</header>
			<div in:entry|global={{ index: 1, count: 3 }} class="self-center">
				<Button variant="ghost" size="sm" href="/chat" class="text-muted-foreground">
					All chats
				</Button>
			</div>
		{/if}

		{#if !resumeCandidate}
			<div in:entry|global={{ index: 2, count: 3 }} class="w-full max-w-xl self-center">
				<Composer
					bind:prompt={heroPrompt}
					streaming={chatStore.streaming}
					onSend={onHeroSend}
					onStop={() => chatStore.stop()}
					onBranch={onLaunchBranch}
					onQuiz={onLaunchQuiz}
					onLab={onLaunchLab}
					canGenerate={providerList.length > 0}
					quizBusy={quizzesStore.generating}
					labBusy={labsStore.generating}
				/>
			</div>
		{/if}

		<div
			class="flex w-full flex-wrap items-center justify-center gap-1.5"
			role="group"
			aria-label="Start a conversation"
		>
			{#each starters as starter, i (starter.id)}
				<button
					type="button"
					in:entry|global={{ index: i + 3, count: starters.length + 4 }}
					disabled={starting}
					onclick={() => void startChat(starter.prompt)}
					class="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
				>
					{starter.label}
				</button>
			{/each}
		</div>

		{#if hasHistory}
			<div
				in:entry|global={{ index: starters.length + 3, count: starters.length + 4 }}
				class="flex flex-col gap-6"
			>
				{#if recentChats.length > 0}
					<section>
						<h2 class="mb-1 text-xs font-medium tracking-wide text-muted-foreground">
							Recent chats
						</h2>
						<ul class="space-y-1">
							{#each recentChats as chat (chat.id)}
								<li>
									<RowCard
										compact
										href="/chat/{chat.id}"
										title={chat.title}
										meta={timeAgo(chat.updatedAt)}
									/>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if inProgressLabs.length > 0}
					<section>
						<h2 class="mb-1 text-xs font-medium tracking-wide text-muted-foreground">
							In-progress labs
						</h2>
						<ul class="space-y-1">
							{#each inProgressLabs as lab (lab.id)}
								<li>
									<RowCard
										compact
										href="/lab/{lab.id}"
										title={lab.title}
										meta={timeAgo(lab.updatedAt)}
									/>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if recentQuizzes.length > 0}
					<section>
						<h2 class="mb-1 text-xs font-medium tracking-wide text-muted-foreground">
							Recent quizzes
						</h2>
						<ul class="space-y-1">
							{#each recentQuizzes as quiz (quiz.id)}
								<li>
									<RowCard
										compact
										href="/quiz/{quiz.id}"
										title="Quiz"
										meta={timeAgo(quiz.createdAt)}
									/>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</div>
		{/if}
	</div>
{/if}

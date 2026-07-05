<script lang="ts">
	import { onMount } from 'svelte';
	import { Plus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { listProviders } from '$lib/ai/client';
	import { repos } from '$lib/db';
	import { timeAgo } from '$lib/utils/time';
	import type { LabChecklistItem } from '$lib/db';
	import type { ProviderConfig } from '$lib/ai/types';
	import type { Chat, Quiz } from '$lib/db/schema';

	interface InProgressLab {
		id: string;
		title: string;
		chatId: string;
		updatedAt: number;
	}

	let providerList = $state<ProviderConfig[]>([]);
	let recentChats = $state<Chat[]>([]);
	let inProgressLabs = $state<InProgressLab[]>([]);
	let recentQuizzes = $state<Quiz[]>([]);
	let loading = $state(true);

	onMount(async () => {
		const [provList, chats, allLabs, allQuizzes] = await Promise.all([
			listProviders(),
			repos.chats.listRoots(),
			repos.labs.listAll(),
			repos.quizzes.listAll()
		]);

		providerList = provList;
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

		loading = false;
	});
</script>

<svelte:head>
	<title>Mayon</title>
</svelte:head>

{#if loading}
	<div class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
		<p class="text-sm text-muted-foreground">Loading…</p>
	</div>
{:else if providerList.length === 0}
	<div class="mx-auto flex max-w-3xl flex-col items-center gap-6 p-8">
		<div class="space-y-2 text-center">
			<h1 class="text-4xl font-bold tracking-tight">Mayon</h1>
			<p class="text-lg text-muted-foreground">
				A local-first learning app built around a branchable chat graph.
			</p>
		</div>
		<div class="rounded-lg border border-border bg-card p-6 text-center">
			<p class="text-sm text-muted-foreground">Add a provider to start.</p>
			<Button href="/settings" class="mt-3">Open Settings</Button>
		</div>
	</div>
{:else if recentChats.length === 0 && inProgressLabs.length === 0 && recentQuizzes.length === 0}
	<div class="mx-auto flex max-w-3xl flex-col items-center gap-6 p-8">
		<div class="space-y-2 text-center">
			<h1 class="text-4xl font-bold tracking-tight">Mayon</h1>
			<p class="text-lg text-muted-foreground">
				A local-first learning app built around a branchable chat graph.
			</p>
		</div>
		<div class="rounded-lg border border-border bg-card p-6 text-center">
			<p class="text-sm text-muted-foreground">Start your first chat.</p>
			<Button href="/chat" class="mt-3">
				<Plus class="size-4" /> New chat
			</Button>
		</div>
	</div>
{:else}
	<div class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
		<div class="flex items-center justify-between">
			<div class="space-y-1">
				<h1 class="text-4xl font-bold tracking-tight">Mayon</h1>
				<p class="text-lg text-muted-foreground">
					A local-first learning app built around a branchable chat graph.
				</p>
			</div>
			<Button href="/chat" class="shrink-0">
				<Plus class="size-4" /> New chat
			</Button>
		</div>

		{#if recentChats.length > 0}
			<section>
				<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					Recent chats
				</h2>
				<ul class="space-y-1.5">
					{#each recentChats as chat (chat.id)}
						<li>
							<a
								href="/chat/{chat.id}"
								class="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
							>
								<p class="truncate text-sm font-medium">{chat.title}</p>
								<span class="shrink-0 text-xs text-muted-foreground">{timeAgo(chat.updatedAt)}</span
								>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if inProgressLabs.length > 0}
			<section>
				<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					In-progress labs
				</h2>
				<ul class="space-y-1.5">
					{#each inProgressLabs as lab (lab.id)}
						<li>
							<a
								href="/lab/{lab.id}"
								class="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
							>
								<p class="truncate text-sm font-medium">{lab.title}</p>
								<span class="shrink-0 text-xs text-muted-foreground">{timeAgo(lab.updatedAt)}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if recentQuizzes.length > 0}
			<section>
				<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					Recent quizzes
				</h2>
				<ul class="space-y-1.5">
					{#each recentQuizzes as quiz (quiz.id)}
						<li>
							<a
								href="/quiz/{quiz.id}"
								class="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
							>
								<p class="truncate text-sm font-medium">Quiz</p>
								<span class="shrink-0 text-xs text-muted-foreground">{timeAgo(quiz.createdAt)}</span
								>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
{/if}

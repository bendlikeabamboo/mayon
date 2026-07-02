<script lang="ts">
	import { onMount } from 'svelte';
	import { ListChecks } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { quizzesStore } from '$lib/stores/quizzes.svelte';
	import { repos } from '$lib/db';
	import type { Chat, Quiz } from '$lib/db/schema';

	/**
	 * Quizzes index. Lists every quiz grouped by chat (each group shows the
	 * chat title as a header). "Generate quiz" is chat-scoped, so it lives on
	 * the chat page, not here — this route is navigation + (optional) delete only.
	 */
	let groups = $state<{ chat: Chat | null; quizzes: Array<Quiz & { questionCount: number }> }[]>(
		[]
	);

	onMount(async () => {
		await quizzesStore.loadList();
		await regroup();
	});

	async function regroup(): Promise<void> {
		const all = quizzesStore.list;
		const byChat: Record<string, Quiz[]> = {};
		const order: string[] = [];
		for (const quiz of all) {
			if (!byChat[quiz.chatId]) {
				byChat[quiz.chatId] = [];
				order.push(quiz.chatId);
			}
			byChat[quiz.chatId].push(quiz);
		}
		const out: {
			chat: Chat | null;
			quizzes: Array<Quiz & { questionCount: number }>;
		}[] = [];
		for (const chatId of order) {
			const chat = await repos.chats.getById(chatId);
			const withCounts: Array<Quiz & { questionCount: number }> = [];
			for (const quiz of byChat[chatId]) {
				const questions = await repos.quizQuestions.listByQuiz(quiz.id);
				withCounts.push({ ...quiz, questionCount: questions.length });
			}
			out.push({ chat, quizzes: withCounts });
		}
		groups = out;
	}

	async function onDelete(id: string): Promise<void> {
		await repos.quizzes.delete(id);
		await quizzesStore.loadList();
		await regroup();
	}

	function timeAgo(ts: number): string {
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}
</script>

<svelte:head>
	<title>Quizzes — Mayon</title>
</svelte:head>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
	<div class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Quizzes</h1>
		<p class="text-sm text-muted-foreground">Self-graded quizzes generated from your chats.</p>
	</div>

	{#if quizzesStore.loading}
		<p class="text-sm text-muted-foreground">Loading…</p>
	{:else if groups.length === 0}
		<div class="rounded-lg border border-dashed border-border p-8 text-center">
			<ListChecks class="mx-auto size-6 text-muted-foreground" />
			<p class="mt-2 text-sm text-muted-foreground">No quizzes yet.</p>
			<p class="mt-1 text-sm text-muted-foreground">
				Open a chat and click “Generate quiz” to create one.
			</p>
			<Button href="/chat" variant="link" class="mt-2">Go to chats</Button>
		</div>
	{:else}
		<div class="space-y-6">
			{#each groups as group (group.chat?.id ?? group.quizzes[0].chatId)}
				<section class="space-y-2">
					{#if group.chat}
						<a
							href="/chat/{group.chat.id}"
							class="text-xs font-medium uppercase tracking-wide text-muted-foreground hover:underline"
						>
							{group.chat.title}
						</a>
					{:else}
						<p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							(deleted chat)
						</p>
					{/if}
					<ul class="space-y-2">
						{#each group.quizzes as quiz (quiz.id)}
							<li
								class="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
							>
								<a href="/quiz/{quiz.id}" class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">
										Quiz #{quizzesStore.getQuizNumber(quiz.id)} · {quiz.questionCount} questions
									</p>
									<p class="text-xs text-muted-foreground">{timeAgo(quiz.createdAt)}</p>
								</a>
								<Button
									variant="ghost"
									size="sm"
									class="opacity-0 transition-opacity group-hover:opacity-100"
									onclick={() => onDelete(quiz.id)}
								>
									Delete
								</Button>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</div>

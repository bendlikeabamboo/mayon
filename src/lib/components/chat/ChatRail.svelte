<script lang="ts">
	import { FlaskConical, GitBranch, ListChecks, LoaderCircle } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Chat, Lab, Quiz } from '$lib/db/schema';
	import CrossLinks from './CrossLinks.svelte';

	let {
		breadcrumb,
		children,
		siblings,
		labs,
		quizzes,
		chatId,
		currentTitle,
		onGenerateLab,
		onGenerateQuiz,
		generatingLab,
		generatingQuiz,
		collapsed = $bindable(false),
		getQuizNumber = (_id: string) => 0
	}: {
		breadcrumb: Chat[];
		children: Chat[];
		siblings: Chat[];
		labs: Lab[];
		quizzes: Quiz[];
		chatId: string;
		currentTitle: string;
		onGenerateLab: () => void;
		onGenerateQuiz: () => void;
		generatingLab: boolean;
		generatingQuiz: boolean;
		collapsed?: boolean;
		getQuizNumber?: (id: string) => number;
	} = $props();
</script>

<div class="relative flex h-full flex-col">
	{#if !collapsed}
		<div class="flex h-full flex-col gap-4 overflow-y-auto border-l border-border bg-muted/20 p-3">
			{#if breadcrumb.length > 0}
				<section>
					<p class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Parents
					</p>
					<ul class="space-y-0.5">
						{#each breadcrumb as chat, i (chat.id)}
							<li>
								{#if i === breadcrumb.length - 1}
									<span class="block truncate text-sm font-semibold">{currentTitle}</span>
								{:else}
									<a
										href="/chat/{chat.id}"
										class="block truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
										title={chat.title}
									>
										{chat.title}
									</a>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if children.length > 0}
				<section>
					<p class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						<GitBranch class="mr-1 inline size-3" />Branches ({children.length})
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
				</section>
			{/if}

			{#if siblings.length > 0}
				<section>
					<p class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
				</section>
			{/if}

			<section>
				<div class="mb-1 flex items-center justify-between">
					<p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						<FlaskConical class="mr-1 inline size-3" />Labs
					</p>
					<Button
						variant="ghost"
						size="sm"
						class="h-6 px-2 text-xs"
						onclick={onGenerateLab}
						disabled={generatingLab || generatingQuiz}
					>
						{#if generatingLab}
							<LoaderCircle class="mr-1 inline size-3 animate-spin" /> Generating…
						{:else}
							Generate lab
						{/if}
					</Button>
				</div>
				{#if labs.length > 0}
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
				{/if}
			</section>

			<section>
				<div class="mb-1 flex items-center justify-between">
					<p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						<ListChecks class="mr-1 inline size-3" />Quizzes
					</p>
					<Button
						variant="ghost"
						size="sm"
						class="h-6 px-2 text-xs"
						onclick={onGenerateQuiz}
						disabled={generatingLab || generatingQuiz}
					>
						{#if generatingQuiz}
							<LoaderCircle class="mr-1 inline size-3 animate-spin" /> Generating…
						{:else}
							Generate quiz
						{/if}
					</Button>
				</div>
				{#if quizzes.length > 0}
					<ul class="flex flex-wrap gap-1.5">
						{#each quizzes as q (q.id)}
							<li>
								<a
									href="/quiz/{q.id}"
									class="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs hover:bg-accent"
									title={new Date(q.createdAt).toLocaleString()}
								>
									<ListChecks class="size-3" />
									Quiz #{getQuizNumber(q.id)}
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section>
				<CrossLinks {chatId} />
			</section>
		</div>
	{/if}
</div>

<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { MessageSquare, Network, FlaskConical, ListChecks } from '@lucide/svelte';
	import { repos, renderSnippet, deepLink } from '$lib/db';
	import type { SearchHit } from '$lib/db';
	import type { Component } from 'svelte';
	import { dbStatus } from '$lib/stores/db.svelte.js';
	import Pagination from '$lib/components/Pagination.svelte';

	let q = $state(page.url.searchParams.get('q') ?? '');
	let inputEl: HTMLInputElement | undefined = $state();
	let results = $state<SearchHit[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let fts5Available = $state<boolean | null>(null);
	let searched = $state(false);
	let currentPage = $state(1);
	const ITEMS_PER_PAGE = 10;

	function getKindIcon(kind: SearchHit['kind']): Component {
		switch (kind) {
			case 'message':
				return MessageSquare;
			case 'chat':
				return Network;
			case 'lab':
				return FlaskConical;
			case 'quiz_question':
				return ListChecks;
		}
	}

	let totalPages = $derived(Math.max(1, Math.ceil(results.length / ITEMS_PER_PAGE)));
	let pagedResults = $derived(
		results.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
	);
	let pagedGroups = $derived.by(() => {
		const groups: { title: string | null; rootId: string; hits: SearchHit[] }[] = [];
		for (const hit of pagedResults) {
			const key = hit.rootId ?? hit.chatId;
			let group = groups.find((g) => g.rootId === key);
			if (!group) {
				group = { title: hit.chatTitle, rootId: key, hits: [] };
				groups.push(group);
			}
			group.hits.push(hit);
		}
		return groups;
	});

	$effect(() => {
		void results.length;
		currentPage = 1;
	});

	function doSearch(query: string) {
		if (!query.trim()) return;
		loading = true;
		error = null;
		searched = true;
		repos.search
			.search(query, { limit: 50 })
			.then((r) => {
				results = r;
			})
			.catch((e: unknown) => {
				error = e instanceof Error ? e.message : String(e);
				results = [];
			})
			.finally(() => {
				loading = false;
			});
	}

	let timer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const val = q;
		if (timer) clearTimeout(timer);
		if (!val.trim()) {
			results = [];
			error = null;
			return;
		}
		timer = setTimeout(() => doSearch(val), 200);
		return () => {
			if (timer) clearTimeout(timer);
		};
	});

	function handleSubmit(e: Event) {
		e.preventDefault();
		if (timer) clearTimeout(timer);
		goto('/search?q=' + encodeURIComponent(q));
		doSearch(q);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			if (timer) clearTimeout(timer);
			goto('/search?q=' + encodeURIComponent(q));
			doSearch(q);
		}
	}

	onMount(async () => {
		inputEl?.focus();
		if (dbStatus.status !== 'ready') return;
		fts5Available = await repos.search.fts5Available();
		if (q.trim()) doSearch(q);
	});
</script>

<div class="mx-auto max-w-3xl p-6 space-y-4">
	<form onsubmit={handleSubmit}>
		<input
			type="text"
			bind:value={q}
			bind:this={inputEl}
			placeholder="Search messages, chats, labs, and quizzes."
			onkeydown={handleKeydown}
			class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
		/>
	</form>

	{#if fts5Available === false}
		<p
			class="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
		>
			Full-text search is not available in this environment. Use the desktop app for full-text
			search support.
		</p>
	{/if}

	{#if error}
		<p class="text-sm text-destructive">{error}</p>
	{/if}

	{#if !q.trim() && !searched}
		<p class="text-center text-sm text-muted-foreground">
			Search messages, chats, labs, and quizzes.
		</p>
	{:else if q.trim() && !loading && results.length === 0 && !error}
		<p class="text-center text-sm text-muted-foreground">No results.</p>
	{:else if loading}
		<p class="text-center text-sm text-muted-foreground">Searching…</p>
	{:else}
		{#each pagedGroups as group (group.rootId)}
			<div class="space-y-2">
				{#if group.title}
					<a
						href="/chat/{group.rootId}"
						class="block text-sm font-medium text-foreground hover:underline"
					>
						{group.title}
					</a>
				{/if}
				{#each group.hits as hit (hit.refId)}
					{@const Icon = getKindIcon(hit.kind)}
					<a
						href={deepLink(hit)}
						class="flex items-start gap-2 rounded-md p-2 hover:bg-accent transition-colors"
					>
						<Icon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						<div class="min-w-0 space-y-1">
							{#each renderSnippet(hit.snippetTitle) as seg, i (i)}
								{#if seg.mark}
									<mark class="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">{seg.text}</mark>
								{:else}
									<span class="text-sm font-medium">{seg.text}</span>
								{/if}
							{/each}
							<div class="text-sm text-muted-foreground">
								{#each renderSnippet(hit.snippetBody) as seg, i (i)}
									{#if seg.mark}
										<mark class="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">{seg.text}</mark>
									{:else}
										{seg.text}
									{/if}
								{/each}
							</div>
						</div>
					</a>
				{/each}
			</div>
		{/each}
		<Pagination bind:page={currentPage} {totalPages} />
	{/if}
</div>

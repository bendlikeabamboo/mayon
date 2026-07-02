<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { quizzesStore } from '$lib/stores/quizzes.svelte';
	import QuizRunner from '$lib/components/quizzes/QuizRunner.svelte';

	/**
	 * Quiz runner route. Loads the quiz into `quizzesStore.current` on mount and
	 * on `[id]` change (mirrors `/chat/[id]`'s `$effect` param-watch pattern).
	 * Shows loading / not-found states before delegating to `<QuizRunner>`.
	 */
	onMount(async () => {
		if (quizzesStore.list.length === 0) {
			await quizzesStore.loadList();
		}
		const initial = page.params.id;
		if (initial) return quizzesStore.loadQuiz(initial);
	});

	// Reload when navigating between quizzes ([id] changes).
	let lastId = page.params.id;
	$effect(() => {
		const current = page.params.id;
		if (current && current !== lastId) {
			lastId = current;
			void quizzesStore.loadQuiz(current);
		}
	});
</script>

{#if quizzesStore.loading}
	<div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
		<p class="py-8 text-center text-sm text-muted-foreground">Loading quiz…</p>
	</div>
{:else if !quizzesStore.current}
	<div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
		<div class="py-8 text-center">
			<p class="text-sm text-muted-foreground">Quiz not found.</p>
			<Button href="/quiz" variant="link" class="mt-2">Back to quizzes</Button>
		</div>
	</div>
{:else}
	<QuizRunner />
{/if}

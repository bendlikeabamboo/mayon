import { quizzesStore } from '$lib/stores/quizzes.svelte';

export async function load() {
	await quizzesStore.loadList();
	return {};
}

import { quizzesStore } from '#lib/stores/quizzes.svelte.js';

export async function load() {
	await quizzesStore.loadList();
	return {};
}

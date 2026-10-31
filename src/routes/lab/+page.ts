import { labsStore } from '#lib/stores/labs.svelte.js';

export async function load() {
	await labsStore.loadList();
	return {};
}

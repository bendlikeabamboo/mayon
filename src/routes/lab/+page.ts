import { labsStore } from '$lib/stores/labs.svelte';

export async function load() {
	await labsStore.loadList();
	return {};
}

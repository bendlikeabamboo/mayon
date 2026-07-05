import { listRootChats } from '$lib/stores/chat.svelte';
import { listProviders } from '$lib/ai/client';

export async function load() {
	const [roots, providers] = await Promise.all([listRootChats(), listProviders()]);
	return { roots, hasProviders: providers.length > 0 };
}

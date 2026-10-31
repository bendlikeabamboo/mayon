import { listRootChats } from '#lib/stores/chat.svelte.js';
import { listProviders } from '#lib/ai/client.js';

export async function load() {
	const [roots, providers] = await Promise.all([listRootChats(), listProviders()]);
	return { roots, hasProviders: providers.length > 0 };
}

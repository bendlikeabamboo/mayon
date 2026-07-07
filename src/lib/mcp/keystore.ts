import { createKeyStore } from '$lib/ai/keystore/client';

function ks() {
	return createKeyStore();
}

export function setMcpSecret(serverId: string, name: string, value: string): Promise<void> {
	return ks().set(`mcp:${serverId}:${name}`, value);
}

export function hasMcpSecret(serverId: string, name: string): Promise<boolean> {
	return ks().has(`mcp:${serverId}:${name}`);
}

export function deleteMcpSecret(serverId: string, name: string): Promise<void> {
	return ks().delete(`mcp:${serverId}:${name}`);
}

export async function deleteServerSecrets(serverId: string, names: string[]): Promise<void> {
	await Promise.all(names.map((n) => deleteMcpSecret(serverId, n)));
}

import type { McpServerConfig } from './types';

async function computeTrustHash(config: McpServerConfig): Promise<string> {
	const parts: string[] = [config.transport];
	if (config.command) parts.push(config.command);
	if (config.args) parts.push(config.args.join(' '));
	if (config.url) parts.push(config.url);
	if (config.cwd) parts.push(config.cwd);
	const raw = parts.join('|');
	const encoder = new TextEncoder();
	const data = encoder.encode(raw);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export async function isTrusted(config: McpServerConfig): Promise<boolean> {
	if (!config.trustedHash) return false;
	return config.trustedHash === (await computeTrustHash(config));
}

export async function trustNow(config: McpServerConfig): Promise<McpServerConfig> {
	const hash = await computeTrustHash(config);
	return { ...config, trustedHash: hash };
}

export { computeTrustHash };

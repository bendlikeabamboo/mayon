import { isTauri } from '$lib/db';
import { createBrowserKeyStore } from '$lib/ai/keystore/browser';
import type { McpTransport } from './transport';
import type { McpServerConfig } from './types';
import { HttpMcpTransport } from './http';
import { StdioMcpTransport } from './stdio';

export function createMcpTransport(config: McpServerConfig): McpTransport {
	if (config.transport === 'stdio') {
		const envKeyIds = Object.entries(config.env ?? {}).map(([name, ref]) => ({
			name,
			keyId: ref.secretRef
		}));
		return new StdioMcpTransport({
			serverId: config.id,
			command: config.command ?? '',
			args: config.args ?? [],
			envKeyIds,
			cwd: config.cwd
		});
	}

	if (config.transport === 'http') {
		if (!config.url) throw new Error('MCP server URL is required');
		const secretResolver: (keyId: string) => Promise<string | null> = isTauri()
			? async (_keyId) => {
					throw new Error(
						'MCP HTTP secret headers are browser-only in this build; use a stdio server or a literal header value on desktop.'
					);
				}
			: async (keyId) => createBrowserKeyStore().get(keyId);
		return new HttpMcpTransport({
			serverId: config.id,
			url: config.url,
			headers: config.headers,
			callTimeoutMs: config.callTimeoutMs,
			secretResolver
		});
	}

	throw new Error(`Unsupported transport: ${config.transport}`);
}

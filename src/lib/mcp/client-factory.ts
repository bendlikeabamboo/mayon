import { createBrowserKeyStore } from '$lib/ai/keystore/browser';
import { serverStatus } from '$lib/server/status.svelte';
import type { McpTransport } from './transport';
import type { McpServerConfig } from './types';
import { HttpMcpTransport } from './http';
import { ServerStdioMcpTransport } from './server-stdio';

export function createMcpTransport(config: McpServerConfig): McpTransport {
	if (config.transport === 'stdio') {
		if (!serverStatus.has('stdio-mcp')) {
			throw new Error('stdio MCP servers require the Mayon server (run: docker compose up)');
		}
		return new ServerStdioMcpTransport({ config });
	}

	if (config.transport === 'http') {
		if (!config.url) throw new Error('MCP server URL is required');
		const secretResolver: (keyId: string) => Promise<string | null> = async (keyId) =>
			createBrowserKeyStore().get(keyId);
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

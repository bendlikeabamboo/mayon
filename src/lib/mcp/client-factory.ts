import { createBrowserKeyStore } from '$lib/ai/keystore/browser';
import { sidecarStatus } from '$lib/sidecar/status.svelte';
import type { McpTransport } from './transport';
import type { McpServerConfig } from './types';
import { HttpMcpTransport } from './http';
import { SidecarStdioMcpTransport } from './sidecar-stdio';

export function createMcpTransport(config: McpServerConfig): McpTransport {
	if (config.transport === 'stdio') {
		if (!sidecarStatus.has('stdio-mcp')) {
			throw new Error('stdio MCP servers require the Mayon sidecar (run: docker compose up)');
		}
		return new SidecarStdioMcpTransport({ config });
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

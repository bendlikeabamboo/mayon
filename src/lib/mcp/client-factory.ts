import type { McpTransport } from './transport';
import type { McpServerConfig } from './types';
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
	throw new Error('HTTP transport lands in M2');
}

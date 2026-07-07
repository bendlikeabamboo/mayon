import type { McpServerConfig } from './types';

export function parseClaudeDesktopConfig(jsonText: string): McpServerConfig[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (e) {
		throw new Error('Invalid JSON: ' + (e instanceof Error ? e.message : String(e)), { cause: e });
	}

	if (!parsed || typeof parsed !== 'object' || !('mcpServers' in parsed)) {
		throw new Error('Expected a JSON object with a "mcpServers" key (Claude Desktop format).');
	}

	const servers = (parsed as { mcpServers: Record<string, unknown> }).mcpServers;
	if (typeof servers !== 'object' || servers === null) {
		throw new Error('"mcpServers" must be a JSON object.');
	}

	const results: McpServerConfig[] = [];
	for (const [name, entry] of Object.entries(servers)) {
		if (!entry || typeof entry !== 'object') {
			throw new Error(`Server "${name}" must be a JSON object.`);
		}
		const e = entry as Record<string, unknown>;

		const config: McpServerConfig = {
			id: crypto.randomUUID(),
			name,
			transport: 'stdio',
			command: typeof e.command === 'string' ? e.command : undefined,
			args: Array.isArray(e.args) ? e.args.map(String) : [],
			env: buildEnv(e.env as Record<string, unknown> | undefined),
			enabled: false,
			createdAt: Date.now()
		};

		if (!config.command) {
			throw new Error(`Server "${name}" is missing a "command" field.`);
		}

		results.push(config);
	}
	return results;
}

function buildEnv(env: Record<string, unknown> | undefined): Record<string, { secretRef: string }> {
	if (!env) return {};
	const out: Record<string, { secretRef: string }> = {};
	for (const [key, value] of Object.entries(env)) {
		out[key] = { secretRef: typeof value === 'string' ? `mcp:_pending_:${key}` : '' };
	}
	return out;
}

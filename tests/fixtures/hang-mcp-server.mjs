#!/usr/bin/env node
// Stub MCP server used by stdio-turn.integration.test.ts. Answers initialize
// and tools/list normally, then deliberately never answers tools/call — the
// "tool result never arrives" shape reported by real users whose MCP child
// wedges mid-turn (e.g. npx resolver stalls).
import { createInterface } from 'readline';

const TOOLS = [
	{
		name: 'stuck',
		description: 'Never returns a result.',
		inputSchema: {
			type: 'object',
			properties: { message: { type: 'string' } },
			required: ['message']
		},
		annotations: { readOnlyHint: true }
	}
];

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
	if (!line.trim()) return;
	try {
		const msg = JSON.parse(line);
		if (msg.method === 'initialize') {
			write({
				jsonrpc: '2.0',
				id: msg.id,
				result: {
					protocolVersion: '2025-06-18',
					capabilities: { tools: {} },
					serverInfo: { name: 'hang-mcp-server', version: '0.0.1' }
				}
			});
		} else if (msg.method === 'tools/list') {
			write({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
		} else if (msg.method === 'tools/call') {
			// Intentionally never responds.
		}
	} catch {
		/* ignore */
	}
});

function write(msg) {
	process.stdout.write(JSON.stringify(msg) + '\n');
}

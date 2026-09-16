#!/usr/bin/env node
// Stub MCP server used by stdio-turn.integration.test.ts. Answers initialize
// and tools/list normally, then exits as soon as a tools/call arrives — the
// "child dies mid-turn" shape (bad npx resolution, crashed server process).
import { createInterface } from 'readline';

const TOOLS = [
	{
		name: 'die',
		description: 'Exits the server when called.',
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
					serverInfo: { name: 'die-mcp-server', version: '0.0.1' }
				}
			});
		} else if (msg.method === 'tools/list') {
			write({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
		} else if (msg.method === 'tools/call') {
			process.exit(7);
		}
	} catch {
		/* ignore */
	}
});

function write(msg) {
	process.stdout.write(JSON.stringify(msg) + '\n');
}

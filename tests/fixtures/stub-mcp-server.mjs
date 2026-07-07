#!/usr/bin/env node
import { createInterface } from 'readline';

const TOOLS = [
	{
		name: 'echo',
		description: 'Echoes the input back.',
		inputSchema: {
			type: 'object',
			properties: { message: { type: 'string', description: 'The message to echo.' } },
			required: ['message'],
		},
		annotations: { readOnlyHint: true },
	},
];

const rl = createInterface({ input: process.stdin });
let nextId = 1;

rl.on('line', async (line) => {
	if (!line.trim()) return;
	try {
		const msg = JSON.parse(line);
		const id = msg.id ?? nextId++;
		if (msg.method === 'initialize') {
			write({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stub-mcp-server', version: '0.0.1' } });
		} else if (msg.method === 'tools/list') {
			write({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
		} else if (msg.method === 'tools/call') {
			const args = msg.params?.arguments ?? {};
			write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(args) }] } });
		} else if (msg.method === 'notifications/initialized') {
			// no response
		} else {
			write({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
		}
	} catch (e) {
		write({ jsonrpc: '2.0', id: nextId++, error: { code: -32700, message: 'Parse error' } });
	}
});

function write(msg) {
	process.stdout.write(JSON.stringify(msg) + '\n');
}

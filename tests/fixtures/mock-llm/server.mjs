#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.MOCK_LLM_PORT ?? 9999);
const MODEL_ID = 'mock-sink';
const CHUNK_INTERVAL_MS = 60;
const BLOCKS_PER_CHUNK = 3;

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kitchen-sink.md');
const doc = readFileSync(fixturePath, 'utf8');

const blocks = doc
	.split(/\n\n+/)
	.map((block) => block.trim())
	.filter(Boolean);
const chunks = [];
for (let i = 0; i < blocks.length; i += BLOCKS_PER_CHUNK) {
	chunks.push(blocks.slice(i, i + BLOCKS_PER_CHUNK).join('\n\n'));
}
const plainProse = blocks.find((block) => !block.startsWith('#')) ?? doc;

let counter = 0;
const nextId = () => `mock-${++counter}`;

function sendJson(res, status, body) {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = '';
		req.on('data', (chunk) => {
			data += chunk;
		});
		req.on('end', () => resolve(data));
		req.on('error', reject);
	});
}

function sseFrame(payload) {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

function streamReply(res, id, model) {
	res.writeHead(200, {
		'content-type': 'text/event-stream',
		'cache-control': 'no-cache',
		connection: 'keep-alive'
	});
	res.on('error', () => {});
	const frames = [
		sseFrame({ id, model, choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }),
		...chunks.map(
			(content) => sseFrame({ id, model, choices: [{ delta: { content }, finish_reason: null }] })
		)
	];
	const terminal = sseFrame({
		id,
		model,
		choices: [{ delta: {}, finish_reason: 'stop' }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
	});
	let index = 0;
	const writeNext = () => {
		if (res.destroyed) {
			res.end();
			return;
		}
		if (index < frames.length) {
			res.write(frames[index++]);
			setTimeout(writeNext, CHUNK_INTERVAL_MS);
			return;
		}
		res.write(terminal);
		res.write('data: [DONE]\n\n');
		res.end();
	};
	writeNext();
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
	if (req.method === 'GET' && url.pathname === '/v1/models') {
		sendJson(res, 200, { data: [{ id: MODEL_ID, object: 'model' }] });
		return;
	}
	if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
		let body;
		try {
			body = JSON.parse(await readBody(req));
		} catch {
			sendJson(res, 400, {
				error: { message: 'malformed JSON body', type: 'invalid_request_error' }
			});
			return;
		}
		const id = nextId();
		const model =
			typeof body.model === 'string' && body.model.length > 0 ? body.model : MODEL_ID;
		if (body.stream === true) {
			streamReply(res, id, model);
			return;
		}
		sendJson(res, 200, {
			id,
			model,
			choices: [{ message: { role: 'assistant', content: plainProse }, finish_reason: 'stop' }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
		});
		return;
	}
	sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
	console.log(`mock-llm listening on port ${PORT}`);
});

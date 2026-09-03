#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.MOCK_LLM_PORT ?? 9999);
const MODEL_ID = 'mock-sink';
const CHUNK_INTERVAL_MS = 150;
const BLOCKS_PER_CHUNK = 3;

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const kitchenSinkPath = path.join(fixtureDir, 'kitchen-sink.md');
const outlineDocPath = path.join(fixtureDir, 'outline-doc.md');

function buildChunks(doc) {
	const blocks = doc
		.split(/\n\n+/)
		.map((block) => block.trim())
		.filter(Boolean);
	const chunks = [];
	for (let i = 0; i < blocks.length; i += BLOCKS_PER_CHUNK) {
		const group = blocks.slice(i, i + BLOCKS_PER_CHUNK).join('\n\n');
		// Preserve the document's block separator across chunk boundaries — the
		// consumer concatenates deltas verbatim, so a dropped separator here would
		// silently corrupt the reply (blocks would run together).
		chunks.push(i + BLOCKS_PER_CHUNK < blocks.length ? group + '\n\n' : group);
	}
	return { chunks, plainProse: blocks.find((block) => !block.startsWith('#')) ?? doc };
}

const kitchenSink = buildChunks(readFileSync(kitchenSinkPath, 'utf8'));
// A long, uneven, multi-header reply for section-strip validation. Served when
// the user's message mentions "outline"; the kitchen sink stays the default so
// existing e2e assertions are untouched.
const outlineDoc = buildChunks(readFileSync(outlineDocPath, 'utf8'));

function pickDoc(body) {
	const messages = Array.isArray(body?.messages) ? body.messages : [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== 'user') continue;
		const content =
			typeof message.content === 'string'
				? message.content
				: Array.isArray(message.content)
					? message.content
						.map((part) => (typeof part?.text === 'string' ? part.text : ''))
						.join(' ')
					: '';
		if (/outline/i.test(content)) return outlineDoc;
		return kitchenSink;
	}
	return kitchenSink;
}

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

function streamReply(res, id, model, doc) {
	res.writeHead(200, {
		'content-type': 'text/event-stream',
		'cache-control': 'no-cache',
		connection: 'keep-alive'
	});
	res.on('error', () => {});
	const frames = [
		sseFrame({ id, model, choices: [{ delta: { role: 'assistant' }, finish_reason: null }] }),
		...doc.chunks.map(
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
		const doc = pickDoc(body);
		if (body.stream === true) {
			streamReply(res, id, model, doc);
			return;
		}
		sendJson(res, 200, {
			id,
			model,
			choices: [{ message: { role: 'assistant', content: doc.plainProse }, finish_reason: 'stop' }],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
		});
		return;
	}
	sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
	console.log(`mock-llm listening on port ${PORT}`);
});

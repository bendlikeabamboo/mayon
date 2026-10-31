#!/usr/bin/env node
// Minimal Langfuse receiver stub for the telemetry e2e scenarios (026 V2/V3).
// Dependency-free node:http server in the mock-llm fixture style: serves the
// two endpoints the Mayon server pipeline speaks (contracts/langfuse-ingestion.md),
// keeps every received ingestion batch in memory, and exposes them for
// assertions. NOT a Langfuse implementation — only the contract surface.

import { createServer } from 'node:http';

const PORT = Number(process.env.LANGFUSE_STUB_PORT ?? 9998);

/** Received ingestion calls, oldest first: { authorization, batch: Event[] }. */
const received = [];

function sendJson(res, status, body) {
	res.writeHead(status, {
		'content-type': 'application/json',
		'access-control-allow-origin': '*'
	});
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

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

	// Probe target (config validation, research D6): any 2xx means reachable.
	if (req.method === 'GET' && url.pathname === '/api/public/projects') {
		sendJson(res, 200, { data: [{ id: 'stub-project', name: 'langfuse-stub' }] });
		return;
	}

	// Ingestion: accept every batch, remember it verbatim.
	if (req.method === 'POST' && url.pathname === '/api/public/ingestion') {
		let batch = [];
		try {
			const body = JSON.parse(await readBody(req));
			batch = Array.isArray(body?.batch) ? body.batch : [];
		} catch {
			sendJson(res, 400, { error: 'malformed JSON body' });
			return;
		}
		received.push({ authorization: req.headers.authorization ?? null, batch });
		console.log(`[langfuse-stub] ingestion batch #${received.length} (${batch.length} events)`);
		sendJson(res, 200, { ok: true });
		return;
	}

	// Assertion surface: everything received so far, batches plus a flattened
	// event list (easier scanning in specs).
	if (req.method === 'GET' && url.pathname === '/__received') {
		sendJson(res, 200, {
			batches: received.length,
			received,
			events: received.flatMap((r) => r.batch)
		});
		return;
	}

	// Test isolation: clear the in-memory log between scenarios.
	if (req.method === 'POST' && url.pathname === '/__reset') {
		received.length = 0;
		sendJson(res, 200, { ok: true });
		return;
	}

	sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
	console.log(`langfuse-stub listening on port ${PORT}`);
});

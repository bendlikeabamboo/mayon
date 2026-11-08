#!/usr/bin/env node
// Minimal Langfuse receiver stub for the telemetry e2e scenarios (026 V2/V3).
// Dependency-free node:http server in the mock-llm fixture style: serves the
// two endpoints the Mayon server pipeline speaks (contracts/langfuse-ingestion.md),
// keeps every received OTLP trace export in memory, and exposes the spans for
// assertions. NOT a Langfuse implementation — only the contract surface.

import { createServer } from 'node:http';

const PORT = Number(process.env.LANGFUSE_STUB_PORT ?? 9998);

/** Received OTLP exports, oldest first: { authorization, spans: Span[] }. */
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

	// OTLP trace ingestion: accept every export, remember its spans verbatim.
	if (req.method === 'POST' && url.pathname === '/api/public/otel/v1/traces') {
		let spans = [];
		try {
			const body = JSON.parse(await readBody(req));
			spans = (body?.resourceSpans ?? []).flatMap((rs) =>
				(rs?.scopeSpans ?? []).flatMap((ss) => ss?.spans ?? [])
			);
		} catch {
			sendJson(res, 400, { error: 'malformed JSON body' });
			return;
		}
		received.push({ authorization: req.headers.authorization ?? null, spans });
		console.log(`[langfuse-stub] otlp export #${received.length} (${spans.length} spans)`);
		sendJson(res, 200, {});
		return;
	}

	// Assertion surface: everything received so far, batches plus a flattened
	// span list (easier scanning in specs).
	if (req.method === 'GET' && url.pathname === '/__received') {
		sendJson(res, 200, {
			batches: received.length,
			received,
			spans: received.flatMap((r) => r.spans)
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

// Keep the stub alive through races with in-flight exports: an aborted OTLP
// body rejects readBody (unhandledRejection) and a dying socket raises
// clientError — either would otherwise crash the process mid-deck, and the
// next spec's /__reset would fail with a socket hang up until the container
// restarts (observed as the telemetry V3 e2e flake).
process.on('unhandledRejection', (err) => {
	console.error('[langfuse-stub] swallowed rejection:', err);
});
process.on('uncaughtException', (err) => {
	console.error('[langfuse-stub] swallowed exception:', err);
});
server.on('clientError', (err, socket) => {
	console.error('[langfuse-stub] client error:', err.message);
	if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

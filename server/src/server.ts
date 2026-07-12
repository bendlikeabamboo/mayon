import Fastify from 'fastify';
import fp from '@fastify/websocket';
import { fileURLToPath } from 'node:url';
import type { HealthResponse } from '@mayon/shared';
import { VERSION } from './version';
import { registerMcpBridge } from './mcp';
import { registerLlmProxy } from './llm-proxy';
import { createSandboxDb, registerSandboxDb } from './db';
import { registerBackup } from './backup';

const HOST = '0.0.0.0';
const PORT = parseInt(process.env.PORT ?? '4319', 10);

const SANDBOX_DB_PATH = process.env.SANDBOX_DB_PATH ?? '/data/sandbox.sqlite';

export function buildApp(dbPath = SANDBOX_DB_PATH) {
	const app = Fastify();

	app.register(fp);
	app.register(async (fastify) => {
		fastify.get<{ Reply: HealthResponse }>('/api/health', async (_req, reply) => {
			return reply.send({
				ok: true,
				version: VERSION,
				caps: ['stdio-mcp', 'llm-proxy', 'sandbox-db', 'backup'],
				sandboxDbPath: dbPath
			});
		});

		registerMcpBridge(fastify);
		registerLlmProxy(fastify);

		const sandboxDb = createSandboxDb(dbPath);
		registerSandboxDb(fastify, sandboxDb);
		registerBackup(fastify, sandboxDb, dbPath);

		fastify.addHook('onClose', async () => {
			sandboxDb.close();
		});
	});

	return app;
}

export async function start() {
	const app = buildApp();
	await app.listen({ port: PORT, host: HOST });
	console.log(`server listening on :${PORT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	start().catch((err) => {
		console.error('Failed to start server:', err);
		process.exit(1);
	});
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './server';
import type Fastify from 'fastify';

describe('server', () => {
	let app: Fastify.Instance;

	beforeAll(async () => {
		app = buildApp(':memory:');
		await app.listen({ port: 0, host: '0.0.0.0' });
	});

	afterAll(async () => {
		await app.close();
	});

	describe('GET /api/health', () => {
		it('returns 200 with ok:true, version, caps including sandbox-db, and sandboxDbPath', async () => {
			const res = await app.inject({ method: 'GET', url: '/api/health' });
			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.ok).toBe(true);
			expect(body.version).toBe('0.0.1');
			expect(body.caps).toEqual(['stdio-mcp', 'llm-proxy', 'sandbox-db', 'backup']);
			expect(typeof body.sandboxDbPath).toBe('string');
			expect(body.sandboxDbPath.length).toBeGreaterThan(0);
		});
	});
});

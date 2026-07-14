import { describe, expect, it } from 'vitest';

describe('DbStatusState', () => {
	it('is exported and functional', async () => {
		const { dbStatus } = await import('./db.svelte');
		dbStatus.markError('test error');
		expect(dbStatus.status).toBe('error');
		expect(dbStatus.error).toBe('test error');
		expect(dbStatus.reason).toBe('generic');

		dbStatus.markReady('pg');
		expect(dbStatus.status).toBe('ready');
		expect(dbStatus.reason).toBeNull();
		expect(dbStatus.error).toBeNull();
	});

	it('markError with server-unreachable reason', async () => {
		const { dbStatus } = await import('./db.svelte');
		dbStatus.markReady('pg');
		dbStatus.markError('Cannot reach server', 'server-unreachable');
		expect(dbStatus.status).toBe('error');
		expect(dbStatus.error).toBe('Cannot reach server');
		expect(dbStatus.reason).toBe('server-unreachable');

		dbStatus.markReady('pg');
		expect(dbStatus.reason).toBeNull();
	});
});

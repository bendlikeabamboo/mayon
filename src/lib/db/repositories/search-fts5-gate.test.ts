import { describe, expect, it, beforeEach } from 'vitest';
import { bootstrapWithDriver } from '$lib/db/driver/client';
import { createMemoryDriver } from '$lib/db/driver/memory';

beforeEach(async () => {
	await bootstrapWithDriver(await createMemoryDriver());
});

describe('FTS5 availability gate', () => {
	it('sql.js supports FTS5 (CREATE VIRTUAL TABLE + MATCH)', async () => {
		const { getDriver } = await import('$lib/db/driver/client');
		const driver = getDriver();

		await driver.exec('CREATE VIRTUAL TABLE _fts_probe USING fts5(x)');
		await driver.exec("INSERT INTO _fts_probe VALUES ('hello world')");
		const { rows } = await driver.query<string[]>(
			"SELECT * FROM _fts_probe WHERE _fts_probe MATCH 'hello'"
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]![0]).toBe('hello world');
		await driver.exec('DROP TABLE _fts_probe');
	});
});

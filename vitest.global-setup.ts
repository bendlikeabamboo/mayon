import { PostgreSqlContainer } from '@testcontainers/postgresql';

export default async function globalSetup() {
	const container = await new PostgreSqlContainer('postgres:17-alpine')
		.withDatabase('test')
		.withUsername('postgres')
		.withPassword('postgres')
		.start();
	const host = container.getHost();
	const port = container.getMappedPort(5432);
	process.env.TEST_DATABASE_URL = `postgresql://postgres:postgres@${host}:${port}/test`;
	console.log('[vitest globalSetup] testcontainers PG ready at', process.env.TEST_DATABASE_URL);

	const { setupGlobalTestPg, teardownGlobalTestPg } = await import('./src/lib/db/driver/pg-test.ts');
	await setupGlobalTestPg();

	return async () => {
		await teardownGlobalTestPg();
		await container.stop();
	};
}

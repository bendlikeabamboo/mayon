import { teardownGlobalTestPg } from './src/lib/db/driver/pg-test.js';

export default async function globalTeardown() {
	await teardownGlobalTestPg();
}

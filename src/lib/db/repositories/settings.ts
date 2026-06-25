import { eq } from 'drizzle-orm';
import { settings } from '$lib/db/schema';
import { getDb } from '$lib/db/driver/client';

/**
 * Key/value store with JSON values. The ONLY way app code reads/writes settings.
 *
 * No secrets: provider config holds non-secret handle fields only; API keys are
 * a P1 concern (desktop keychain / browser IndexedDB).
 */
export const settingsRepo = {
	async get<T>(key: string): Promise<T | null> {
		const rows = await getDb().select().from(settings).where(eq(settings.key, key)).all();
		if (rows.length === 0) return null;
		try {
			return JSON.parse(rows[0].value) as T;
		} catch {
			return null;
		}
	},

	async set<T>(key: string, value: T): Promise<void> {
		const json = JSON.stringify(value);
		await getDb()
			.insert(settings)
			.values({ key, value: json })
			.onConflictDoUpdate({ target: settings.key, set: { value: json } })
			.run();
	},

	async delete(key: string): Promise<void> {
		await getDb().delete(settings).where(eq(settings.key, key)).run();
	},

	async keys(): Promise<string[]> {
		const rows = await getDb().select({ key: settings.key }).from(settings).all();
		return rows.map((r) => r.key);
	},

	/** Seed required defaults on first run (idempotent). */
	async seedDefaults(): Promise<void> {
		if ((await this.get('providers')) === null) await this.set('providers', {});
	}
};

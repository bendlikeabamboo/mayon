import { eq } from 'drizzle-orm';
import { settings } from '$lib/db/schema';
import { awaitDb } from '$lib/db/driver/client';

/**
 * Key/value store with JSON values. The ONLY way app code reads/writes settings.
 *
 * Methods `await` the bootstrapped db so a settings call made during early boot
 * (e.g. `/settings` `onMount` firing before the root layout's `bootstrapDb`
 * resolves) waits for boot rather than throwing a race.
 *
 * No secrets: provider config holds non-secret handle fields only; API keys are
 * a P1 concern (desktop keychain / browser IndexedDB).
 */
export const settingsRepo = {
	async get<T>(key: string): Promise<T | null> {
		const rows = await (await awaitDb()).select().from(settings).where(eq(settings.key, key)).all();
		if (rows.length === 0) return null;
		try {
			return JSON.parse(rows[0].value) as T;
		} catch {
			return null;
		}
	},

	async set<T>(key: string, value: T): Promise<void> {
		const json = JSON.stringify(value);
		await (
			await awaitDb()
		)
			.insert(settings)
			.values({ key, value: json })
			.onConflictDoUpdate({ target: settings.key, set: { value: json } })
			.run();
	},

	async delete(key: string): Promise<void> {
		await (await awaitDb()).delete(settings).where(eq(settings.key, key)).run();
	},

	async keys(): Promise<string[]> {
		const rows = await (await awaitDb()).select({ key: settings.key }).from(settings).all();
		return rows.map((r) => r.key);
	},

	/** Seed required defaults on first run (idempotent). */
	async seedDefaults(): Promise<void> {
		if ((await this.get('providers')) === null) await this.set('providers', {});
	}
};

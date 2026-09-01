/**
 * Persisted on/off preference for the section peek strip (settings KV, JSON
 * boolean, default true). This module is the SOLE authorized writer of the
 * `sectionStripEnabled` key; UI and chat gating read only via these helpers.
 *
 * Reads are defensive (contracts §2): a missing key, corrupt JSON, or a
 * wrong-typed value falls back to `true` (strip on) without throwing.
 */
import { repos } from '$lib/db';

export const STRIP_ENABLED_KEY = 'sectionStripEnabled';

export async function isStripEnabled(): Promise<boolean> {
	let stored: unknown;
	try {
		stored = await repos.settings.get(STRIP_ENABLED_KEY);
	} catch {
		return true;
	}
	return typeof stored === 'boolean' ? stored : true;
}

export async function setStripEnabled(value: boolean): Promise<void> {
	await repos.settings.set(STRIP_ENABLED_KEY, value);
}

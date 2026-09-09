/**
 * Persisted streaming-look preset (settings KV, JSON string enum, default
 * 'standard'). This module is the SOLE authorized writer of the `streamPreset`
 * key; UI and pacing read only via these helpers.
 *
 * Reads are defensive (contracts/stream-preset-setting.md): a missing key,
 * corrupt JSON, or a value outside the union falls back to `'standard'`
 * (today's behavior) without throwing.
 */
import { repos } from '$lib/db';

export type StreamPreset = 'calm' | 'standard' | 'expressive';

export const STREAM_PRESET_KEY = 'streamPreset';

export const STREAM_PRESET_OPTIONS: readonly StreamPreset[] = ['calm', 'standard', 'expressive'];

export const STREAM_PRESET_LABELS: Record<StreamPreset, string> = {
	calm: 'Calm',
	standard: 'Standard',
	expressive: 'Expressive'
};

export async function getStreamPreset(): Promise<StreamPreset> {
	let stored: unknown;
	try {
		stored = await repos.settings.get<unknown>(STREAM_PRESET_KEY);
	} catch {
		return 'standard';
	}
	return stored === 'calm' || stored === 'standard' || stored === 'expressive'
		? stored
		: 'standard';
}

export async function setStreamPreset(value: StreamPreset): Promise<void> {
	await repos.settings.set(STREAM_PRESET_KEY, value);
}
